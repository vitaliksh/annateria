// read_document (docs/AGENT_TOOLS.md, 5.1): look at what a file is without the vision call: the size of a photo, the pages and the
// text layer of a PDF, the first rows of a CSV or workbook. It never returns pixels: the orchestrator is text only.
import { ToolError } from "../errors.js";

export default {
  name: "read_document",
  description: "Inspect an inbox file without reading it with the vision model: size of a photo; pages and the text layer of a PDF (one page or from the start); sheet names and the first rows of a CSV or workbook. Returns text and numbers only, never the image.",
  schema: {
    type: "object",
    required: ["file"],
    properties: {
      file: { type: "string", maxLength: 12, description: "File handle from list_inbox." },
      page: { type: "integer", minimum: 1, maximum: 5000, description: "PDF page number." },
      max_chars: { type: "integer", minimum: 200, maximum: 20000, description: "Cap on the text returned (default 6000)." },
    },
  },
  async run(args, ctx) {
    const entry = ctx.handles.get("F", args.file);
    const maxChars = args.max_chars ?? 6000;
    let info;
    try {
      info = await ctx.services.documents.inspect(entry, { page: args.page, maxChars });
    } catch (error) {
      if (error?.name === "DocumentError") throw new ToolError(error.code === "page_out_of_range" ? "invalid_argument" : "unavailable", error.message);
      throw new ToolError("unavailable", "The file could not be read.");
    }
    if (args.page !== undefined && info.kind !== "pdf") throw new ToolError("invalid_argument", "page applies to PDF files only.");
    let truncated = false;
    let budget = maxChars;
    const cut = (text) => {
      if (text.length > budget) truncated = true;
      const kept = text.slice(0, Math.max(0, budget));
      budget -= kept.length;
      return kept;
    };
    const result = { file: args.file, ...info };
    if (info.text !== undefined) result.text = cut(info.text);
    if (info.sheets) result.sheets = info.sheets.map((sheet) => ({ ...sheet, text: cut(sheet.text) }));
    return { ...result, ...(truncated ? { truncated: true } : {}) };
  },
};
