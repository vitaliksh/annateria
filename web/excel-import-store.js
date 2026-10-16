// Writes imported draft rows into a declaration. A declaration that already has rows is only replaced on request.
import { IMPORT_FINAL_EXPORT } from "./excel-import.js";
import { createDeclaration, finalizeDeclaration, loadDeclaration, saveDraft } from "./declaration-store.js";

// What the import would find for a month: no declaration, an empty open one, one with rows, or a closed one.
export async function inspectImportTarget(clientDirectory, month) {
  try {
    const { declaration, draft } = await loadDeclaration(clientDirectory, month);
    const count = draft.rows.length;
    return { state: declaration.status !== "open" ? "closed" : count ? "rows" : "empty", count };
  } catch (error) {
    if (error.name === "NotFoundError") return { state: "missing", count: 0 };
    throw error;
  }
}

// Replacing keeps the old table next to it, so a mistaken replace can be undone by hand.
async function backupDraft(directory, draft, now) {
  const stamp = (now ?? new Date().toISOString()).replace(/[:.]/g, "-");
  const writable = await (await directory.getFileHandle(`draft-table.before-import-${stamp}.json`, { create: true })).createWritable();
  try {
    await writable.write(JSON.stringify(draft, null, 2));
  } finally {
    await writable.close();
  }
}

async function openTarget(clientDirectory, clientId, month, { replace, now }) {
  let loaded;
  try {
    loaded = await loadDeclaration(clientDirectory, month);
  } catch (error) {
    if (error.name !== "NotFoundError") throw error;
    return createDeclaration(clientDirectory, { clientId, month });
  }
  if (loaded.declaration.status !== "open") throw new Error("ההצהרה לחודש זה נעולה. לא ניתן לייבא אליה.");
  if (loaded.draft.rows.length) {
    if (!replace) throw new Error("ההצהרה לחודש זה כבר מכילה שורות. לא ניתן לייבא אליה.");
    await backupDraft(loaded.directory, loaded.draft, now);
  }
  return loaded;
}

// `rows` come from buildImportedRows. With closeNow the declaration is closed without an export folder.
export async function importRowsIntoDeclaration({ clientDirectory, clientId, month, rows, closeNow = false, replace = false, now }) {
  if (!rows.length) throw new Error("אין שורות לייבוא.");
  const { directory, declaration } = await openTarget(clientDirectory, clientId, month, { replace, now });
  await saveDraft(directory, declaration, rows, now);
  if (!closeNow) return declaration;
  return finalizeDeclaration({
    clientDirectory,
    declarationDirectory: directory,
    declaration,
    finalExport: IMPORT_FINAL_EXPORT,
    rows,
    now,
  });
}
