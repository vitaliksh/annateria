// prepare_import (docs/AGENT_TOOLS.md, 5.6): an inbox file that the agent recognised as an import file is parsed and checked read-only,
// and the user gets a card with a button that opens the existing wizard with that file. The tool writes nothing and opens nothing: the
// wizard is opened by the click of the user, and it is the wizard that writes. The model is told counts and check results, never rows,
// names or amounts.
import { clickedOption } from "../answers.js";
import { ToolError } from "../errors.js";
import { kindOf } from "../kinds.js";

// The kinds built so far; income_report joins with step 4.7.5.
const KINDS = ["journal", "ledger_codes", "ledger_check"];
// The types of file each kind can be, and the wizard that the button of the card opens.
const FILE_KINDS = { journal: ["spreadsheet"], ledger_codes: ["pdf", "spreadsheet"], ledger_check: ["pdf", "spreadsheet"] };
const WIZARDS = { journal: "excel_import", ledger_codes: "ledger_codes", ledger_check: "ledger_check" };
const UNSORTED = "_unsorted";

// The proof that the file is for this client: the inbox folder it lies in, or a button of the user (as in add_rows).
function verifyRouting(ctx, args, client, entry) {
  if (args.routed_by === "folder") {
    if (entry.folder === UNSORTED || entry.folder !== client.folder) throw new ToolError("not_allowed", `The file is not in the inbox folder of this client (it is in ${entry.folder}).`);
    return;
  }
  if (!args.routing_ask) throw new ToolError("invalid_argument", "routed_by user needs routing_ask.");
  if (clickedOption(ctx, args.routing_ask, args.file).clientId !== client.clientId) throw new ToolError("not_allowed", "The user did not choose this client for this file.");
}

export default {
  name: "prepare_import",
  description: "For an inbox file that you recognised as an import file (read it with read_document first): parse and check it read-only and leave the user a card with the result and the button \"פתח אשף\", which opens the existing import wizard with that file. You write nothing and the wizard opens only when the user clicks. kind journal is a Rivhit journal workbook (\"יומן קליטה\", .xlsx) for the Excel import; kind ledger_codes is the classification-codes ledger of Rivhit (\"כרטסת קודי מיון\", PDF or .xlsx), whose codes become the client's own chart; kind ledger_check is the operations ledger of Rivhit (\"כרטסת\" with dated movements per code, PDF or .xlsx), checked against the declarations of its year (the dialog can add what is missing). Give the proof of the client (routed_by: folder when the file lies in the inbox folder of that client, user when the user clicked a button of an ask_user question about this file that carries this client) and a one-sentence Hebrew reason for the card. month (YYYY-MM, journal only) is only a suggestion for a file that has no month in its header. You get counts and check results back, never the rows. wrong_format means the file is not of that kind.",
  schema: {
    type: "object",
    required: ["file", "kind", "client", "routed_by", "reason"],
    properties: {
      file: { type: "string", maxLength: 12, description: "File handle from list_inbox." },
      kind: { type: "string", enum: KINDS },
      client: { type: "string", maxLength: 12, description: "Client handle." },
      routed_by: { type: "string", enum: ["folder", "user"] },
      routing_ask: { type: "string", maxLength: 12, description: "Question handle when routed_by is user." },
      month: { type: "string", maxLength: 7, description: "YYYY-MM, a suggestion." },
      reason: { type: "string", minLength: 1, maxLength: 300, description: "One Hebrew sentence: why you think this is that kind of file." },
    },
  },
  async run(args, ctx) {
    if (typeof ctx.ui.importCard !== "function") throw new ToolError("unavailable", "There is no panel to show the card.");
    const entry = ctx.handles.get("F", args.file);
    const client = ctx.handles.get("C", args.client);
    if (args.month !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(args.month)) throw new ToolError("invalid_argument", "month must look like 2026-03.");
    if (!FILE_KINDS[args.kind].includes(kindOf(entry))) throw new ToolError("invalid_argument", `kind ${args.kind} does not fit a file of this type (${kindOf(entry)}).`);
    verifyRouting(ctx, args, client, entry);

    const key = `${args.file}|${args.kind}|${client.clientId}`;
    const done = ctx.run.prepared.get(key);
    if (done) return { ...done, state: "already_prepared" };

    let found;
    try {
      found = await ctx.services.imports.prepare(entry, { kind: args.kind, clientId: client.clientId, month: args.month });
    } catch (error) {
      if (error?.name === "ImportError") throw new ToolError("wrong_format", error.message);
      if (error?.name === "AbortError") throw new ToolError("cancelled", "The run was cancelled.");
      throw new ToolError("unavailable", "The file could not be read.");
    }
    const { summary, checks, problems, totals } = found;
    const prepared = ctx.handles.create("I", key, { file: args.file, kind: args.kind, clientId: client.clientId });
    await ctx.ui.importCard({
      id: prepared, kind: args.kind, reason: args.reason, month: args.month ?? null, summary, checks, problems, totals,
      file: { name: entry.name, hash: entry.hash, folder: entry.folder }, client: { id: client.clientId, name: client.name },
    });
    const result = { prepared, kind: args.kind, month: summary.month, summary, checks, problems, wizard: WIZARDS[args.kind], card_shown: true };
    ctx.run.prepared.set(key, result);
    return { ...result, state: "prepared" };
  },
};
