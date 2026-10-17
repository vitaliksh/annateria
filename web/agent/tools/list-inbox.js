// list_inbox (docs/AGENT_TOOLS.md, 5.1): what is waiting in inbox/. Registers a handle F<n> for every file it shows.
import { kindOf } from "../kinds.js";

const PAGE_BYTES = 15000;

export default {
  name: "list_inbox",
  description: "List the files waiting in the inbox: handle, name, folder (a client folder or _unsorted), kind, size, source date, and the state in this run. Spreadsheets are listed; they are never read with the vision model (use read_document).",
  schema: {
    type: "object",
    properties: {
      folder: { type: "string", maxLength: 120, description: "A client folder name or _unsorted." },
      kind: { type: "string", enum: ["image", "pdf", "spreadsheet", "other"] },
      status: { type: "string", enum: ["waiting", "extracted", "filed"] },
      limit: { type: "integer", minimum: 1, maximum: 200 },
      next: { type: "string", maxLength: 12, description: "The `next` value of the previous page." },
    },
  },
  async run(args, ctx) {
    const index = await ctx.services.inbox.readIndex();
    const all = index.files.map((entry) => {
      const handle = ctx.handles.create("F", entry.hash, entry);
      ctx.run.listed.set(handle, { name: entry.name, folder: entry.folder, kind: kindOf(entry) });
      return { entry, handle, status: ctx.run.fileStatus.get(handle) ?? "waiting" };
    });
    const counts = { total: all.length, waiting: all.filter((item) => item.status === "waiting").length, byFolder: {} };
    for (const { entry } of all) counts.byFolder[entry.folder] = (counts.byFolder[entry.folder] ?? 0) + 1;
    const wanted = all.filter(({ entry, status }) => (!args.folder || entry.folder === args.folder) && (!args.kind || kindOf(entry) === args.kind) && (!args.status || status === args.status));
    const start = Number.parseInt(args.next ?? "0", 10) || 0;
    const files = [];
    let size = 0;
    for (const { entry, handle, status } of wanted.slice(start, start + (args.limit ?? 50))) {
      const kind = kindOf(entry);
      const row = {
        file: handle, name: entry.name, folder: entry.folder, kind, size_kb: Math.max(1, Math.round(entry.size / 1024)),
        source_date: entry.sourceDate, added_at: entry.addedAt, status, ...(kind === "spreadsheet" ? { note: "spreadsheet: not extracted; read it with read_document to see what it is" } : {}),
      };
      size += JSON.stringify(row).length;
      if (files.length && size > PAGE_BYTES) break;
      files.push(row);
    }
    const end = start + files.length;
    return { counts, files, ...(end < wanted.length ? { next: String(end) } : {}) };
  },
};
