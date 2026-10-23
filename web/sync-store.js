// The snapshot that carries the data root from one PC to the other through the shared Google Drive folder (phase 7,
// docs/WORK_PLAN.md). It is a backup snapshot (backup-store.js) with the source images always in, so the other PC can open
// the original of every row; the legacy exports stay out. Files that describe one PC never travel: they would overwrite the
// other PC's own state when it takes the snapshot.
import { STORE_DIR, checkSnapshot, createBackup, listSnapshots, readStoreId, snapshotFiles, stampOf } from "./backup-store.js";
import { BACKUP_STATE_FILE } from "./backup-state.js";
import { UI_SETTINGS_FILE } from "./ui-settings.js";

// Local only, never inside a snapshot (WORK_PLAN 7.4): the snapshot this PC is based on.
export const SYNC_STATE_FILE = "sync-state.json";

// When this PC backed up and to which folder; the data folder's path on this PC, its columns and model choice.
const LOCAL_ONLY = new Set([SYNC_STATE_FILE, BACKUP_STATE_FILE, UI_SETTINGS_FILE].map((name) => `common/${name}`));

// The files a pull replaced or removed (7.4.3) stay on this PC only.
export const BEFORE_PREFIX = "common/sync-before-";

// Chrome writes through `<name>.crswap` and renames it on close; one may exist while the page saves (seen in spike 7.1).
export function isLocalOnly(path) {
  return LOCAL_ONLY.has(path) || path.endsWith(".crswap") || path.startsWith(BEFORE_PREFIX);
}

export function createSyncSnapshot({ source, destination, key, previous, now, onProgress, delay }) {
  const options = { images: true, exports: false, exclude: isLocalOnly };
  return createBackup({ source, destination, key, ...options, previous, now, onProgress, delay });
}

// Inside the shared folder the app keeps its own folder: the store (annateria-backup/).
export const SYNC_DIR = "annateria-sync";

// The id of the store in the shared folder, or null when the app has not written there (or it has not arrived yet).
export async function syncStoreId(shared) {
  try {
    return await readStoreId(await shared.getDirectoryHandle(SYNC_DIR));
  } catch (error) {
    if (error.name === "NotFoundError") return null;
    throw error;
  }
}

// common/sync-state.json (schema 1): `lastPush` = { name, at, digest, files, ms } of the last snapshot this PC wrote or took
// (after a pull the data equal it, so the next push of the same data writes nothing); `applying` = { name, before } while a
// pull is being written, so an interrupted one is finished on the next open.
export const SYNC_STATE_SCHEMA = 1;

function normalisePush(value) {
  if (!value || typeof value !== "object" || typeof value.at !== "string" || Number.isNaN(Date.parse(value.at))) return null;
  if (typeof value.name !== "string" || typeof value.digest !== "string") return null;
  const count = (number) => (Number.isFinite(number) && number >= 0 ? number : 0);
  return { name: value.name, at: value.at, digest: value.digest, files: count(value.files), ms: count(value.ms) };
}

function normaliseApplying(value) {
  if (!value || typeof value !== "object" || typeof value.name !== "string" || typeof value.before !== "string") return null;
  return value.before.startsWith(BEFORE_PREFIX) ? { name: value.name, before: value.before } : null;
}

export function normaliseSyncState(value) {
  const source = value && typeof value === "object" ? value : {};
  const lastPush = normalisePush(source.lastPush);
  return { schemaVersion: SYNC_STATE_SCHEMA, lastPush, applying: normaliseApplying(source.applying) };
}

// Anything unreadable counts as "never pushed": the next push then writes a snapshot, which is harmless.
export async function readSyncState(dataRoot) {
  try {
    const common = await dataRoot.getDirectoryHandle("common");
    const file = await (await common.getFileHandle(SYNC_STATE_FILE)).getFile();
    return normaliseSyncState(JSON.parse(await file.text()));
  } catch (error) {
    if (error.name === "NotFoundError" || error instanceof SyntaxError) return normaliseSyncState(null);
    throw error;
  }
}

export async function saveSyncState(dataRoot, changes) {
  const merged = normaliseSyncState({ ...(await readSyncState(dataRoot)), ...changes });
  const common = await dataRoot.getDirectoryHandle("common", { create: true });
  const writable = await (await common.getFileHandle(SYNC_STATE_FILE, { create: true })).createWritable();
  try {
    await writable.write(JSON.stringify(merged, null, 2));
  } finally {
    await writable.close();
  }
  return merged;
}

// One push: a snapshot into <shared>/annateria-sync/ unless nothing changed since this PC's last push.
// Returns { unchanged, name, files, newBytes, ms, at }; `ms` is how long it took (WORK_PLAN 7.2: decides on a hash cache).
export async function pushSnapshot({
  source, shared, key, now = new Date().toISOString(), clock = () => performance.now(), delay,
}) {
  const started = clock();
  const destination = await shared.getDirectoryHandle(SYNC_DIR, { create: true });
  const { lastPush } = await readSyncState(source);
  // Another folder picked, or the store emptied by hand: the last push is not there, so push again.
  const there = lastPush && (await listSnapshots(destination)).some((snapshot) => snapshot.name === lastPush.name);
  const result = await createSyncSnapshot({ source, destination, key, previous: there ? lastPush.digest : null, now, delay });
  const ms = Math.round(clock() - started);
  if (!result.unchanged) {
    await saveSyncState(source, { lastPush: { name: result.name, at: now, digest: result.digest, files: result.files, ms } });
  }
  const { unchanged, name, files, newBytes, skipped } = result;
  return { unchanged, name, files, newBytes, skipped, ms, at: now };
}

// ---- pull (7.4.3): take the other device's snapshot ----

// The snapshot to take, or null: the one being applied when a pull was interrupted, else the baton's last snapshot when
// another device wrote it and this PC's data are not already that snapshot.
export function pendingPull(state, snapshot, device) {
  if (state.applying) return state.applying.name;
  if (!snapshot?.name || snapshot.device === device) return null;
  return snapshot.name === state.lastPush?.name ? null : snapshot.name;
}

// 7.4, the store check: where = { ok, id } of this PC's shared folder (ok false: it cannot be read now). The copy to take,
// or null: an interrupted pull first; a copy of this device, or one that lives in another store (or this PC has no store), is
// nothing to wait for; a folder that cannot be read is waited for (pendingPull decides then, or the copy when even the state
// of this PC could not be read).
export function copyToTake({ state, snapshot, device, where }) {
  if (state?.applying) return state.applying.name;
  if (!snapshot?.name || snapshot.device === device) return null;
  if (where.ok && (where.id === null || where.id !== (snapshot.store ?? null))) return null;
  return state ? pendingPull(state, snapshot, device) : snapshot.name;
}

// The first copy into a folder where the other device's store has not arrived yet would start a second store beside it:
// it waits (a message), unless the person clicked to send.
export function firstCopyHeld({ snapshot, device, where, interactive }) {
  if (interactive || !snapshot?.store || snapshot.device === device) return false;
  return where.ok && where.id === null;
}

const EXPORTS_DIR = /^clients\/[^/]+\/declarations\/[^/]+\/exports\/$/;

// The files a sync snapshot covers on this PC: all but the store folder, the legacy exports and the files of one PC.
async function localFiles(directory, prefix = "", found = new Map()) {
  for await (const [name, handle] of directory.entries()) {
    const path = `${prefix}${name}`;
    if (handle.kind === "directory") {
      if ((prefix === "" && name === STORE_DIR) || EXPORTS_DIR.test(`${path}/`) || isLocalOnly(`${path}/`)) continue;
      await localFiles(handle, `${path}/`, found);
    } else if (!isLocalOnly(path)) {
      found.set(path, handle);
    }
  }
  return found;
}

async function sha256Hex(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function folderOf(root, path, create) {
  let directory = root;
  for (const part of path.split("/").slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create });
  return directory;
}

async function writePath(root, path, bytes) {
  const folder = await folderOf(root, path, true);
  const writable = await (await folder.getFileHandle(path.split("/").at(-1), { create: true })).createWritable();
  try {
    await writable.write(bytes);
  } finally {
    await writable.close();
  }
}

// The copy before a change is written once: a resumed pull never overwrites the first (true) old version.
async function keepBefore(root, before, path, bytes) {
  const target = `${before}/${path}`;
  try {
    await (await folderOf(root, target, false)).getFileHandle(target.split("/").at(-1));
    return;
  } catch (error) {
    if (error.name !== "NotFoundError" && error.name !== "TypeMismatchError") throw error;
  }
  await writePath(root, target, bytes);
}

// The digest createBackup gives the same file list (so the next push of these data writes nothing).
const snapshotDigest = (snapshot) =>
  sha256Hex(new TextEncoder().encode(JSON.stringify([snapshot.files, snapshot.skipped ?? []])));

// Waits for nothing: answers { applied: false, reason } while the snapshot has not fully arrived (the caller asks again),
// otherwise writes it into the data root. Every file it replaces or removes is copied first to common/sync-before-<time>/.
// Returns { applied: true, written, removed, before } (before: the folder of the copies, or null when nothing was replaced).
// beforeWrite() runs once the snapshot is known to be whole, before the first write: the page closes its open table there
// without saving, or that old table would be saved over the new files (seen on the owner's PC, 23 October 2026).
export async function pullSnapshot({ root, shared, key, name, now = new Date().toISOString(), beforeWrite = async () => {} }) {
  let destination;
  try {
    destination = await shared.getDirectoryHandle(SYNC_DIR);
  } catch (error) {
    if (error.name === "NotFoundError") return { applied: false, reason: "missing" };
    throw error;
  }
  const checked = await checkSnapshot(destination, key, name);
  if (!checked.ok) return { applied: false, reason: checked.reason };
  const { snapshot } = checked;
  await beforeWrite();
  const state = await readSyncState(root);
  const before = state.applying?.name === name ? state.applying.before : `${BEFORE_PREFIX}${stampOf(now)}`;
  await saveSyncState(root, { applying: { name, before } });
  const local = await localFiles(root);
  let written = 0;
  let saved = 0;
  for await (const { path, hash, plain } of snapshotFiles(destination, key, name, snapshot)) {
    const handle = local.get(path);
    local.delete(path);
    let current = null;
    if (handle) {
      current = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      if ((await sha256Hex(current)) === hash) continue;
      await keepBefore(root, before, path, current);
      saved += 1;
    }
    await writePath(root, path, plain);
    written += 1;
  }
  let removed = 0;
  for (const [path, handle] of local) {
    await keepBefore(root, before, path, new Uint8Array(await (await handle.getFile()).arrayBuffer()));
    saved += 1;
    await (await folderOf(root, path, false)).removeEntry(path.split("/").at(-1));
    removed += 1;
  }
  const files = Object.keys(snapshot.files).length;
  const lastPush = { name, at: snapshot.createdAt ?? now, digest: await snapshotDigest(snapshot), files, ms: 0 };
  await saveSyncState(root, { lastPush, applying: null });
  return { applied: true, written, removed, before: saved ? before : null };
}
