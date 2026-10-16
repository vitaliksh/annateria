// What the backup status plate needs, kept in the data root (common/backup-state.json, schema 1): when each backup slot last
// succeeded and whether source images are included. "cloud" is a folder carried off by Google Drive for desktop, "usb" a flash
// drive used by hand about once a month. The state is only a reminder; the backups themselves are the source of truth.
export const BACKUP_STATE_FILE = "backup-state.json";
export const BACKUP_STATE_SCHEMA = 1;
export const SLOTS = ["cloud", "usb"];
export const STALE_DAYS = { cloud: 2, usb: 35 };

const DAY_MS = 24 * 60 * 60 * 1000;
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

function normaliseSlot(value) {
  if (!value || typeof value !== "object" || typeof value.at !== "string" || Number.isNaN(Date.parse(value.at))) return null;
  return { folder: typeof value.folder === "string" ? value.folder.slice(0, 260) : "", at: value.at, files: count(value.files), skipped: count(value.skipped) };
}

// Anything unreadable falls back to "never backed up".
export function normaliseBackupState(value) {
  const source = value && typeof value === "object" ? value : {};
  return { schemaVersion: BACKUP_STATE_SCHEMA, includeImages: source.includeImages === true, cloud: normaliseSlot(source.cloud), usb: normaliseSlot(source.usb) };
}

export async function readBackupState(dataRoot) {
  try {
    const common = await dataRoot.getDirectoryHandle("common");
    const file = await (await common.getFileHandle(BACKUP_STATE_FILE)).getFile();
    return normaliseBackupState(JSON.parse(await file.text()));
  } catch (error) {
    if (error.name === "NotFoundError" || error instanceof SyntaxError) return normaliseBackupState(null);
    throw error;
  }
}

// Saves the given fields and keeps the others as they are on disk.
export async function saveBackupState(dataRoot, changes) {
  const merged = normaliseBackupState({ ...(await readBackupState(dataRoot)), ...changes });
  const common = await dataRoot.getDirectoryHandle("common", { create: true });
  const writable = await (await common.getFileHandle(BACKUP_STATE_FILE, { create: true })).createWritable();
  try {
    await writable.write(JSON.stringify(merged, null, 2));
  } finally {
    await writable.close();
  }
  return merged;
}

// Per slot "never" | "ok" | "stale" (cloud older than 2 days, flash older than 35) and the overall level of the plate:
// error when a slot is stale, ok when both are fresh, otherwise warning (something is not set up yet).
export function backupLevel(state, now = new Date().toISOString()) {
  const slots = {};
  for (const slot of SLOTS) {
    const entry = state?.[slot] ?? null;
    if (!entry) {
      slots[slot] = { state: "never", days: null };
      continue;
    }
    const age = Date.parse(now) - Date.parse(entry.at);
    slots[slot] = { state: age > STALE_DAYS[slot] * DAY_MS ? "stale" : "ok", days: Math.max(0, Math.floor(age / DAY_MS)) };
  }
  const states = SLOTS.map((slot) => slots[slot].state);
  const level = states.includes("stale") ? "error" : states.every((value) => value === "ok") ? "ok" : "warning";
  return { level, slots };
}
