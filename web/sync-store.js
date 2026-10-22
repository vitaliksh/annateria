// The snapshot that carries the data root from one PC to the other through the shared Google Drive folder (phase 7,
// docs/WORK_PLAN.md). It is a backup snapshot (backup-store.js) with the source images always in, so the other PC can open
// the original of every row; the legacy exports stay out. Files that describe one PC never travel: they would overwrite the
// other PC's own state when it takes the snapshot.
import { createBackup } from "./backup-store.js";
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

export function createSyncSnapshot({ source, destination, key, now, onProgress, delay }) {
  return createBackup({ source, destination, key, images: true, exports: false, exclude: isLocalOnly, now, onProgress, delay });
}
