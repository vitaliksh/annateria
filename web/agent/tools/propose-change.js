// propose_change (docs/AGENT_TOOLS.md, 5.4): a suggestion for rows that already exist. It changes nothing: the panel shows a
// card and the page's own edit code applies it when the user clicks. Corrections of OCR facts go only through here.
import { ToolError } from "../errors.js";
import { dateKey } from "../../intake-facts.js";

const bad = (message) => new ToolError("invalid_argument", message);
const text = (max) => (value) => { if (value.length > max) throw bad(`value is too long (at most ${max}).`); return value; };
const digits = (max) => (value) => { if (value !== "" && !/^\d+$/.test(value)) throw bad("value must be digits only."); return text(max)(value); };
const money = (value) => { const number = value.trim() === "" ? NaN : Number(value.replace(",", ".")); if (!Number.isFinite(number)) throw bad("value must be a number."); return number; };
const oneOf = (allowed) => (value) => { const number = money(value); if (!allowed.includes(number)) throw bad(`value must be one of: ${allowed.join(", ")}.`); return number; };

// Parses the text the model sent into the type of the field. (account and month also need the data: see run().)
const FIELDS = {
  date: (value) => { const key = dateKey(value); if (!key) throw bad("date must be a real date, for example 2026-03-14."); return key; },
  supplier_name: text(200),
  purpose: text(200),
  supplier_vat_id: digits(20),
  allocation_number: digits(20),
  document_number: text(60),
  net: money,
  vat: money,
  total: money,
  account: (value) => { if (!/^\d{3}$/.test(value)) throw bad("account must be a three-digit code."); return value; },
  vat_recognized_percent: oneOf([100, 66.67, 25, 0]),
  expense_recognized_percent: oneOf([100, 25, 0]),
  include: (value) => { if (!["true", "false"].includes(value)) throw bad("include must be true or false."); return value === "true"; },
  month: (value) => { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw bad("month must look like 2026-03."); return value; },
};

export default {
  name: "propose_change",
  description: "Suggest changes to rows that already exist (a correction of what the document says, another account, another month, include or exclude). Nothing changes until the user clicks apply. `value` is always text: a number as 123.45, a date as 2026-03-14, a yes/no as true or false.",
  schema: {
    type: "object",
    required: ["client", "title", "changes"],
    properties: {
      client: { type: "string", maxLength: 12, description: "Client handle." },
      title: { type: "string", minLength: 1, maxLength: 80, description: "Hebrew title of the card." },
      changes: {
        type: "array", minItems: 1, maxItems: 50,
        items: {
          type: "object", required: ["row", "field", "value", "reason"],
          properties: {
            row: { type: "string", maxLength: 12, description: "Row handle." },
            field: { type: "string", enum: Object.keys(FIELDS) },
            value: { type: "string", maxLength: 200 },
            reason: { type: "string", minLength: 1, maxLength: 300, description: "One Hebrew sentence." },
          },
        },
      },
    },
  },
  async run(args, ctx) {
    if (typeof ctx.ui.propose !== "function") throw new ToolError("unavailable", "There is no panel to show the proposal.");
    const client = ctx.handles.get("C", args.client);
    const chart = await ctx.services.clients.chart(client.clientId);
    const seen = new Set();
    const changes = [];
    for (const [index, change] of args.changes.entries()) {
      const where = `changes[${index}]`;
      const row = ctx.handles.get("R", change.row);
      if (row.clientId !== client.clientId) throw bad(`${where}: the row belongs to another client.`);
      const key = `${change.row}|${change.field}`;
      if (seen.has(key)) throw bad(`${where}: ${change.field} of ${change.row} is proposed twice.`);
      seen.add(key);
      await ctx.requireOpen(row.clientId, row.month);
      let value;
      try {
        value = FIELDS[change.field](change.value);
      } catch (error) {
        if (error instanceof ToolError) throw bad(`${where}: ${error.message}`);
        throw error;
      }
      if (change.field === "account" && !(value in chart)) throw bad(`${where}: the account ${value} is not in the client's chart.`);
      if (change.field === "month") await ctx.requireOpen(client.clientId, value);
      changes.push({ row: change.row, documentId: row.documentId, month: row.month, field: change.field, value, reason: change.reason });
    }
    const proposal = { client: { id: client.clientId, name: client.name }, title: args.title, changes };
    proposal.id = ctx.handles.create("P", crypto.randomUUID(), proposal);
    await ctx.ui.propose(proposal);
    return { proposal: proposal.id, count: changes.length };
  },
};
