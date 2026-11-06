// Reads what the intake rules need from a client folder: the active rows of every declaration (locked ones included) in
// the form the duplicate search uses, and the last locked month. The rules themselves are in intake-facts.js.
import { listDeclarations, loadDeclaration } from "./declaration-store.js";
import { entryFromRow } from "./intake-facts.js";
import { lockedThrough } from "./month-distribution.js";

// skipMonths: declarations the caller supplies from memory (the open table has rows that are not saved yet).
export async function loadIntakeContext(clientDirectory, { skipMonths = [] } = {}) {
  const found = await listDeclarations(clientDirectory);
  const declarations = found.map(({ declaration }) => ({ month: declaration.month, status: declaration.status }));
  const entries = [];
  for (const { month, status } of declarations) {
    if (skipMonths.includes(month)) continue;
    const { draft } = await loadDeclaration(clientDirectory, month);
    draft.rows.forEach((row, position) => {
      // A line of moved VAT is no document: its source row is the one a duplicate is found by (step 9.8).
      if (row.active !== false && !row.vatMovedFrom) entries.push(entryFromRow(row, { month, status, position }));
    });
  }
  return { entries, declarations, lockedThrough: lockedThrough(declarations) };
}
