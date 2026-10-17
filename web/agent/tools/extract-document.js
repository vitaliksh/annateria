// extract_document (docs/AGENT_TOOLS.md, 5.2): turn one inbox file into fact records through the vision call. The records are
// validated, cleaned and stored for the run; from then on they are immutable, and add_rows (4.4) takes a fact handle, never values.
import { ToolError } from "../errors.js";
import { RECORD_SCHEMA, normalizeRecord } from "../fact-record.js";
import { kindOf } from "../kinds.js";
import { validate } from "../schema.js";

// What the adapter and the model client throw, as the model should hear it.
function asToolError(error) {
  if (error instanceof ToolError) return error;
  if (error?.name === "AbortError") return new ToolError("cancelled", "The run was cancelled.");
  if (error?.name === "NotFoundError") return new ToolError("not_found", "The file is listed in the inbox but is not in its folder any more.");
  if (error?.name === "ExtractionError") return new ToolError(["too_large", "unsupported_type"].includes(error.code) ? "invalid_argument" : "unavailable", error.message);
  if (error?.name === "ModelError") return new ToolError("unavailable", `The model did not answer (${error.code}).`);
  return new ToolError("unavailable", "The file could not be read.");
}

function present(file, state, ctx) {
  const documents = state.facts.map((fact) => ({ fact, ...ctx.handles.getFact(fact).record }));
  return {
    file, model: state.model, documents,
    ...(documents.length ? {} : { note: "no financial document found in this file" }),
    ...(state.skipped ? { skipped: state.skipped } : {}),
  };
}

export default {
  name: "extract_document",
  description: "Read one inbox file with the vision model and get its facts: kind, date, period, supplier, buyer, document number, allocation number, amounts, confidence and issues. One file can hold several documents. A file is read once per run (a second call returns the same facts); model strong re-reads it once with the stronger model, only if no row was made from the first reading. The facts are final: you cannot change them.",
  schema: {
    type: "object",
    required: ["file"],
    properties: {
      file: { type: "string", maxLength: 12, description: "File handle from list_inbox." },
      hint: { type: "string", maxLength: 200, description: "The user's own words about the file, if any." },
      model: { type: "string", enum: ["default", "strong"] },
    },
  },
  async run(args, ctx) {
    const entry = ctx.handles.get("F", args.file);
    const kind = kindOf(entry);
    if (kind === "spreadsheet") throw new ToolError("not_allowed", "Spreadsheets are not processed by the agent; the user imports them with the Excel import.");
    const strong = args.model === "strong";
    const stored = ctx.run.extractions.get(args.file);
    if (stored && !strong) return present(args.file, stored, ctx);
    if (stored && stored.tries >= ctx.limits.extractionsPerFile) throw new ToolError("limit_reached", "This file was already read twice.");
    if (stored && stored.facts.some((fact) => ctx.run.factsUsed.has(fact))) throw new ToolError("conflict", "Rows were already made from the first reading of this file.");
    if (ctx.run.extractCount >= ctx.limits.extractions) throw new ToolError("limit_reached", "No more extractions are allowed in this run.");

    ctx.run.extractCount += 1;
    let result;
    try {
      result = await ctx.run.extractSlots(() => ctx.services.extraction.run(entry, { hint: args.hint ?? "", strong, signal: ctx.signal }));
    } catch (error) {
      throw asToolError(error);
    }
    const records = [];
    let skipped = 0;
    for (const raw of result.records) {
      const checked = validate(RECORD_SCHEMA, raw, "record");
      if (checked.ok) records.push(normalizeRecord(checked.value, { isImage: kind === "image" }));
      else skipped += 1;
    }
    if (!records.length && skipped) throw new ToolError("unavailable", "The answer of the model was not valid. Try again, or use the strong model.");

    if (stored) ctx.handles.dropFacts(args.file);
    const facts = records.map((record, index) => ctx.handles.createFact(args.file, index + 1, { file: args.file, entry, record }));
    const state = { tries: (stored?.tries ?? 0) + 1, facts, skipped, model: strong ? "strong" : "default" };
    ctx.run.extractions.set(args.file, state);
    ctx.run.fileStatus.set(args.file, "extracted");
    return present(args.file, state, ctx);
  },
};
