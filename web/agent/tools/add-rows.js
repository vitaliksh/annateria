// add_rows (docs/AGENT_TOOLS.md, 5.3): puts extracted documents into the monthly table as ordinary draft rows. The model gives a fact
// handle and a decision; every value of the row is copied by the code from the fact, the exclusion, the recognition percentages and
// whether the row is "ready" are computed by the code. Every row goes into the one client and month of the run (step 9.6): what the
// facts doubt (another buyer, a date of another month or year, a duplicate) marks the row to look at and never moves it. A row is
// rejected, not written, when the run has no open month. Nothing is ever overwritten or deleted. Every document of a file that is
// filed ends in the table (addMissingRows, Anna, 25 October 2026): what the agent left out becomes an inactive row to look at.
import { computeFacts } from "../facts.js";
import { ToolError } from "../errors.js";
import { entryFromRow } from "../../intake-facts.js";
import { buildRowSnapshot } from "../../row-builder.js";
import { AGENT_VERSION } from "../prompts.js";

// The row always goes into the month of the run; requireRunMonth refuses a run without one, another client and a locked month.
async function addOne(ctx, clientHandle, clientValue, chart, row) {
  const done = ctx.run.addedFacts.get(row.fact);
  if (done) return { fact: row.fact, ...done, state: "already_added" };
  const factValue = ctx.handles.getFact(row.fact);
  const { entry, record } = factValue;
  const month = ctx.scope?.month ?? null;
  await ctx.requireRunMonth(clientValue.clientId, month);
  const computed = await computeFacts(ctx, { fact: row.fact, client: clientHandle, month });
  await ctx.ensureCopy(clientValue.clientId, month);

  const expense = row.decision === "expense";
  const accountRejected = expense && Boolean(row.account) && !(row.account in chart);
  const account = expense && row.account && !accountRejected ? row.account : null;
  const snapshot = buildRowSnapshot({
    record, entry, documentId: `agent-${entry.hash.slice(0, 16)}-p${record.page ?? 0}`, decision: row.decision, account, accountName: account ? chart[account].name : "",
    facts: computed.facts, kind: computed.profile.kind, month, reason: row.reason, needsReview: row.needs_review,
    agent: { run: ctx.run.id, version: AGENT_VERSION, skills: { ...ctx.skills }, fact: row.fact, ...(row.left_out ? { leftOut: true } : {}) },
  });
  const [position] = await ctx.services.rows.append(clientValue.clientId, month, [snapshot]);
  const handle = ctx.handles.create("R", `${clientValue.clientId}|${month}|${position}`, { clientId: clientValue.clientId, month, documentId: snapshot.documentId, position });
  // The rows made in this run are seen by the next duplicate search, and a fact that became a row cannot be read again.
  if (snapshot.active) ctx.run.addedEntries.push(entryFromRow(snapshot, { month, position: position - 1 }));
  ctx.run.factsUsed.add(row.fact);
  const result = {
    row: handle, month, position, status: snapshot.statusClass === "ready" ? "ready" : "review", reasons: computed.facts.reasons, excluded: computed.facts.exclude,
    file: factValue.file, fileHash: entry.hash, clientId: clientValue.clientId, client: clientHandle,
    ...(accountRejected ? { account_rejected: true, message: `The account ${row.account} is not in the chart of the client; the row has no account.` } : {}),
  };
  ctx.run.addedFacts.set(row.fact, result);
  return { fact: row.fact, ...result, state: "created" };
}

// What the model sees: the internal keys of the stored result (file, fileHash, clientId, client) are left out.
const visible = ({ file, fileHash, clientId, client, ...rest }) => rest;

const LEFT_OUT_REASON = "המסמך לא נקלט על ידי הסוכן ונוסף כדי שלא יאבד: יש לבדוק ולהחליט אם להפעיל אותו.";

// Before a file is filed for a client: every document of the file that has no row yet in this run gets one in that client's table,
// decision unclear (no account, so inactive) and marked to look at, in the month of the run. Resolves with [{ fact, row, month }];
// throws when a row cannot be written.
export async function addMissingRows(ctx, fileHandle, clientHandle) {
  const facts = ctx.run.extractions.get(fileHandle)?.facts ?? [];
  const missing = facts.filter((fact) => !ctx.run.addedFacts.has(fact));
  if (!missing.length) return [];
  const clientValue = ctx.handles.get("C", clientHandle);
  const { accounts: chart } = await ctx.services.clients.chart(clientValue.clientId);
  const added = [];
  for (const fact of missing) {
    // left_out marks the row for the table, which counts it under "לבדיקה" although it is off.
    const row = { fact, decision: "unclear", needs_review: true, reason: LEFT_OUT_REASON, left_out: true };
    const result = await addOne(ctx, clientHandle, clientValue, chart, row);
    added.push({ fact, row: result.row, month: result.month });
    ctx.run.leftOut.push(fact);
  }
  return added;
}

export default {
  name: "add_rows",
  exclusive: true, // see move_file_to_declaration
  description: "Put documents into the table of the open month as draft rows, one per fact. client is the handle of the open client (the first line of the run names it); every row goes into the open month, whatever the document says. You give the fact handle, your decision (expense, not_expense, unclear), an account code of the client's chart for an expense, whether it needs a look, and a one-sentence Hebrew reason. The code copies every value from the fact, excludes duplicates and documents of a previous year, applies the recognition percentages and sets the status; a row is ready only when nothing in the facts warns (another buyer, a date after the month, a deduction window at risk or a possible duplicate mark it to look at).",
  schema: {
    type: "object",
    required: ["client", "rows"],
    properties: {
      client: { type: "string", maxLength: 12, description: "Client handle." },
      rows: {
        type: "array", minItems: 1, maxItems: 40,
        items: {
          type: "object", required: ["fact", "decision", "needs_review", "reason"],
          properties: {
            fact: { type: "string", maxLength: 12, description: "Fact handle, for example F1.1." },
            decision: { type: "string", enum: ["expense", "not_expense", "unclear"] },
            account: { type: "string", maxLength: 3, description: "Account code of the client chart; only for an expense." },
            needs_review: { type: "boolean" },
            reason: { type: "string", minLength: 1, maxLength: 300, description: "One Hebrew sentence." },
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
