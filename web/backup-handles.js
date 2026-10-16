// Folder handles of the backup destinations and the non-extractable backup key live in the browser's IndexedDB (a handle or a
// CryptoKey cannot be written to a file). Same database as the workspace handles, other keys; per PC, never the source of truth.
const DATABASE = "rivhit-local-workspaces-v1";
const STORE = "settings";

export const BACKUP_FOLDER_KEYS = { cloud: "backup-folder-cloud", usb: "backup-folder-usb" };
export const BACKUP_KEY_NAME = "backup-key";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// readSetting(key) reads; writeSetting(key, value) stores.
export async function readSetting(key) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE, "readonly").objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
}

export async function writeSetting(key, value) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
}
