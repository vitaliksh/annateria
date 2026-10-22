// The snapshot that carries the data root from one PC to the other through the shared Google Drive folder (phase 7,
// docs/WORK_PLAN.md). It is a backup snapshot (backup-store.js) with the source images always in, so the other PC can open
// the original of every row; the legacy exports stay out. Files that describe one PC never travel: they would overwrite the
// other PC's own state when it takes the snapshot.
import { createBackup, listSnapshots } from "./backup-store.js";
import { BACKUP_STATE_FILE } from "./backup-state.js";
import { UI_SETTINGS_FILE } from "./ui-settings.js";

// Local only, never inside a snapshot (WORK_PLAN 7.4): the snapshot this PC is based on.
export const SYNC_STATE_FILE = "sync-state.json";

// When this PC backed up and to which folder; the data folder's path on this PC, its columns and model choice.
const LOCAL_ONLY = new Set([SYNC_STATE_FILE, BACKUP_STATE_FILE, UI_SETTINGS_FILE].map((name) => `common/${name}`));

// Chrome writes through `<name>.crswap` and renames it on close; one may exist while the page saves (seen in spike 7.1).
export function isLocalOnly(path) {
  return LOCAL_ONLY.has(path) || path.endsWith(".crswap");
}

export function createSyncSnapshot({ source, destination, key, previous, now, onProgress, delay }) {
  const options = { images: true, exports: false, exclude: isLocalOnly };
  return createBackup({ source, destination, key, ...options, previous, now, onProgress, delay });
}

// Inside the shared folder the app keeps its own folder: the store (annateria-backup/) now, the baton files later (7.5).
export const SYNC_DIR = "annateria-sync";

// common/sync-state.json (schema 1): `lastPush` = { name, at, digest, files, ms } of the last snapshot this PC wrote.
export const SYNC_STATE_SCHEMA = 1;

function normalisePush(value) {
  if (!value || typeof value !== "object" || typeof value.at !== "string" || Number.isNaN(Date.parse(value.at))) return null;
  if (typeof value.name !== "string" || typeof value.digest !== "string") return null;
  const count = (number) => (Number.isFinite(number) && number >= 0 ? number : 0);
  return { name: value.name, at: value.at, digest: value.digest, files: count(value.files), ms: count(value.ms) };
}

export function normaliseSyncState(value) {
  const source = value && typeof value === "object" ? value : {};
  return { schemaVersion: SYNC_STATE_SCHEMA, lastPush: normalisePush(source.lastPush) };
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
