// move_file_to_declaration (docs/AGENT_TOOLS.md, 5.3): after the rows of a file exist, the original goes to the images of the declaration
// and the rows get it. The copy is read back and compared before anything else happens; only after the rows have their image does the
// original leave the inbox. A file that has no row is never moved. Nothing in a declaration is deleted.
import { ToolError } from "../errors.js";

export default {
  name: "move_file_to_declaration",
  exclusive: true, // several calls in one turn must not write the same draft and index at the same time
  description: "After add_rows: give the rows made from a file their original. The file is copied into the images of the declaration of every month that holds a row of it (give all of those months), the copy is checked, the rows get the image, and the file leaves the inbox. A file without a row is not moved.",
  schema: {
    type: "object",
    required: ["file", "client", "months"],
    properties: {
      file: { type: "string", maxLength: 12, description: "File handle." },
      client: { type: "string", maxLength: 12, description: "Client handle." },
      months: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", maxLength: 7 }, description: "Every month YYYY-MM that has a row made from this file." },
    },
  },
  async run(args, ctx) {
    const entry = ctx.handles.get("F", args.file);
    const clientValue = ctx.handles.get("C", args.client);
    if (ctx.run.fileStatus.get(args.file) === "filed") return { file: args.file, state: "already_filed" };
    const wanted = [...new Set(args.months)].sort();
    if (wanted.some((month) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) throw new ToolError("invalid_argument", "months must look like 2026-03.");

    // The rows of this file that this run made, and the months they are in.
    const made = [...ctx.run.addedFacts.values()].filter((item) => item.fileHash === entry.hash && item.row && ctx.handles.get("R", item.row).clientId === clientValue.clientId);
    if (!made.length) throw new ToolError("conflict", "No row of this file was made in this run, so the file is not moved.");
    const holding = [...new Set(made.map((item) => item.month))].sort();
    const missing = holding.filter((month) => !wanted.includes(month));
    if (missing.length) throw new ToolError("invalid_argument", `Rows of this file are also in ${missing.join(", ")}: give all the months.`);
    const stray = wanted.filter((month) => !holding.includes(month));
    if (stray.length) throw new ToolError("conflict", `No row of this file is in ${stray.join(", ")}.`);
    for (const month of wanted) await ctx.requireOpen(clientValue.clientId, month);

    const images = [];
    try {
      for (const month of wanted) images.push({ month, ...(await ctx.services.files.copyToDeclaration(entry, clientValue.clientId, month)) });
      let rows = 0;
      for (const image of images) rows += await ctx.services.rows.attachImage(clientValue.clientId, image.month, entry.hash, { imageFile: image.imageFile, imageIndex: image.imageIndex });
      await ctx.services.files.moveOutOfInbox(entry);
      ctx.run.fileStatus.set(args.file, "filed");
      return { file: args.file, state: "filed", images: images.map(({ month, imageFile }) => ({ month, image_file: imageFile })), rows, inbox_removed: true };
    } catch (error) {
      if (error instanceof ToolError) throw error;
      if (error?.name === "AbortError") throw new ToolError("cancelled", "The run was cancelled.");
      throw new ToolError("unavailable", "The file could not be moved; it stays in the inbox.");
    }
  },
};
