// query_rows (docs/AGENT_TOOLS.md, 5.1): the rows of a client table, filtered, for the questions of the user ("the invoices of
// this client without an allocation number"). Read only; registers a handle R<n> for every row it shows.
import { ToolError } from "../errors.js";
import { dateKey } from "../../intake-facts.js";
import { pcnReview } from "../../pcn-review.js";

const PAGE_BYTES = 15000;
const FLAGS = ["review", "duplicate", "excluded", "agent", "pcn_pending", "zero_amount"];
// Positions of a saved row's values (rowSnapshot in app.js).
const ACCOUNT = 1, PURPOSE = 2, SUPPLIER = 3, SUPPLIER_ID = 4, REFERENCE = 5, ALLOCATION = 6, GROSS = 7, NET = 8, VAT = 9;
const at = (row, index) => String(row.values?.[index] ?? "").trim();
const amount = (value) => Math.abs(Number(String(value ?? "").replace(/,/g, "")) || 0);
const round = (value) => Math.round(value * 100) / 100;

// Source amounts when the row has them (they do not change with the recognition percentages), else what the table shows.
function amountsOf(row) {
  const net = amount(row.rawNet), vat = amount(row.rawVat);
  if (net || vat) return { net: round(net), vat: round(vat), total: round(net + vat) };
  return { net: round(amount(at(row, NET))), vat: round(amount(at(row, VAT))), total: round(amount(at(row, GROSS))) };
}

function flagsOf(row, review) {
  const flags = [];
  if (row.statusClass === "review") flags.push("review");
  if (row.autoExclude === "duplicate" || /כפילות/.test(row.statusText ?? "")) flags.push("duplicate");
  if (row.active === false) flags.push("excluded");
  if (row.agent) flags.push("agent");
  if (review?.pending) flags.push("pcn_pending");
  if (row.active !== false && !amountsOf(row).total && !amount(at(row, GROSS))) flags.push("zero_amount");
  return flags;
}

const matchesText = (row, needle) => [at(row, PURPOSE), at(row, SUPPLIER), at(row, SUPPLIER_ID), at(row, REFERENCE), row.reference, row.documentTitle].some((value) => String(value ?? "").toLowerCase().includes(needle));

export default {
  name: "query_rows",
  description: "Read the rows of a client table (one month or all), optionally filtered by text, supplier, date range, whether an allocation number exists, account code or a flag (review, duplicate, excluded, agent, pcn_pending, zero_amount). position is the row number of the # column of the table: use it when you talk to the user, never the handle (row). net, vat and total are the amounts of the document; recognized_total is what the table shows after the recognition percentages (for example 25% of a home client).",
  schema: {
    type: "object",
    required: ["client"],
    properties: {
      client: { type: "string", maxLength: 12, description: "Client handle." },
      month: { type: "string", maxLength: 7, description: "YYYY-MM; all months when missing." },
      where: {
        type: "object",
        properties: {
          text: { type: "string", maxLength: 80 },
          supplier: { type: "string", maxLength: 80 },
          date_from: { type: "string", maxLength: 10 },
          date_to: { type: "string", maxLength: 10 },
          has_allocation: { type: "boolean" },
          account: { type: "string", maxLength: 3 },
          flag: { type: "string", enum: FLAGS },
        },
      },
      limit: { type: "integer", minimum: 1, maximum: 200 },
      next: { type: "string", maxLength: 12 },
    },
  },
  async run(args, ctx) {
    const client = ctx.handles.get("C", args.client);
    if (args.month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(args.month)) throw new ToolError("invalid_argument", "month must look like 2026-03.");
    const where = args.where ?? {};
    const from = where.date_from ? dateKey(where.date_from) : null;
    const to = where.date_to ? dateKey(where.date_to) : null;
    if ((where.date_from && !from) || (where.date_to && !to)) throw new ToolError("invalid_argument", "Dates must look like 2026-03-14.");
    if (args.month && (await ctx.services.declarations.state(client.clientId, args.month)) === "missing") throw new ToolError("not_found", `There is no declaration ${args.month}.`);
    const profile = await ctx.services.clients.profile(client.clientId);

    const matched = [];
    for (const { month, rows } of await ctx.services.rows.list(client.clientId, args.month ?? null)) {
      const reviews = pcnReview(rows, { pcnRequired: profile.pcnRequired });
      rows.forEach((row, index) => {
        if (!row.documentId) return;
        const flags = flagsOf(row, reviews[index]);
        const date = dateKey(at(row, 0));
        const hasAllocation = Boolean(at(row, ALLOCATION).replace(/\D/g, ""));
        if (where.text && !matchesText(row, where.text.toLowerCase())) return;
        if (where.supplier && !at(row, SUPPLIER).toLowerCase().includes(where.supplier.toLowerCase())) return;
        if ((from && (!date || date < from)) || (to && (!date || date > to))) return;
        if (where.has_allocation !== undefined && hasAllocation !== where.has_allocation) return;
        if (where.account && at(row, ACCOUNT) !== where.account) return;
        if (where.flag && !flags.includes(where.flag)) return;
        matched.push({ month, row, position: index + 1, flags, date });
      });
    }

    const start = Number.parseInt(args.next ?? "0", 10) || 0;
    const rows = [];
    let size = 0;
    for (const { month, row, position, flags, date } of matched.slice(start, start + (args.limit ?? 50))) {
      // A row is told apart by its month and its number in the table: two rows can share one documentId (the groups of one invoice).
      const handle = ctx.handles.create("R", `${client.clientId}|${month}|${position}`, { clientId: client.clientId, month, documentId: row.documentId, position });
      const item = {
        row: handle, month, position, date: date ?? at(row, 0), supplier: at(row, SUPPLIER), supplier_vat_id: at(row, SUPPLIER_ID),
        document_number: String(row.reference || at(row, REFERENCE)), allocation_number: at(row, ALLOCATION), ...amountsOf(row),
        recognized_total: round(amount(at(row, GROSS))),
        account: at(row, ACCOUNT), flags, status: String(row.statusText ?? ""),
        ...(row.agent && row.agentOpinion ? { agent_reason: String(row.agentOpinion).slice(0, 300) } : {}),
      };
      size += JSON.stringify(item).length;
      if (rows.length && size > PAGE_BYTES) break;
      rows.push(item);
    }
    const end = start + rows.length;
    return { rows, total: matched.length, ...(end < matched.length ? { next: String(end) } : {}) };
  },
};
