import { closeDeclaration, createDraftTable, createOpenDeclaration, normalizeDeclaration, normalizeDraftTable, reopenDeclaration, setDeclarationArchived } from "./declaration-core.js";

const declarationsName = "declarations", declarationFile = "declaration.json", draftFile = "draft-table.json", imagesName = "images", exportsName = "exports";

async function readJson(directory, name) { return JSON.parse(await (await directory.getFileHandle(name)).getFile().then((file) => file.text())); }
async function writeJson(directory, name, value) { const writable = await (await directory.getFileHandle(name, { create: true })).createWritable(); try { await writable.write(JSON.stringify(value, null, 2)); } finally { await writable.close(); } }

export async function getDeclarationDirectory(clientDirectory, month, { create = false } = {}) {
  const declarations = await clientDirectory.getDirectoryHandle(declarationsName, { create });
  return declarations.getDirectoryHandle(month, { create });
}

export async function createDeclaration(clientDirectory, options = {}) {
  const declaration = createOpenDeclaration(options), directory = await getDeclarationDirectory(clientDirectory, declaration.month, { create: true });
  try { await directory.getFileHandle(declarationFile); throw new Error("כבר קיימת הצהרה לחודש זה."); }
  catch (error) { if (error.name !== "NotFoundError") throw error; }
  await Promise.all([writeJson(directory, declarationFile, declaration), writeJson(directory, draftFile, createDraftTable({ declarationId: declaration.declarationId })), directory.getDirectoryHandle(imagesName, { create: true }), directory.getDirectoryHandle(exportsName, { create: true })]);
  return { directory, declaration };
}

export async function listDeclarations(clientDirectory) {
  let directory;
  try { directory = await clientDirectory.getDirectoryHandle(declarationsName); }
  catch (error) { if (error.name === "NotFoundError") return []; throw error; }
  const declarations = [];
  for await (const [month, handle] of directory.entries()) {
    if (handle.kind !== "directory") continue;
    try {
      const parsed = normalizeDeclaration(await readJson(handle, declarationFile));
      if (!parsed.valid || parsed.declaration.month !== month) continue;
      declarations.push({ directory: handle, declaration: parsed.declaration });
    } catch (error) { if (error.name !== "NotFoundError") throw error; }
  }
  return declarations.sort((left, right) => right.declaration.month.localeCompare(left.declaration.month));
}

export async function loadDeclaration(clientDirectory, month) {
  const directory = await getDeclarationDirectory(clientDirectory, month), metadata = normalizeDeclaration(await readJson(directory, declarationFile));
  if (!metadata.valid) throw new Error(metadata.error);
  const parsed = normalizeDraftTable(await readJson(directory, draftFile), metadata.declaration.declarationId); if (!parsed.valid) throw new Error(parsed.error);
  const draft = parsed.draft;
  return { directory, declaration: metadata.declaration, draft };
}

export async function archiveDeclaration(clientDirectory, month, archived) {
  const { directory, declaration } = await loadDeclaration(clientDirectory, month);
  const updated = setDeclarationArchived(declaration, archived);
  await writeJson(directory, declarationFile, updated);
  return updated;
}

export async function deleteDeclaration(clientDirectory, month) {
  const declarations = await clientDirectory.getDirectoryHandle(declarationsName);
  const target = await declarations.getDirectoryHandle(month);
  if (target.name !== month) throw new Error("תיקיית ההצהרה שנבחרה אינה תואמת.");
  await declarations.removeEntry(month, { recursive: true });
}

export async function saveDraft(declarationDirectory, declaration, rows, now = new Date().toISOString()) {
  if (declaration.status !== "open") throw new Error("לא ניתן לשמור טיוטה בהצהרה סגורה.");
  const draft = createDraftTable({ declarationId: declaration.declarationId, rows, now });
  await writeJson(declarationDirectory, draftFile, draft);
  return draft;
}

export async function saveSourceImage(declarationDirectory, filename, image) {
  const images = await declarationDirectory.getDirectoryHandle(imagesName, { create: true }), writable = await (await images.getFileHandle(filename, { create: true })).createWritable();
  try { await writable.write(image); } finally { await writable.close(); }
}

export async function readSourceImage(declarationDirectory, filename) {
  const images = await declarationDirectory.getDirectoryHandle(imagesName);
  return (await images.getFileHandle(filename)).getFile();
}

export async function createDraftExportDirectory(declarationDirectory, date = new Date()) {
  const exports = await declarationDirectory.getDirectoryHandle(exportsName, { create: true }), stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}_${String(date.getHours()).padStart(2, "0")}-${String(date.getMinutes()).padStart(2, "0")}`;
  for (let suffix = 0; suffix < 1000; suffix += 1) { const name = suffix ? `${stamp}_${String(suffix + 1).padStart(3, "0")}` : stamp; try { await exports.getDirectoryHandle(name); } catch (error) { if (error.name !== "NotFoundError") throw error; return { name, directory: await exports.getDirectoryHandle(name, { create: true }) }; } }
  throw new Error("לא ניתן ליצור תיקיית ייצוא נוספת.");
}

async function readHistoryText(clientDirectory) {
  try { return await (await clientDirectory.getFileHandle("history.jsonl")).getFile().then((file) => file.text()); } catch (error) { if (error.name === "NotFoundError") return ""; throw error; }
}
async function writeHistoryLines(clientDirectory, lines) {
  const writable = await (await clientDirectory.getFileHandle("history.jsonl", { create: true })).createWritable();
  try { await writable.write(lines.length ? lines.join("\n") + "\n" : ""); } finally { await writable.close(); }
}
const historyLinesWithout = (text, declarationId) => text.split(/\r?\n/).filter(Boolean).filter((line) => { try { return JSON.parse(line).declarationId !== declarationId; } catch { return true; } });

// Locks the declaration: its rows replace any earlier history entries of the same declaration (so a retry or a
// re-lock after reopening never duplicates them), then the declaration file is written.
export async function finalizeDeclaration({ clientDirectory, declarationDirectory, declaration, finalExport, rows, now = new Date().toISOString() }) {
  const lines = historyLinesWithout(await readHistoryText(clientDirectory), declaration.declarationId);
  for (const row of rows.filter((item) => item.active)) lines.push(JSON.stringify({ declarationId: declaration.declarationId, declarationMonth: declaration.month, finalizedAt: now, ...row }));
  await writeHistoryLines(clientDirectory, lines);
  const closed = closeDeclaration(declaration, { finalExport, now }); await writeJson(declarationDirectory, declarationFile, closed); return closed;
}

// Reopens a locked declaration with a reason. The declaration file is written first; the history entries of this
// declaration are then removed (they return when it is locked again).
export async function reopenLockedDeclaration({ clientDirectory, declarationDirectory, declaration, reason, now = new Date().toISOString() }) {
  const reopened = reopenDeclaration(declaration, { reason, now });
  await writeJson(declarationDirectory, declarationFile, reopened);
  const text = await readHistoryText(clientDirectory), lines = historyLinesWithout(text, declaration.declarationId);
  if (lines.length !== text.split(/\r?\n/).filter(Boolean).length) await writeHistoryLines(clientDirectory, lines);
  return reopened;
}

export async function readClosedHistory(clientDirectory) {
  try { return (await (await clientDirectory.getFileHandle("history.jsonl")).getFile()).text().then((text) => text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))); }
  catch (error) { if (error.name === "NotFoundError") return []; throw error; }
}
