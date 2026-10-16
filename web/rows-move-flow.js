// Moving rows of an open declaration to other months, with their source images, without any DOM:
// prepare (read the saved table, propose a month per row) and commit (write the target months, then the source).
import { createDeclaration, listDeclarations, loadDeclaration, readSourceImage, saveDraft, saveSourceImage } from "./declaration-store.js";
import { isPeriodDocument, intakeMonth } from "./intake-facts.js";
import { deductionStatus, lockedThrough, targetMonths } from "./month-distribution.js";

// Rows imported from Excel (or added from the ledger) were placed by the bookkeeper's own journals; they get no proposal.
const isIntakeRow = (row) => !String(row.documentId ?? "").startsWith("import-");
const pad = (number) => String(number).padStart(3, "0");
// Same date, code and gross amount: not proof of a duplicate (two identical purchases happen), but worth a look.
const signature = (row) => `${row.values?.[0] ?? ""}|${row.values?.[1] ?? ""}|${(Number(row.values?.[7]) || 0).toFixed(2)}`;

// `client` is { directory, config: { clientId } }. The table must be saved before: it is read from the file.
export async function prepareMove({ client, month, today = new Date() }) {
  const source = await loadDeclaration(client.directory, month);
  if (source.declaration.status !== "open") throw new Error("ההצהרה נעולה. לא ניתן להעביר ממנה שורות.");
  const declarations = (await listDeclarations(client.directory)).map(({ declaration }) => ({ month: declaration.month, status: declaration.status }));
  const locked = lockedThrough(declarations);
  // Rows of the other declarations, to warn when a row would land next to an identical one.
  const similar = new Map();
  for (const other of declarations.filter((declaration) => declaration.month !== month)) {
    for (const row of (await loadDeclaration(client.directory, other.month)).draft.rows) {
      if (row.active === false) continue;
      if (!similar.has(signature(row))) similar.set(signature(row), new Set());
      similar.get(signature(row)).add(other.month);
    }
  }
  const lines = source.draft.rows.map((row, index) => {
    const values = row.values ?? [];
    const intake = isIntakeRow(row);
    // A document for a period (annual insurance) goes to the month of receipt and has no VAT deduction window of its own.
    const period = isPeriodDocument(row.periodFrom, row.periodTo);
    const proposal = intake
      ? intakeMonth({ date: values[0], periodFrom: row.periodFrom, periodTo: row.periodTo, receivedAt: row.receivedAt, lockedThrough: locked, today })
      : { month: null, docMonth: null, reason: "none" };
    return {
      index,
      documentId: row.documentId ?? "",
      intake,
      date: String(values[0] ?? ""),
      code: String(values[1] ?? ""),
      text: String(values[3] || values[2] || ""),
      gross: Number(values[7]) || 0,
      vat: Number(values[9]) || 0,
      hasImage: Boolean(row.imageFile),
      signature: signature(row),
      current: month,
      proposed: proposal.month,
      docMonth: period ? null : proposal.docMonth,
      reason: proposal.reason,
    };
  });
  const months = targetMonths({ declarations, lockedThrough: locked, current: month, proposals: lines.map((line) => line.proposed), today });
  const existing = new Set(declarations.map((declaration) => declaration.month));
  return {
    month,
    lockedThrough: locked,
    lines,
    months: months.map((value) => ({ month: value, exists: existing.has(value) })),
    // What the dialog selects at the start: the proposal for intake rows, otherwise the row stays.
    suggested: (line) => (line.proposed && months.includes(line.proposed) ? line.proposed : line.current),
    deduction: (line, target) => (line.vat ? deductionStatus(line.docMonth, target) : "ok"),
    similar: (line, target) => similar.get(line.signature)?.has(target) ?? false,
  };
}

async function backupDraft(directory, draft, now) {
  const writable = await (await directory.getFileHandle(`draft-table.before-move-${now.replace(/[:.]/g, "-")}.json`, { create: true })).createWritable();
  try {
    await writable.write(JSON.stringify(draft, null, 2));
  } finally {
    await writable.close();
  }
}

async function imageExists(directory, name) {
  try {
    await (await directory.getDirectoryHandle("images")).getFileHandle(name);
    return true;
  } catch (error) {
    if (error.name === "NotFoundError") return false;
    throw error;
  }
}

// Gives each distinct source image of the moved rows the next free number in the target declaration.
async function copyImages(target, sourceImages, rows) {
  const names = new Map();
  let index = Math.max(0, ...target.draft.rows.map((row) => Number(row.imageIndex) || 0));
  const moved = [];
  for (const row of rows) {
    if (!row.imageFile) {
      moved.push({ ...row });
      continue;
    }
    if (!names.has(row.imageFile)) {
      const extension = /\.([A-Za-z0-9]+)$/.exec(row.imageFile)?.[1] ?? "jpg";
      do index += 1;
      while (await imageExists(target.directory, `${pad(index)}.${extension}`));
      names.set(row.imageFile, { file: `${pad(index)}.${extension}`, index });
      await saveSourceImage(target.directory, names.get(row.imageFile).file, sourceImages.get(row.imageFile));
    }
    const { file, index: imageIndex } = names.get(row.imageFile);
    moved.push({ ...row, imageFile: file, imageIndex });
  }
  return moved;
}

// `assignments` maps a line index of prepared.lines to its target month; lines left on prepared.month stay.
// Order: images and target tables first, the source table last, so an interruption duplicates rows instead of losing them.
export async function commitMove(prepared, { assignments, client, now = new Date().toISOString() }) {
  const source = await loadDeclaration(client.directory, prepared.month);
  if (source.declaration.status !== "open") throw new Error("ההצהרה נעולה. לא ניתן להעביר ממנה שורות.");
  if (source.draft.rows.length !== prepared.lines.length || prepared.lines.some((line) => (source.draft.rows[line.index]?.documentId ?? "") !== line.documentId)) {
    throw new Error("הטבלה השתנתה מאז פתיחת החלון. יש לפתוח אותו מחדש.");
  }
  const moves = new Map();
  for (const [index, target] of assignments) {
    if (target === prepared.month) continue;
    if (!prepared.months.some((option) => option.month === target)) throw new Error(`לא ניתן להעביר לחודש ${target}: הוא נעול או שקדם לחודש הנעול האחרון.`);
    if (!moves.has(target)) moves.set(target, []);
    moves.get(target).push(index);
  }
  if (!moves.size) return { moved: 0, months: [] };

  // Everything that can fail on reading is read before the first write.
  const sourceImages = new Map();
  for (const index of [...moves.values()].flat()) {
    const file = source.draft.rows[index].imageFile;
    if (!file || sourceImages.has(file)) continue;
    try {
      sourceImages.set(file, await readSourceImage(source.directory, file));
    } catch (error) {
      if (error.name === "NotFoundError") throw new Error(`התמונה ${file} חסרה בתיקיית ההצהרה. לא הועברה אף שורה.`);
      throw error;
    }
  }
  const targets = new Map();
  for (const month of moves.keys()) {
    let target;
    try {
      target = await loadDeclaration(client.directory, month);
    } catch (error) {
      if (error.name !== "NotFoundError") throw error;
      target = null;
    }
    if (target && target.declaration.status !== "open") throw new Error(`ההצהרה ${month} נעולה. לא ניתן להעביר אליה שורות.`);
    targets.set(month, target);
  }

  for (const month of [...moves.keys()].sort()) {
    const target = targets.get(month) ?? { ...(await createDeclaration(client.directory, { clientId: client.config.clientId, month })), draft: { rows: [] } };
    const moved = await copyImages(target, sourceImages, moves.get(month).sort((a, b) => a - b).map((index) => source.draft.rows[index]));
    if (target.draft.rows.length) await backupDraft(target.directory, target.draft, now);
    await saveDraft(target.directory, target.declaration, [...target.draft.rows, ...moved], now);
  }
  const gone = new Set([...moves.values()].flat());
  await backupDraft(source.directory, source.draft, now);
  await saveDraft(source.directory, source.declaration, source.draft.rows.filter((row, index) => !gone.has(index)), now);
  return { moved: gone.size, months: [...moves.keys()].sort() };
}
