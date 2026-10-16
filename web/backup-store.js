// Encrypted, hash-addressed backup store written into a folder the user picked (format: docs/BACKUP_SPEC.md).
// Every file is written once and never overwritten (a sync client such as Google Drive makes overwrites fail), data goes
// into packs of ~16 MB (many tiny files are very slow on Drive), and the snapshot file is written last as the commit point.
export const BACKUP_FORMAT = 1;
export const STORE_DIR = "annateria-backup";
export const DEFAULT_PACK_BYTES = 16 * 1024 * 1024;

const IV_BYTES = 12;
const RETRYABLE = new Set(["InvalidStateError", "NoModificationAllowedError"]);
const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const AAD_KEY = encoder.encode("annateria-key");
const AAD_INDEX = encoder.encode("annateria-index");
const AAD_SNAPSHOT = encoder.encode("annateria-snapshot");
// Declaration folders that are heavy and not needed to continue the work; included only on request.
const HEAVY_DIRECTORY = /^clients\/[^/]+\/declarations\/[^/]+\/(images|exports)\/$/;
const SNAPSHOT_NAME = /^snap-(\d{8})T(\d{6})Z-[0-9a-f]+\.bin$/;

const MESSAGES = {
  BACKUP_NO_STORE: "לא נמצא גיבוי בתיקייה שנבחרה. יש לבחור את התיקייה שמכילה את annateria-backup, או את annateria-backup עצמה.",
  BACKUP_WRONG_KEY: "קוד השחזור אינו מתאים לגיבוי הזה.",
  BACKUP_BAD_CODE: "קוד השחזור אינו תקין. בדוק את התווים.",
  BACKUP_CORRUPT: "הגיבוי פגום או חסר",
  BACKUP_NOT_EMPTY: "תיקיית היעד אינה ריקה.",
  BACKUP_NO_SNAPSHOT: "הגיבוי שנבחר לא נמצא.",
  BACKUP_NEWER_FORMAT: "הגיבוי נוצר בגרסה חדשה יותר של התוכנה.",
  BACKUP_EXISTS: "הקובץ כבר קיים בגיבוי; קבצי גיבוי נכתבים פעם אחת בלבד.",
};

function backupError(code, detail = "") {
  return Object.assign(new Error(detail ? `${MESSAGES[code]}: ${detail}` : MESSAGES[code]), { name: "BackupError", code });
}

const defaultDelay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
}

async function sha256Hex(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- recovery code: 256 random bits in Crockford base32, 4 check characters, groups of four ----

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toBase32(bytes) {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return bits ? out + BASE32[(value << (5 - bits)) & 31] : out;
}

function fromBase32(text) {
  const out = [];
  let bits = 0;
  let value = 0;
  for (const char of text) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(out);
}

function checkChars(bytes) {
  const top = crc32(bytes) >>> 12;
  return [15, 10, 5, 0].map((shift) => BASE32[(top >>> shift) & 31]).join("");
}

export function newRecoveryCode() {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return `${toBase32(raw)}${checkChars(raw)}`.match(/.{4}/g).join("-");
}

// Returns the 32 key bytes; typos are caught by the check characters.
export function parseRecoveryCode(text) {
  const clean = String(text ?? "").toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (clean.length !== 56 || [...clean].some((char) => !BASE32.includes(char))) throw backupError("BACKUP_BAD_CODE");
  const raw = fromBase32(clean.slice(0, 52));
  if (raw.length !== 32 || checkChars(raw) !== clean.slice(52)) throw backupError("BACKUP_BAD_CODE");
  return raw;
}

// A key created from the recovery code is not extractable, so it can be kept in IndexedDB without exposing the bytes.
export function importBackupKey(raw, { extractable = false } = {}) {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", extractable, ["encrypt", "decrypt"]);
}

export const keyFromRecoveryCode = (code, options) => importBackupKey(parseRecoveryCode(code), options);

// ---- sealing: iv || AES-GCM ciphertext, bound to a purpose (and for blobs to their content hash) ----

async function seal(key, plain, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, plain));
  return concat([iv, cipher]);
}

async function unseal(key, sealed, aad, what) {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.subarray(0, IV_BYTES), additionalData: aad }, key, sealed.subarray(IV_BYTES)));
  } catch {
    throw backupError("BACKUP_CORRUPT", what);
  }
}

// ---- folder helpers ----

async function readBytes(directory, name) {
  return new Uint8Array(await (await (await directory.getFileHandle(name)).getFile()).arrayBuffer());
}

async function exists(directory, name) {
  try {
    await directory.getFileHandle(name);
    return true;
  } catch (error) {
    if (error.name === "NotFoundError") return false;
    throw error;
  }
}

async function writeBytes(directory, name, bytes) {
  const writable = await (await directory.getFileHandle(name, { create: true })).createWritable();
  try {
    await writable.write(bytes);
  } finally {
    await writable.close();
  }
}

// Write once, then read back and compare; the sync-client errors seen on Google Drive are retried with a growing pause.
async function writeOnce(directory, name, bytes, delay = defaultDelay) {
  if (await exists(directory, name)) throw backupError("BACKUP_EXISTS", name);
  const expected = await sha256Hex(bytes);
  let last;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await writeBytes(directory, name, bytes);
      const back = await readBytes(directory, name);
      if (back.length !== bytes.length || (await sha256Hex(back)) !== expected) throw backupError("BACKUP_CORRUPT", name);
      return;
    } catch (error) {
      last = error;
      if (!RETRYABLE.has(error.name)) throw error;
      await delay(300 * attempt);
    }
  }
  throw last;
}

async function listNames(directory) {
  const names = [];
  for await (const [name, handle] of directory.entries()) if (handle.kind === "file") names.push(name);
  return names.sort();
}

const stampOf = (iso) => iso.replace(/[-:]/g, "").replace(/\.\d+/, "");

// The same sealing and write-once helpers serve the transfer file (transfer-store.js).
export { seal as sealBytes, unseal as unsealBytes, writeOnce as writeFileOnce, readBytes as readFileBytes, listNames as listFileNames, randomHex, stampOf };

// ---- the store ----

// The picked folder normally holds `annateria-backup`; the store folder itself is accepted too (it has store.json).
async function findStoreDirectory(destination, create) {
  try {
    return await destination.getDirectoryHandle(STORE_DIR, { create });
  } catch (error) {
    if (error.name !== "NotFoundError") throw error;
    if (!create && (await exists(destination, "store.json"))) return destination;
    throw error;
  }
}

async function openStore(destination, key, { create = false } = {}) {
  let dir;
  try {
    dir = await findStoreDirectory(destination, create);
  } catch (error) {
    if (error.name === "NotFoundError") throw backupError("BACKUP_NO_STORE");
    throw error;
  }
  let info;
  try {
    info = JSON.parse(decoder.decode(await readBytes(dir, "store.json")));
  } catch (error) {
    if (error.name !== "NotFoundError") throw error;
    if (!create) throw backupError("BACKUP_NO_STORE");
    info = {
      format: BACKUP_FORMAT,
      storeId: randomHex(8),
      keyCheck: [...(await seal(key, encoder.encode(STORE_DIR), AAD_KEY))].map((b) => b.toString(16).padStart(2, "0")).join(""),
    };
    await writeOnce(dir, "store.json", encoder.encode(JSON.stringify(info)), defaultDelay);
  }
  if (info.format > BACKUP_FORMAT) throw backupError("BACKUP_NEWER_FORMAT");
  try {
    await unseal(key, hexToBytes(info.keyCheck), AAD_KEY, "key");
  } catch {
    throw backupError("BACKUP_WRONG_KEY");
  }
  return {
    dir,
    storeId: info.storeId,
    packs: await dir.getDirectoryHandle("packs", { create }),
    snapshots: await dir.getDirectoryHandle("snapshots", { create }),
  };
}

// hash -> { pack, offset, length } for every blob that is already in the store.
async function loadKnownBlobs(store, key) {
  const known = new Map();
  for (const name of (await listNames(store.packs)).filter((n) => n.endsWith(".idx"))) {
    const index = JSON.parse(decoder.decode(await unseal(key, await readBytes(store.packs, name), AAD_INDEX, name)));
    for (const [hash, [offset, length]] of Object.entries(index.blobs)) known.set(hash, { pack: name.replace(/\.idx$/, ".bin"), offset, length });
  }
  return known;
}

async function scanSource(directory, options, prefix = "") {
  const found = [];
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind === "directory") {
      const path = `${prefix}${name}/`;
      if (prefix === "" && name === STORE_DIR) continue;
      const heavy = HEAVY_DIRECTORY.exec(path);
      if (heavy && !options[heavy[1]]) continue;
      found.push(...(await scanSource(handle, options, path)));
    } else {
      found.push({ path: `${prefix}${name}`, handle });
    }
  }
  return found.sort((a, b) => (a.path < b.path ? -1 : 1));
}

async function readSource(handle) {
  try {
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  } catch (error) {
    if (!RETRYABLE.has(error.name)) throw error;
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  }
}

// Backs `source` (the data root) up into `destination` (the picked folder). Nothing is deleted or overwritten.
// Returns { name, files, bytes, newBlobs, newBytes, packs, skipped } - `skipped` lists files that could not be read.
export async function createBackup({ source, destination, key, images = false, exports = false, now = new Date().toISOString(), packBytes = DEFAULT_PACK_BYTES, onProgress, delay = defaultDelay }) {
  const store = await openStore(destination, key, { create: true });
  const known = await loadKnownBlobs(store, key);
  const files = await scanSource(source, { images, exports });
  const entries = {};
  const skipped = [];
  const result = { files: 0, bytes: 0, newBlobs: 0, newBytes: 0, packs: 0 };
  let pending = [];
  let pendingBytes = 0;

  const flush = async () => {
    if (!pending.length) return;
    const base = `pack-${stampOf(now)}-${randomHex(3)}`;
    const blobs = {};
    let offset = 0;
    for (const item of pending) {
      blobs[item.hash] = [offset, item.sealed.length];
      known.set(item.hash, { pack: `${base}.bin`, offset, length: item.sealed.length });
      offset += item.sealed.length;
    }
    await writeOnce(store.packs, `${base}.bin`, concat(pending.map((item) => item.sealed)), delay);
    await writeOnce(store.packs, `${base}.idx`, await seal(key, encoder.encode(JSON.stringify({ format: BACKUP_FORMAT, blobs })), AAD_INDEX), delay);
    result.packs += 1;
    pending = [];
    pendingBytes = 0;
  };

  for (const [index, file] of files.entries()) {
    onProgress?.({ phase: "scan", done: index, total: files.length, path: file.path });
    let bytes;
    try {
      bytes = await readSource(file.handle);
    } catch (error) {
      skipped.push({ path: file.path, error: error.name });
      continue;
    }
    const hash = await sha256Hex(bytes);
    entries[file.path] = { h: hash, s: bytes.length };
    result.files += 1;
    result.bytes += bytes.length;
    if (known.has(hash) || pending.some((item) => item.hash === hash)) continue;
    const sealed = await seal(key, bytes, hexToBytes(hash));
    pending.push({ hash, sealed });
    pendingBytes += sealed.length;
    result.newBlobs += 1;
    result.newBytes += bytes.length;
    if (pendingBytes >= packBytes) await flush();
  }
  await flush();

  const name = `snap-${stampOf(now)}-${randomHex(3)}.bin`;
  const snapshot = { format: BACKUP_FORMAT, createdAt: now, options: { images, exports }, files: entries, skipped };
  await writeOnce(store.snapshots, name, await seal(key, encoder.encode(JSON.stringify(snapshot)), AAD_SNAPSHOT), delay);
  onProgress?.({ phase: "done", done: files.length, total: files.length });
  return { name, ...result, skipped };
}

// Snapshot names carry their time, so the last backup time is known without the key.
export async function listSnapshots(destination) {
  let snapshots;
  try {
    snapshots = await (await findStoreDirectory(destination, false)).getDirectoryHandle("snapshots");
  } catch (error) {
    if (error.name === "NotFoundError") return [];
    throw error;
  }
  return (await listNames(snapshots))
    .map((name) => ({ name, match: SNAPSHOT_NAME.exec(name) }))
    .filter((item) => item.match)
    .map(({ name, match: [, date, time] }) => ({
      name,
      at: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`,
    }));
}

export async function readSnapshot(destination, key, name) {
  const store = await openStore(destination, key);
  if (!(await exists(store.snapshots, name))) throw backupError("BACKUP_NO_SNAPSHOT");
  return JSON.parse(decoder.decode(await unseal(key, await readBytes(store.snapshots, name), AAD_SNAPSHOT, name)));
}

// Reads the blobs of `snapshot` pack by pack (one pack in memory at a time) and yields { path, hash, plain }.
async function* snapshotBlobs(store, key, known, snapshot) {
  const wanted = Object.entries(snapshot.files).sort(([, a], [, b]) => {
    const [x, y] = [known.get(a.h), known.get(b.h)];
    return !x || !y ? 0 : x.pack === y.pack ? x.offset - y.offset : x.pack < y.pack ? -1 : 1;
  });
  let loaded = { name: "", bytes: null };
  for (const [path, { h: hash }] of wanted) {
    const place = known.get(hash);
    if (!place) throw backupError("BACKUP_CORRUPT", `${path} (blob missing)`);
    if (loaded.name !== place.pack) {
      try {
        loaded = { name: place.pack, bytes: await readBytes(store.packs, place.pack) };
      } catch (error) {
        if (error.name === "NotFoundError") throw backupError("BACKUP_CORRUPT", `${place.pack} (pack missing)`);
        throw error;
      }
    }
    const sealed = loaded.bytes.subarray(place.offset, place.offset + place.length);
    const plain = await unseal(key, sealed, hexToBytes(hash), path);
    if ((await sha256Hex(plain)) !== hash) throw backupError("BACKUP_CORRUPT", path);
    yield { path, hash, plain };
  }
}

// Restores a snapshot into an empty folder, checking every file against its hash.
export async function restoreSnapshot({ destination, key, name, target, onProgress }) {
  const store = await openStore(destination, key);
  const snapshot = await readSnapshot(destination, key, name);
  for await (const _ of target.entries()) throw backupError("BACKUP_NOT_EMPTY");
  const known = await loadKnownBlobs(store, key);
  const total = Object.keys(snapshot.files).length;
  let done = 0;
  for await (const { path, plain } of snapshotBlobs(store, key, known, snapshot)) {
    const parts = path.split("/");
    let directory = target;
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create: true });
    await writeBytes(directory, parts.at(-1), plain);
    onProgress?.({ phase: "restore", done: (done += 1), total, path });
  }
  return { files: total, createdAt: snapshot.createdAt };
}

// Checks that every snapshot opens and that all blobs it needs exist; `deep` also decrypts and re-hashes each blob once.
export async function verifyStore({ destination, key, deep = false }) {
  const store = await openStore(destination, key);
  const known = await loadKnownBlobs(store, key);
  const report = { ok: true, snapshots: 0, missing: [], corrupt: [], unreadable: [] };
  const needed = new Map();
  for (const { name } of await listSnapshots(destination)) {
    try {
      const snapshot = await readSnapshot(destination, key, name);
      report.snapshots += 1;
      for (const { h } of Object.values(snapshot.files)) needed.set(h, needed.get(h) ?? name);
    } catch (error) {
      if (error.code !== "BACKUP_CORRUPT") throw error;
      report.unreadable.push(name);
    }
  }
  const packNames = new Set(await listNames(store.packs));
  for (const [hash] of needed) {
    const place = known.get(hash);
    if (!place || !packNames.has(place.pack)) report.missing.push(hash);
  }
  if (deep) {
    const checked = new Map();
    for (const [hash] of needed) if (known.has(hash) && packNames.has(known.get(hash).pack)) checked.set(hash, known.get(hash));
    const ordered = [...checked].sort(([, a], [, b]) => (a.pack === b.pack ? a.offset - b.offset : a.pack < b.pack ? -1 : 1));
    let loaded = { name: "", bytes: null };
    for (const [hash, place] of ordered) {
      if (loaded.name !== place.pack) loaded = { name: place.pack, bytes: await readBytes(store.packs, place.pack) };
      try {
        const plain = await unseal(key, loaded.bytes.subarray(place.offset, place.offset + place.length), hexToBytes(hash), hash);
        if ((await sha256Hex(plain)) !== hash) report.corrupt.push(hash);
      } catch {
        report.corrupt.push(hash);
      }
    }
  }
  report.ok = !report.missing.length && !report.corrupt.length && !report.unreadable.length;
  return report;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Retention for a manual clean-up: everything from the last 30 days, then the newest snapshot of each month for 5 years.
// Never deletes anything itself; the newest snapshot is always kept.
export function snapshotsToKeep(snapshots, now = new Date().toISOString()) {
  const current = Date.parse(now);
  const newestFirst = [...snapshots].sort((a, b) => (a.at < b.at ? 1 : -1));
  const keep = new Set();
  const months = new Set();
  for (const { name, at } of newestFirst) {
    const age = current - Date.parse(at);
    const month = at.slice(0, 7);
    if (!keep.size || age <= 30 * DAY_MS) keep.add(name);
    else if (age <= 5 * 366 * DAY_MS && !months.has(month)) keep.add(name);
    months.add(month);
  }
  return { keep: [...keep], drop: newestFirst.map((item) => item.name).filter((name) => !keep.has(name)) };
}
