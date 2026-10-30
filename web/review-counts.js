// Rows to look at in every open declaration of every client (docs/UI_REDESIGN_PROPOSAL.md, C7), read from the saved tables, so that
// the clients home, the sidebar and the strip "ממתין לך" show them without opening each month. The rule is the toolbar's
// (needsLook), applied to a saved row as the page would draw it (restoreRow in app.js).
import { loadDeclaration } from "./declaration-store.js";
import { needsLook } from "./journal-toolbar.js";

// A saved row of draft-table.json. A row that is not the agent's, active and without marked regions is drawn "to look at"
// ("מוכן, חסרים סימונים") whatever it saved; a possible duplicate is found only on drawing, so it is not counted here.
export function savedRowNeedsLook(saved) {
  const needsMarks = Boolean(saved.active) && !(saved.highlights ?? []).length && !saved.agent;
  const status = needsMarks ? "review" : saved.statusClass || (saved.active ? "ready" : "review");
  return needsLook({ flagged: status === "review", excluded: !saved.active, image: Boolean(saved.imageFile), leftOut: saved.agent?.leftOut === true });
}

// clients: the active clients of the workspace ({ id, directory, declarations: [{ declaration }] }). Resolves with
// [{ clientId, month, count }] of the open declarations that have rows to look at, by month. A table that cannot be read is skipped.
export async function reviewCounts(clients, { load = loadDeclaration } = {}) {
  const found = [];
  for (const client of clients ?? []) {
    const open = (client.declarations ?? []).map((item) => item.declaration).filter((item) => item && item.status === "open" && !item.archived);
    for (const { month } of open) {
      try {
        const count = ((await load(client.directory, month)).draft?.rows ?? []).filter(savedRowNeedsLook).length;
        if (count) found.push({ clientId: client.id, month, count });
      } catch {
        /* a broken table is told where it is opened */
      }
    }
  }
  return found.sort((a, b) => a.month.localeCompare(b.month));
}
