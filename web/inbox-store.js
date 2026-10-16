// The inbox: originals dropped by the user wait in <data root>/inbox/<client folder>/ or inbox/_unsorted/ until the
// assistant (phase 4) moves them into a declaration. No AI is involved here. inbox/index.json records every file by its
// SHA-256, so the same bytes are never stored twice, neither in the inbox nor among the images of a declaration.
// The index is rewritten as a whole after every file: callers add files one batch at a time (no locking here).
const INBOX_NAME = "inbox", INDEX_NAME = "index.json", UNSORTED = "_unsorted", TRASH = "_trash";
const INDEX_VERSION = 1, HASH = /^[0-9a-f]{64}$/;
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/g;
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_STEM = 120;
const MIME_BY_EXTENSION = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif",
  pdf: "application/pdf", csv: "text/csv", xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export { UNSORTED, TRASH };

export const ACCEPTED_EXTENSIONS = Object.keys(MIME_BY_EXTENSION);

// null when the file may enter the inbox, otherwise the reason (Hebrew) for the user.
export function refusalReason(name) {
  const dot = String(name ?? "").lastIndexOf("."), extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (ACCEPTED_EXTENSIONS.includes(extension)) return null;
  return extension ? `סוג קובץ שאינו נתמך (.${extension})` : "קובץ ללא סיומת";
}

const hex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
export async function sha256Hex(bytes) { return hex(await crypto.subtle.digest("SHA-256", bytes)); }

// A file name that is safe in a Windows folder: no path, no forbidden characters, no trailing dot or space, not a
// device name, bounded length. The extension is kept.
export function safeFileName(name) {
  const base = String(name ?? "").split(/[\\/]/).pop().replace(FORBIDDEN, "-").replace(/^[\s]+/, "").replace(/[. ]+$/, "");
  const dot = base.lastIndexOf(".");
  let stem = dot > 0 ? base.slice(0, dot) : base;
  const extension = dot > 0 ? base.slice(dot) : "";
  stem = stem.replace(/[. ]+$/, "").slice(0, MAX_STEM).replace(/[. ]+$/, "");
  if (!stem) stem = "file";
  if (RESERVED_DEVICE.test(stem)) stem = "_" + stem;
  return stem + extension;
}

// "name (2).ext" when `name` is taken; the comparison ignores case because the data root lives on Windows.
function uniqueName(name, taken) {
  if (!taken.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf("."), stem = dot > 0 ? name.slice(0, dot) : name, extension = dot > 0 ? name.slice(dot) : "";
  for (let number = 2; ; number += 1) {
    const candidate = `${stem} (${number})${extension}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

// A client folder name is the client's directory name in clients/. The two reserved names cannot be clients.
export function isInboxFolder(name) {
  if (name === UNSORTED) return true;
  if (typeof name !== "string" || !name || name !== name.trim() || /[\\/:*?"<>|\u0000-\u001f]/.test(name)) return false;
  if (name.endsWith(".") || name === "." || name === "..") return false;
  return ![UNSORTED, TRASH].includes(name.toLowerCase());
}

async function inboxDirectory(dataRoot) { return dataRoot.getDirectoryHandle(INBOX_NAME, { create: true }); }

// Creates inbox/_unsorted/ and one folder per client. Names that cannot be folders are skipped and returned.
export async function ensureInbox(dataRoot, clientFolders = []) {
  const inbox = await inboxDirectory(dataRoot), skipped = [];
  await inbox.getDirectoryHandle(UNSORTED, { create: true });
  for (const name of clientFolders) {
    if (isInboxFolder(name)) await inbox.getDirectoryHandle(name, { create: true });
    else skipped.push(name);
  }
  return { skipped };
}

function checkEntry(entry) {
  const text = (value) => typeof value === "string" && value !== "";
  return entry && typeof entry === "object" && HASH.test(entry.hash) && text(entry.name) && text(entry.storedName)
    && text(entry.folder) && Number.isInteger(entry.size) && entry.size > 0 && typeof entry.type === "string"
    && (entry.sourceDate === null || text(entry.sourceDate)) && text(entry.addedAt);
}

// `trashed` (optional) records what moved to inbox/_trash/: the entry as it was, plus trashedName and trashedAt.
function checkTrashed(trashed) {
  const text = (value) => typeof value === "string" && value !== "";
  return trashed === undefined || (Array.isArray(trashed) && trashed.every((entry) => checkEntry(entry) && text(entry.trashedName) && text(entry.trashedAt)));
}

// Missing index = empty. An unreadable or newer index is an error: replacing it would lose the hashes.
export async function readInboxIndex(dataRoot) {
  let text;
  try {
    const inbox = await dataRoot.getDirectoryHandle(INBOX_NAME);
    text = await (await (await inbox.getFileHandle(INDEX_NAME)).getFile()).text();
  } catch (error) {
    if (error.name === "NotFoundError") return { schemaVersion: INDEX_VERSION, files: [] };
    throw error;
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error("קובץ האינדקס של תיבת הקלט אינו תקין (inbox/index.json)."); }
  if (parsed?.schemaVersion > INDEX_VERSION) throw new Error("אינדקס תיבת הקלט נוצר בגרסה חדשה יותר של התוכנה.");
  if (parsed?.schemaVersion !== INDEX_VERSION || !Array.isArray(parsed.files) || !parsed.files.every(checkEntry) || !checkTrashed(parsed.trashed)) {
    throw new Error("קובץ האינדקס של תיבת הקלט אינו תקין (inbox/index.json).");
  }
  return parsed;
}

async function writeInboxIndex(inbox, index) {
  const writable = await (await inbox.getFileHandle(INDEX_NAME, { create: true })).createWritable();
  try { await writable.write(JSON.stringify(index, null, 2)); } finally { await writable.close(); }
}

// SHA-256 of the images of every declaration of every client whose size is in `sizes`. Equal bytes mean equal size,
// so only files of a matching size are read. Returns Map(hash -> { client, month, file }).
export async function declarationImageHashes(dataRoot, sizes) {
  const found = new Map();
  let clients;
  try { clients = await dataRoot.getDirectoryHandle("clients"); } catch (error) { if (error.name === "NotFoundError") return found; throw error; }
  const child = async (directory, name) => {
    try { return await directory.getDirectoryHandle(name); } catch (error) { if (error.name === "NotFoundError") return null; throw error; }
  };
  for await (const [client, clientHandle] of clients.entries()) {
    if (clientHandle.kind !== "directory") continue;
    const declarations = await child(clientHandle, "declarations");
    if (!declarations) continue;
    for await (const [month, declarationHandle] of declarations.entries()) {
      if (declarationHandle.kind !== "directory") continue;
      const images = await child(declarationHandle, "images");
      if (!images) continue;
      for await (const [file, handle] of images.entries()) {
        if (handle.kind !== "file") continue;
        const source = await handle.getFile();
        if (!sizes.has(source.size)) continue;
        const hash = await sha256Hex(await source.arrayBuffer());
        if (!found.has(hash)) found.set(hash, { client, month, file });
      }
    }
  }
  return found;
}

async function directoryNames(directory) {
  const names = new Set();
  for await (const [name] of directory.entries()) names.add(name.toLowerCase());
  return names;
}

const sourceDateOf = (file) => Number.isFinite(file.lastModified) && file.lastModified > 0
  ? new Date(file.lastModified).toISOString().slice(0, 10) : null;
const typeOf = (file, name) => file.type || MIME_BY_EXTENSION[name.split(".").pop().toLowerCase()] || "application/octet-stream";

// Writes the bytes and reads them back: an original that did not arrive intact must not be recorded.
async function storeFile(directory, storedName, bytes) {
  try {
    const writable = await (await directory.getFileHandle(storedName, { create: true })).createWritable();
    try { await writable.write(bytes); } finally { await writable.close(); }
    const back = await (await directory.getFileHandle(storedName)).getFile();
    if (back.size !== bytes.length || await sha256Hex(await back.arrayBuffer()) !== await sha256Hex(bytes)) {
      throw new Error("הקובץ שנכתב אינו זהה למקור.");
    }
  } catch (error) {
    await directory.removeEntry?.(storedName).catch(() => {});
    throw error;
  }
}

// Adds files (File objects) to inbox/<folder>/. Returns
//   added:      index entries of the stored files,
//   duplicates: { name, reason: "inbox" | "declaration", of } for bytes that were already seen,
//   failed:     { name, error } for files that could not be stored (the rest of the batch continues).
export async function addToInbox(dataRoot, files, { folder = UNSORTED, now = new Date().toISOString() } = {}) {
  if (!isInboxFolder(folder)) throw new Error("שם תיקייה לא חוקי בתיבת הקלט.");
  await ensureInbox(dataRoot);
  const inbox = await inboxDirectory(dataRoot), directory = await inbox.getDirectoryHandle(folder, { create: true });
  const index = await readInboxIndex(dataRoot), byHash = new Map(index.files.map((entry) => [entry.hash, entry]));
  const declarationHashes = await declarationImageHashes(dataRoot, new Set(files.map((file) => file.size)));
  const taken = await directoryNames(directory), result = { added: [], duplicates: [], failed: [] };
  for (const file of files) {
    const name = String(file.name ?? "").trim() || "file";
    try {
      if (!file.size) throw new Error("הקובץ ריק.");
      const bytes = new Uint8Array(await file.arrayBuffer()), hash = await sha256Hex(bytes);
      if (byHash.has(hash)) { result.duplicates.push({ name, reason: "inbox", of: byHash.get(hash) }); continue; }
      if (declarationHashes.has(hash)) { result.duplicates.push({ name, reason: "declaration", of: declarationHashes.get(hash) }); continue; }
      const storedName = uniqueName(safeFileName(name), taken);
      await storeFile(directory, storedName, bytes);
      taken.add(storedName.toLowerCase());
      const entry = { hash, name, storedName, folder, size: bytes.length, type: typeOf(file, name), sourceDate: sourceDateOf(file), addedAt: now };
      index.files.push(entry);
      try { await writeInboxIndex(inbox, index); } catch (error) {
        index.files.pop();
        taken.delete(storedName.toLowerCase());
        await directory.removeEntry?.(storedName).catch(() => {});
        throw error;
      }
      byHash.set(hash, entry);
      result.added.push(entry);
    } catch (error) {
      result.failed.push({ name, error: error.message });
    }
  }
  return result;
}

// Files waiting per folder: { total, byFolder: { <folder>: n } }. The trash is not counted.
export function inboxCounts(index) {
  const byFolder = {};
  for (const entry of index.files) byFolder[entry.folder] = (byFolder[entry.folder] ?? 0) + 1;
  return { total: index.files.length, byFolder };
}

// The stored file of an index entry (a File), for thumbnails and, later, for reading by the assistant.
export async function readInboxFile(dataRoot, entry) {
  const inbox = await dataRoot.getDirectoryHandle(INBOX_NAME), directory = await inbox.getDirectoryHandle(entry.folder);
  return (await directory.getFileHandle(entry.storedName)).getFile();
}

const isMissing = (error) => error?.name === "NotFoundError";

// Moves the files with these hashes to inbox/_trash/ and drops them from the index (so the same bytes can be added again);
// the record stays in index.trashed. Nothing is deleted for good: a file is removed from its folder only after the copy in the
// trash was read back and the index was written. Returns
//   moved:   the entries that were moved,
//   missing: entries whose file was no longer on disk (they are only dropped from the index),
//   failed:  { name, error } for files that stay where they are (or, when the original could not be removed, are in both places).
export async function moveToTrash(dataRoot, hashes, { now = new Date().toISOString() } = {}) {
  const inbox = await inboxDirectory(dataRoot), trash = await inbox.getDirectoryHandle(TRASH, { create: true });
  const index = await readInboxIndex(dataRoot), taken = await directoryNames(trash);
  const result = { moved: [], missing: [], failed: [] };
  for (const hash of new Set(hashes)) {
    const entry = index.files.find((item) => item.hash === hash);
    if (!entry) continue;
    const before = { files: index.files, trashed: index.trashed };
    let directory = null, trashedName = null;
    try {
      let bytes = null;
      try {
        directory = await inbox.getDirectoryHandle(entry.folder);
        bytes = new Uint8Array(await (await (await directory.getFileHandle(entry.storedName)).getFile()).arrayBuffer());
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      index.files = index.files.filter((item) => item !== entry);
      if (bytes) {
        trashedName = uniqueName(safeFileName(entry.storedName), taken);
        await storeFile(trash, trashedName, bytes);
        index.trashed = [...(index.trashed ?? []), { ...entry, trashedName, trashedAt: now }];
      }
      await writeInboxIndex(inbox, index);
      if (!bytes) { result.missing.push(entry); continue; }
      taken.add(trashedName.toLowerCase());
      result.moved.push(entry);
    } catch (error) {
      Object.assign(index, before);
      if (trashedName) await trash.removeEntry?.(trashedName).catch(() => {});
      result.failed.push({ name: entry.name, error: error.message });
      continue;
    }
    try {
      await directory.removeEntry(entry.storedName);
    } catch (error) {
      result.moved.pop();
      result.failed.push({ name: entry.name, error: "הועתק לפח, אך הקובץ המקורי לא הוסר מהתיקייה." });
    }
  }
  return result;
}
