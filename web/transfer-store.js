// Transfer file (.annateria): one client with all its months, or a single month, in ONE file that goes by USB drive, e-mail or any
// folder. The file is sealed (AES-GCM) with the backup key, so a mail server or a lost drive reveals nothing.
//   "ANNATERIA-TRANSFER-1\n" + sealed( [4-byte length][JSON meta][image bytes in meta order] )
// Importing only adds: new months are created, rows that are not there yet (by documentId) are appended to an open month, a locked
// month is copied only when this PC has no such month, and nothing existing is ever replaced.
import { sealBytes, unsealBytes } from "./backup-store.js";
import { createDraftTable, normalizeDeclaration } from "./declaration-core.js";
import { createDeclaration, getDeclarationDirectory, listDeclarations, loadDeclaration, readClosedHistory, readSourceImage, saveDraft, saveSourceImage } from "./declaration-store.js";
import { normalizeClientTaxProfile, normalizeWorkspaceConfig } from "./workspace-core.js";

export const TRANSFER_FORMAT = 2;
export const TRANSFER_EXTENSION = ".annateria";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAGIC = encoder.encode("ANNATERIA-TRANSFER-1\n");
const AAD = encoder.encode("annateria-transfer");

const MESSAGES = {
  TRANSFER_NOT_FILE: "זה אינו קובץ העברה של ANNATERIA.",
  TRANSFER_WRONG_KEY: "קוד השחזור אינו מתאים לקובץ, או שהקובץ פגום.",
  TRANSFER_CORRUPT: "הקובץ פגום.",
  TRANSFER_NEWER: "הקובץ נוצר בגרסה חדשה יותר של התוכנה.",
  TRANSFER_EMPTY: "אין מה לייצא.",
  TRANSFER_BAD_CLIENT: "פרטי הלקוח בקובץ אינם תקינים.",
};

function transferError(code) {
  return Object.assign(new Error(MESSAGES[code]), { name: "TransferError", code });
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function writeJsonFile(directory, name, value) {
  const writable = await (await directory.getFileHandle(name, { create: true })).createWritable();
  try {
    await writable.write(JSON.stringify(value, null, 2));
  } finally {
    await writable.close();
  }
}

// ---- export ----

// Reads a client from disk. `months` is a list of "YYYY-MM" or null for all of them; images only when asked.
export async function collectClient({ clientDirectory, config, months = null, includeImages = false, now = new Date().toISOString() }) {
  const wanted = months ? new Set(months) : null;
  const history = await readClosedHistory(clientDirectory);
  const found = (await listDeclarations(clientDirectory)).filter(({ declaration }) => !wanted || wanted.has(declaration.month));
  found.sort((a, b) => a.declaration.month.localeCompare(b.declaration.month));
  const collected = [];
  let missingImages = 0;
  for (const { declaration } of found) {
    const { directory, draft } = await loadDeclaration(clientDirectory, declaration.month);
    const images = [];
    if (includeImages) {
      for (const file of new Set(draft.rows.map((row) => row.imageFile).filter(Boolean))) {
        try {
          images.push({ file, bytes: new Uint8Array(await (await readSourceImage(directory, file)).arrayBuffer()) });
        } catch (error) {
          if (error.name !== "NotFoundError") throw error;
          missingImages += 1;
        }
      }
    }
    const closed = declaration.status === "closed";
    collected.push({ month: declaration.month, declaration, rows: draft.rows, history: closed ? history.filter((entry) => entry.declarationId === declaration.declarationId) : [], images });
  }
  if (!collected.length) throw transferError("TRANSFER_EMPTY");
  const client = { clientName: config.clientName, businessActivity: config.businessActivity, businessKind: config.businessKind, ...normalizeClientTaxProfile(config) };
  return { kind: months?.length === 1 ? "month" : "client", createdAt: now, client, months: collected, missingImages };
}

// Total size of the source images of the chosen months (a hint before the file is saved).
export async function imagesSize(clientDirectory, months = null) {
  let total = 0;
  for (const { declaration } of await listDeclarations(clientDirectory)) {
    if (months && !months.includes(declaration.month)) continue;
    try {
      const images = await (await getDeclarationDirectory(clientDirectory, declaration.month)).getDirectoryHandle("images");
      for await (const [, handle] of images.entries()) if (handle.kind === "file") total += (await handle.getFile()).size;
    } catch (error) {
      if (error.name !== "NotFoundError") throw error;
    }
  }
  return total;
}

export async function encodeTransfer(key, collected) {
  const meta = {
    format: TRANSFER_FORMAT,
    kind: collected.kind,
    createdAt: collected.createdAt,
    client: collected.client,
    months: collected.months.map(({ month, declaration, rows, history, images }) => ({
      month, status: declaration.status, declaration, rows, history, images: images.map(({ file, bytes }) => ({ file, size: bytes.length })),
    })),
  };
  const metaBytes = encoder.encode(JSON.stringify(meta));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, metaBytes.length);
  const body = concat([length, metaBytes, ...collected.months.flatMap((month) => month.images.map((image) => image.bytes))]);
  return concat([MAGIC, await sealBytes(key, body, AAD)]);
}

// ---- reading a file ----

// { meta, images: Map("YYYY-MM/file" -> bytes) }
export async function decodeTransfer(key, bytes) {
  if (bytes.length < MAGIC.length || MAGIC.some((byte, index) => bytes[index] !== byte)) throw transferError("TRANSFER_NOT_FILE");
  let body;
  try {
    body = await unsealBytes(key, bytes.subarray(MAGIC.length), AAD, "transfer");
  } catch {
    throw transferError("TRANSFER_WRONG_KEY");
  }
  try {
    const metaLength = new DataView(body.buffer, body.byteOffset, 4).getUint32(0);
    const meta = JSON.parse(decoder.decode(body.subarray(4, 4 + metaLength)));
    if (meta.format > TRANSFER_FORMAT) throw transferError("TRANSFER_NEWER");
    const images = new Map();
    let offset = 4 + metaLength;
    for (const month of meta.months) {
      for (const { file, size } of month.images) {
        images.set(`${month.month}/${file}`, body.slice(offset, offset + size));
        offset += size;
      }
    }
    if (offset !== body.length) throw transferError("TRANSFER_CORRUPT");
    return { meta, images };
  } catch (error) {
    throw error.name === "TransferError" ? error : transferError("TRANSFER_CORRUPT");
  }
}

// Counts for the dialog.
export function describeTransfer({ meta }) {
  return {
    kind: meta.kind,
    clientName: meta.client.clientName,
    months: meta.months.map(({ month, status, rows, images }) => ({ month, status, rows: rows.length, images: images.length })),
    rows: meta.months.reduce((sum, month) => sum + month.rows.length, 0),
    images: meta.months.reduce((sum, month) => sum + month.images.length, 0),
  };
}

// ---- import ----

const imageName = (index, original) => `${String(index).padStart(3, "0")}${/\.[A-Za-z0-9]+$/.exec(original)?.[0] ?? ".jpg"}`;
const knownId = (row) => (row.documentId && row.documentId !== "saved" ? row.documentId : "");

async function tryLoad(clientDirectory, month) {
  try {
    return await loadDeclaration(clientDirectory, month);
  } catch (error) {
    if (error.name === "NotFoundError") return null;
    throw error;
  }
}

// Rows of the package whose image bytes are present keep an image (renumbered from `counter`); the others lose the reference.
function placeImages(rows, month, images, counter, renumber) {
  const renamed = new Map();
  const placed = rows.map((row) => {
    if (!row.imageFile) return { ...row };
    const bytes = images.get(`${month}/${row.imageFile}`);
    if (!bytes) return { ...row, imageFile: "" };
    if (!renamed.has(row.imageFile)) {
      if (renumber) counter += 1;
      renamed.set(row.imageFile, { bytes, index: renumber ? counter : row.imageIndex, file: renumber ? imageName(counter, row.imageFile) : row.imageFile });
    }
    const { index, file } = renamed.get(row.imageFile);
    return { ...row, imageFile: file, imageIndex: index };
  });
  return { placed, renamed };
}

async function appendHistory(clientDirectory, entries) {
  if (!entries.length) return;
  let text = "";
  try {
    text = await (await (await clientDirectory.getFileHandle("history.jsonl")).getFile()).text();
  } catch (error) {
    if (error.name !== "NotFoundError") throw error;
  }
  const lines = text.split(/\r?\n/).filter(Boolean);
  // A retry after an interrupted copy must not write the same declaration's history twice.
  const have = new Set(lines.map((line) => { try { return JSON.parse(line).declarationId; } catch { return ""; } }));
  const fresh = entries.filter((entry) => !have.has(entry.declarationId));
  if (!fresh.length) return;
  for (const entry of fresh) lines.push(JSON.stringify(entry));
  const writable = await (await clientDirectory.getFileHandle("history.jsonl", { create: true })).createWritable();
  try {
    await writable.write(`${lines.join("\n")}\n`);
  } finally {
    await writable.close();
  }
}

// A locked month that this PC does not have: copied exactly as it was (same declaration, rows, images and history lines).
async function copyLockedMonth({ clientDirectory, clientId, entry, images, now }) {
  const parsed = normalizeDeclaration({ ...entry.declaration, clientId });
  if (!parsed.valid || parsed.declaration.month !== entry.month || parsed.declaration.status !== "closed") return { month: entry.month, action: "skipped-invalid" };
  const directory = await getDeclarationDirectory(clientDirectory, entry.month, { create: true });
  const { placed, renamed } = placeImages(entry.rows, entry.month, images, 0, false);
  await directory.getDirectoryHandle("images", { create: true });
  await directory.getDirectoryHandle("exports", { create: true });
  for (const [, { file, bytes }] of renamed) await saveSourceImage(directory, file, bytes);
  await writeJsonFile(directory, "draft-table.json", createDraftTable({ declarationId: parsed.declaration.declarationId, rows: placed, now }));
  await appendHistory(clientDirectory, entry.history);
  await writeJsonFile(directory, "declaration.json", parsed.declaration);
  return { month: entry.month, action: "copied-locked", added: placed.length, duplicates: 0, images: renamed.size };
}

// Adds the rows that are not there yet to the open month (created when missing).
async function addToOpenMonth({ clientDirectory, clientId, entry, images, now, loaded }) {
  let target = loaded;
  let created = false;
  if (!target) {
    target = { ...(await createDeclaration(clientDirectory, { clientId, month: entry.month })), draft: { rows: [] } };
    created = true;
  }
  const existing = target.draft?.rows ?? [];
  const present = new Set(existing.map(knownId).filter(Boolean));
  const fresh = entry.rows.filter((row) => !knownId(row) || !present.has(knownId(row)));
  const counter = Math.max(0, ...existing.map((row) => Number(row.imageIndex) || 0));
  const { placed, renamed } = placeImages(fresh, entry.month, images, counter, true);
  for (const [, { file, bytes }] of renamed) await saveSourceImage(target.directory, file, bytes);
  if (placed.length) await saveDraft(target.directory, target.declaration, [...existing, ...placed], now);
  return { month: entry.month, action: created ? "created" : "appended", added: placed.length, duplicates: entry.rows.length - fresh.length, images: renamed.size };
}

// Returns one result per month: created | appended | copied-locked | skipped-locked | skipped-invalid.
export async function importTransfer({ clientDirectory, clientId, decoded, now = new Date().toISOString() }) {
  const results = [];
  for (const entry of decoded.meta.months) {
    const loaded = await tryLoad(clientDirectory, entry.month);
    if (loaded && loaded.declaration.status !== "open") results.push({ month: entry.month, action: "skipped-locked" });
    else if (!loaded && entry.status === "closed") results.push(await copyLockedMonth({ clientDirectory, clientId, entry, images: decoded.images, now }));
    else results.push(await addToOpenMonth({ clientDirectory, clientId, entry, images: decoded.images, now, loaded }));
  }
  return results;
}

// ---- a client that this PC does not have yet ----

const directoryName = (name) => name.replace(/[\\/:*?"<>|]/g, "-").replace(/[. ]+$/, "").replace(/\s+/g, " ").trim();

async function directoryExists(parent, name) {
  try {
    await parent.getDirectoryHandle(name);
    return true;
  } catch (error) {
    if (error.name === "NotFoundError") return false;
    throw error;
  }
}

export async function createClient(dataRoot, client) {
  const result = normalizeWorkspaceConfig({ ...client, clientId: crypto.randomUUID(), archived: false });
  const base = result.valid ? directoryName(result.config.clientName) : "";
  if (!base) throw transferError("TRANSFER_BAD_CLIENT");
  const parent = await dataRoot.getDirectoryHandle("clients", { create: true });
  let name = base;
  for (let n = 2; await directoryExists(parent, name); n += 1) name = `${base} (${n})`;
  const directory = await parent.getDirectoryHandle(name, { create: true });
  await writeJsonFile(directory, "workspace.json", result.config);
  return { directory, config: result.config };
}
