// Step 9.8: the VAT of a row moved to a future month, without any DOM. The row stays in its month with VAT 0; the chosen month gets a
// line of its own with that VAT and net 0, so that the VAT counts in the chosen month and the document's amounts count once. The line
// is written by the code only and changes or goes only through its source row. Any other month than the one on screen is closed again
// at once: only the month on screen stays open (step 9.3).
import { NO_EXPORT_MARKER, VAT_MOVE_REOPEN_REASON } from "./declaration-core.js";
import { createDeclaration, finalizeDeclaration, loadDeclaration, readSourceImage, reopenLockedDeclaration, saveDraft } from "./declaration-store.js";
import { nextMonth } from "./month-distribution.js";
import { formatMonth } from "./month-format.js";
import { copyImages } from "./rows-move-flow.js";

// How far ahead the list of the column goes.
const MONTHS_AHEAD = 12;

// The month of the table first, then the months after it.
export function vatMonths(month) {
  const months = [month];
  while (months.length <= MONTHS_AHEAD) months.push(nextMonth(months.at(-1)));
  return months;
}

// `source`: the saved form of the row (rowSnapshot). vat: the VAT that moves, as text with two decimals. The gross and the net stay on
// the source row, so that every total counts the document once.
export function movedLine(source, { id, fromMonth, vat, now = new Date().toISOString() }) {
  const values = source.values ?? [];
  // What the reports need of the document itself: its net at 100 % with the sign of the row (the PCN874 line of a moved purchase
  // reports it) and the page of its PDF.
  const shownNet = Number(values[8]) || 0;
  const documentNet = Number(source.rawNet) || shownNet;
  const net = String(shownNet < 0 && documentNet > 0 ? -documentNet : documentNet);
  const page = source.agent?.page;
  return {
    documentId: `vatmove-${id}`,
    imageIndex: Number(source.imageIndex) || 0,
    imageFile: source.imageFile || "",
    receivedAt: now,
    values: [...values.slice(0, 7), "0.00", "0.00", vat, "100", "100"],
    rawNet: "0",
    rawVat: vat,
    vatPercent: "0",
    form6111Code: source.form6111Code || "",
    documentKind: source.documentKind || "",
    reference: source.reference || "",
    documentTitle: source.documentTitle || "",
    highlights: [],
    active: true,
    booked: true,
    ...(source.sourceHash ? { sourceHash: source.sourceHash } : {}),
    agentOpinion: `מע״מ מועבר מ-${formatMonth(fromMonth)}`,
    confidence: "",
    statusText: "מע״מ מועבר",
    statusClass: "ready",
    vatMovedFrom: { id, month: fromMonth, net, ...(page ? { page } : {}) },
  };
}

async function backupDraft(directory, draft, now) {
  const writable = await (await directory.getFileHandle(`draft-table.before-vat-move-${now.replace(/[:.]/g, "-")}.json`, { create: true })).createWritable();
  try {
    await writable.write(JSON.stringify(draft, null, 2));
  } finally {
    await writable.close();
  }
}

// The chosen month as it is, or null when it has no declaration.
async function loadTarget(clientDirectory, month) {
  try {
    return await loadDeclaration(clientDirectory, month);
  } catch (error) {
    if (error.name === "NotFoundError") return null;
    throw error;
  }
}

// Writes `rows` into a month that may be closed and leaves it closed.
async function writeAndClose(clientDirectory, target, rows, now) {
  const declaration = target.declaration.status === "open"
    ? target.declaration
    : await reopenLockedDeclaration({ clientDirectory, declarationDirectory: target.directory, declaration: target.declaration, reason: VAT_MOVE_REOPEN_REASON, now });
  await saveDraft(target.directory, declaration, rows, now);
  await finalizeDeclaration({ clientDirectory, declarationDirectory: target.directory, declaration, finalExport: NO_EXPORT_MARKER, rows, now });
}

// `client`: { directory, config: { clientId } }. sourceDirectory: the declaration of the row, for its original. A copy of the old table of
// the chosen month is kept. An original that is gone does not stop the move.
export async function addMovedLine({ client, sourceDirectory, toMonth, line, now = new Date().toISOString() }) {
  const target = (await loadTarget(client.directory, toMonth))
    ?? { ...(await createDeclaration(client.directory, { clientId: client.config.clientId, month: toMonth })), draft: { rows: [] } };
  const images = new Map();
  let written = line;
  if (line.imageFile) {
    try {
      images.set(line.imageFile, await readSourceImage(sourceDirectory, line.imageFile));
      [written] = await copyImages(target, images, [line]);
    } catch (error) {
      if (error.name !== "NotFoundError") throw error;
      written = { ...line, imageFile: "", imageIndex: 0 };
    }
  }
  if (target.draft.rows.length) await backupDraft(target.directory, target.draft, now);
  await writeAndClose(client.directory, target, [...target.draft.rows, written], now);
}

// Resolves with false when the month has no such line (a journal replaced its table, say). The original stays in the month's images:
// nothing in a declaration's images is deleted.
export async function removeMovedLine({ client, month, id, now = new Date().toISOString() }) {
  const target = await loadTarget(client.directory, month);
  const rows = target?.draft.rows ?? [];
  const kept = rows.filter((row) => row.vatMovedFrom?.id !== id);
  if (kept.length === rows.length) return false;
  await backupDraft(target.directory, target.draft, now);
  await writeAndClose(client.directory, target, kept, now);
  return true;
}
