// move_file_to_declaration (docs/AGENT_TOOLS.md, 5.3): after the rows of a file exist, the original goes to the images of the
// declaration of the run's month (step 9.6: the only month the rows can be in) and the rows get it. The copy is read back and
// compared before anything else happens; only after the rows have their image does the original leave the inbox. A file that has no
// row is never moved. Nothing in a declaration is deleted. A document of the file that has no row yet gets one first
// (addMissingRows): nothing that came in is lost (Anna, 25 October 2026).
import { ToolError } from "../errors.js";
import { addMissingRows } from "./add-rows.js";

export default {
  name: "move_file_to_declaration",
  exclusive: true, // several calls in one turn must not write the same draft and index at the same time
  description: "After add_rows: give the rows made from a file their original. The file is copied into the images of the declaration of the open month, the copy is checked, the rows get the image, and the file leaves the inbox. A file without a row is not moved. Every document of the file that has no row yet is first added by the code as an inactive row to look at (added_for_review), so that nothing that came in is lost.",
  schema: {
    type: "object",
    required: ["file"],
    properties: {
      file: { type: "string", maxLength: 12, description: "File handle." },
    },
  },
  async run(args, ctx) {
    const entry = ctx.handles.get("F", args.file);
    if (ctx.run.fileStatus.get(args.file) === "filed") return { file: args.file, state: "already_filed" };

    // The rows of this file that this run made: all in the client and month of the run.
    const made = [...ctx.run.addedFacts.values()].filter((item) => item.fileHash === entry.hash && item.row);
    if (!made.length) throw new ToolError("conflict", "No row of this file was made in this run, so the file is not moved.");
    const clientValue = ctx.handles.get("C", made[0].client);
    const month = ctx.scope?.month ?? null;
    await ctx.requireRunMonth(clientValue.clientId, month);

    let addedForReview;
    try {
      addedForReview = await addMissingRows(ctx, args.file, made[0].client);
    } catch (error) {
      if (error?.name === "AbortError") throw new ToolError("cancelled", "The run was cancelled.");
      const reason = error instanceof ToolError ? error.message : "a row could not be written";
      throw new ToolError("conflict", `A document of this file could not get a row (${reason}), so the file stays in the inbox.`);
    }
    const images = [];
    try {
      images.push({ month, ...(await ctx.services.files.copyToDeclaration(entry, clientValue.clientId, month)) });
      let rows = 0;
      for (const image of images) rows += await ctx.services.rows.attachImage(clientValue.clientId, image.month, entry.hash, { imageFile: image.imageFile, imageIndex: image.imageIndex });
      await ctx.services.files.moveOutOfInbox(entry);
      ctx.run.fileStatus.set(args.file, "filed");
      return {
        file: args.file, state: "filed", rows, inbox_removed: true,
        images: images.map(({ month, imageFile }) => ({ month, image_file: imageFile })),
        ...(addedForReview.length ? { added_for_review: addedForReview } : {}),
      };
    } catch (error) {
      if (error instanceof ToolError) throw error;
      if (error?.name === "AbortError") throw new ToolError("cancelled", "The run was cancelled.");
      // The original left the inbox after it was read (the user removed it while the run was working): nothing was copied.
      if (!images.length && error?.name === "NotFoundError") {
        throw new ToolError("not_found", "The file is no longer in the inbox (it was removed during the run), so it was not moved and its rows have no original.");
      }
      throw new ToolError("unavailable", "The file could not be moved; it stays in the inbox.");
    }
  },
};
