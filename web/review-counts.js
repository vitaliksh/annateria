// Rows, and rows to look at, in every declaration of every client (docs/UI_REDESIGN_PROPOSAL.md, C7), read from the saved tables, so
// that the clients home, the sidebar and the strip "ממתין לך" show them without opening each month. The rule is the toolbar's
// (needsLook), applied to a saved row as the page would draw it (restoreRow in app.js).
import { loadDeclaration } from "./declaration-store.js";
import { needsLook } from "./journal-toolbar.js";

// A saved row of draft-table.json. A row that is not the agent's, active and without marked regions is drawn "to look at"
// ("מוכן, חסרים סימונים") whatever it saved, unless the user marked it checked; a possible duplicate is found only on drawing, so it is not counted here.
export function savedRowNeedsLook(saved) {
  const needsMarks = Boolean(saved.active) && !(saved.highlights ?? []).length && !saved.agent && !saved.reviewedFrom;
  const status = needsMarks ? "review" : saved.statusClass || (saved.active ? "ready" : "review");
  return needsLook({ flagged: status === "review", excluded: !saved.active, image: Boolean(saved.imageFile), leftOut: saved.agent?.leftOut === true });
}

// clients: the active clients of the workspace ({ id, directory, declarations: [{ declaration }] }). Resolves with
// [{ clientId, month, status, total, review }] of every declaration that is not archived, closed ones too: the rows of its table and
// the rows to look at (the owner, 11 November 2026: the sidebar shows both beside every month). A table that cannot be read is skipped.
export async function tableCounts(clients, { load = loadDeclaration } = {}) {
  const found = [];
  for (const client of clients ?? []) {
    const declarations = (client.declarations ?? []).map((item) => item.declaration).filter((item) => item && !item.archived);
    for (const { month, status } of declarations) {
      try {
        const rows = (await load(client.directory, month)).draft?.rows ?? [];
        found.push({ clientId: client.id, month, status: status === "open" ? "open" : "locked", total: rows.length, review: rows.filter(savedRowNeedsLook).length });
      } catch {
        /* a broken table is told where it is opened */
      }
    }
  }
  return found.sort((a, b) => a.month.localeCompare(b.month));
}

// [{ clientId, month, count }] of the open declarations that have rows to look at, by month (the strip "ממתין לך" and the clients home).
export const openReview = (counts) => counts.filter((item) => item.status === "open" && item.review > 0)
  .map(({ clientId, month, review }) => ({ clientId, month, count: review }));

export async function reviewCounts(clients, options = {}) {
  return openReview(await tableCounts(clients, options));
}
