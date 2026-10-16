// Interface settings kept in the data root (common/ui-settings.json, schema 1): the hidden journal columns and the
// full path of the data folder as the user typed it (the browser never reveals the path, only the folder name).
import { PRESET_HIDDEN, normaliseHidden } from "./table-column-model.js";

export const UI_SETTINGS_FILE = "ui-settings.json";
export const UI_SETTINGS_SCHEMA = 1;
export const MAX_FOLDER_PATH = 260;

export const DEFAULT_UI_SETTINGS = Object.freeze({ schemaVersion: UI_SETTINGS_SCHEMA, hiddenColumns: PRESET_HIDDEN.minimum, folderPath: "" });

// Anything unreadable falls back to the defaults; a saved empty column list means "show every column".
export function normaliseUiSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    schemaVersion: UI_SETTINGS_SCHEMA,
    hiddenColumns: Array.isArray(source.hiddenColumns) ? normaliseHidden(source.hiddenColumns) : [...PRESET_HIDDEN.minimum],
    folderPath: typeof source.folderPath === "string" ? source.folderPath.trim().slice(0, MAX_FOLDER_PATH) : "",
  };
}

export async function readUiSettings(dataRoot) {
  try {
    const common = await dataRoot.getDirectoryHandle("common");
    const file = await (await common.getFileHandle(UI_SETTINGS_FILE)).getFile();
    return normaliseUiSettings(JSON.parse(await file.text()));
  } catch (error) {
    if (error.name === "NotFoundError" || error instanceof SyntaxError) return normaliseUiSettings(null);
    throw error;
  }
}

// Saves the given fields and keeps the others as they are on disk.
export async function saveUiSettings(dataRoot, changes) {
  const merged = normaliseUiSettings({ ...(await readUiSettings(dataRoot)), ...changes });
  const common = await dataRoot.getDirectoryHandle("common", { create: true });
  const writable = await (await common.getFileHandle(UI_SETTINGS_FILE, { create: true })).createWritable();
  try {
    await writable.write(JSON.stringify(merged, null, 2));
  } finally {
    await writable.close();
  }
  return merged;
}
