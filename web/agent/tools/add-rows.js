// add_rows (docs/AGENT_TOOLS.md, 5.3): puts extracted documents into the monthly table as ordinary draft rows. The model gives a fact
// handle and a decision; every value of the row is copied by the code from the fact, the month, the exclusion, the recognition
// percentages and whether the row is "ready" are computed by the code. A row is rejected, not written, when its routing cannot be
// verified or its month is locked. Nothing is ever overwritten or deleted.
import { clickedOption } from "../answers.js";
import { digits, computeFacts } from "../facts.js";
import { ToolError } from "../errors.js";
import { entryFromRow } from "../../intake-facts.js";
import { buildRowSnapshot } from "../../row-builder.js";
import { AGENT_VERSION } from "../prompts.js";

const UNSORTED = "_unsorted";

// The proof that the document is for this client: the folder it was put in, the VAT number of the buyer, or a button of the user.
function verifyRouting(ctx, row, clientValue, factValue) {
  const { entry, record, file } = factValue;
  if (row.routed_by === "folder") {
    if (entry.folder === UNSORTED || entry.folder !== clientValue.folder) throw new ToolError("not_allowed", `The file is not in the inbox folder of this client (it is in ${entry.folder}).`);
  } else if (row.routed_by === "vat_id") {
    if (!digits(record.buyer_vat_id) || digits(record.buyer_vat_id) !== digits(clientValue.vatId)) throw new ToolError("not_allowed", "The VAT number of the buyer on the document is not the VAT number of this client.");
  } else {
    if (!row.routing_ask) throw new ToolError("invalid_argument", "routed_by user needs routing_ask.");
    if (clickedOption(ctx, row.routing_ask, file).clientId !== clientValue.clientId) throw new ToolError("not_allowed", "The user did not choose this client for this file.");
  }
}

async function addOne(ctx, clientHandle, clientValue, chart, row) {
  const done = ctx.run.addedFacts.get(row.fact);
  if (done) return { fact: row.fact, ...done, state: "already_added" };
  const factValue = ctx.handles.getFact(row.fact);
  const { entry, record } = factValue;
  verifyRouting(ctx, row, clientValue, factValue);
  let forcedMonth;
  if (row.month_override) {
    const choice = clickedOption(ctx, row.month_override.ask, factValue.file);
    if (choice.month !== row.month_override.month) throw new ToolError("not_allowed", "The user did not choose this month for this file.");
    forcedMonth = row.month_override.month;
  }

  const computed = await computeFacts(ctx, { fact: row.fact, client: clientHandle, ...(forcedMonth ? { month: forcedMonth } : {}) });
  const month = computed.facts.targetMonth;
  if (computed.output.month_state === "locked") throw new ToolError("locked", `The month ${month} is locked.`);
  if (computed.output.month_state === "missing") await ctx.services.declarations.create(clientValue.clientId, month);
  await ctx.requireOpen(clientValue.clientId, month);
  await ctx.ensureCopy(clientValue.clientId, month);

  const expense = row.decision === "expense";
  const accountRejected = expense && Boolean(row.account) && !(row.account in chart);
  const account = expense && row.account && !accountRejected ? row.account : null;
  const snapshot = buildRowSnapshot({
    record, entry, documentId: `agent-${entry.hash.slice(0, 16)}-p${record.page ?? 0}`, decision: row.decision, account, accountName: account ? chart[account].name : "",
    facts: computed.facts, kind: computed.profile.kind, month, reason: row.reason, needsReview: row.needs_review,
    agent: { run: ctx.run.id, version: AGENT_VERSION, fact: row.fact },
  });
  const [position] = await ctx.services.rows.append(clientValue.clientId, month, [snapshot]);
  const handle = ctx.handles.create("R", `${clientValue.clientId}|${month}|${position}`, { clientId: clientValue.clientId, month, documentId: snapshot.documentId, position });
  // The rows made in this run are seen by the next duplicate search, and a fact that became a row cannot be read again.
  if (snapshot.active) ctx.run.addedEntries.push(entryFromRow(snapshot, { month, position: position - 1 }));
  ctx.run.factsUsed.add(row.fact);
  const result = {
    row: handle, month, position, status: snapshot.statusClass === "ready" ? "ready" : "review", reasons: computed.facts.reasons, excluded: computed.facts.exclude,
    file: factValue.file, fileHash: entry.hash,
    ...(accountRejected ? { account_rejected: true, message: `The account ${row.account} is not in the chart of the client; the row has no account.` } : {}),
  };
  ctx.run.addedFacts.set(row.fact, result);
  const moved = Boolean(computed.facts.docMonth && computed.facts.docMonth !== month);
  return { fact: row.fact, ...result, state: moved ? "moved_month" : "created" };
}

// What the model sees: the internal keys of the stored result (file, fileHash) are left out.
const visible = ({ file, fileHash, ...rest }) => rest;

export default {
  name: "add_rows",
  exclusive: true, // see move_file_to_declaration
  description: "Put documents into the monthly table as draft rows, one per fact. You give the fact handle, the proof of the client (routed_by: folder when the file is in the inbox folder of this client, vat_id when the VAT number of the buyer on the document is the client's, user when the user clicked a button of an ask_user question about this file that carries this client), your decision (expense, not_expense, unclear), an account code of the client's chart for an expense, whether it needs a look, and a one-sentence Hebrew reason. The code copies every value from the fact, decides the month, excludes duplicates and documents of a previous year, applies the recognition percentages and sets the status; a row is ready only when nothing in the facts warns. Give month_override only when the user chose the month with a button (an ask_user option with that month).",
  schema: {
    type: "object",
    required: ["client", "rows"],
    properties: {
      client: { type: "string", maxLength: 12, description: "Client handle." },
      rows: {
        type: "array", minItems: 1, maxItems: 40,
        items: {
          type: "object", required: ["fact", "routed_by", "decision", "needs_review", "reason"],
          properties: {
            fact: { type: "string", maxLength: 12, description: "Fact handle, for example F1.1." },
            routed_by: { type: "string", enum: ["folder", "vat_id", "user"] },
            routing_ask: { type: "string", maxLength: 12, description: "Question handle, for routed_by user." },
            decision: { type: "string", enum: ["expense", "not_expense", "unclear"] },
            account: { type: "string", maxLength: 3, description: "Account code of the client chart; only for an expense." },
            needs_review: { type: "boolean" },
            reason: { type: "string", minLength: 1, maxLength: 300, description: "One Hebrew sentence." },
            month_override: {
              type: "object", required: ["month", "ask"],
              properties: { month: { type: "string", maxLength: 7 }, ask: { type: "string", maxLength: 12 } },
            },
          },
        },
      },
    },
  },
  async run(args, ctx) {
    const clientValue = ctx.handles.get("C", args.client);
    const { accounts: chart } = await ctx.services.clients.chart(clientValue.clientId);
    const results = [];
    // One after the other: a row made now is seen by the duplicate search of the next one.
    for (const row of args.rows) {
      try {
        results.push(visible(await addOne(ctx, args.client, clientValue, chart, row)));
      } catch (error) {
        if (error?.name === "AbortError") throw new ToolError("cancelled", "The run was cancelled.");
        const failure = error instanceof ToolError ? error : new ToolError("internal", "The row could not be added.");
        results.push({ fact: row.fact, state: "rejected", error: { code: failure.code, message: failure.message } });
      }
    }
    return { rows: results };
  },
};
