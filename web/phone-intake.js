// Scans from the phone (WORK_PLAN 2.5): the Google Drive app on the phone saves them, as they are, into phone/ of the shared
// folder; this module takes them into inbox/_unsorted/ through the ordinary inbox intake (SHA-256 dedup, read back) and then
// deletes them from phone/ (the owner, 24 October 2026: the only deletion the app makes in Drive). No AI, no network call.
import { UNSORTED, addToInbox, refusalReason } from "./inbox-store.js";

export const PHONE_DIR = "phone";
// Two listings this far apart: a file whose size changed in between is still arriving (spike 7.1) and waits for the next check.
export const SETTLE_MS = 3000;

// Chrome's temporary `.crswap`, hidden files and the folder settings Windows writes are not scans.
const ignored = (name) => name.startsWith(".") || name.startsWith("~") || name.endsWith(".crswap") || name.toLowerCase() === "desktop.ini";

async function listFiles(directory) {
  const files = new Map();
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind !== "file" || ignored(name)) continue;
    files.set(name, { handle, file: await handle.getFile() });
  }
  return files;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One check of <shared>/phone/ (created when missing, so the phone can pick it). Returns
//   added, duplicates, failed: as addToInbox (the duplicates are deleted from phone/ too: their bytes are already here),
//   refused:  { name, reason } of files of a type the inbox does not take; they stay in phone/,
//   waiting:  names still arriving (empty, or the size changed between the two listings),
//   kept:     names that are in the inbox but could not be deleted from phone/ (taken again next time, as a duplicate).
export async function takePhoneScans({ dataRoot, shared, now = new Date().toISOString(), delay = wait, add = addToInbox }) {
  const phone = await shared.getDirectoryHandle(PHONE_DIR, { create: true });
  const first = await listFiles(phone);
  const result = { added: [], duplicates: [], failed: [], refused: [], waiting: [], kept: [] };
  if (!first.size) return result;
  await delay(SETTLE_MS);
  const second = await listFiles(phone);
  const ready = [];
  for (const [name, { file }] of second) {
    const reason = refusalReason(name);
    if (reason) result.refused.push({ name, reason });
    else if (!file.size || first.get(name)?.file.size !== file.size) result.waiting.push(name);
    else ready.push({ name, file });
  }
  if (!ready.length) return result;
  // addToInbox names a file by its trimmed name; map it back to the name in phone/.
  const byName = new Map(ready.map(({ name }) => [name.trim() || "file", name]));
  const taken = await add(dataRoot, ready.map(({ file }) => file), { folder: UNSORTED, now });
  Object.assign(result, { added: taken.added, duplicates: taken.duplicates, failed: taken.failed });
  for (const { name } of [...taken.added, ...taken.duplicates]) {
    const original = byName.get(name) ?? name;
    try {
      await phone.removeEntry(original);
    } catch {
      result.kept.push(original);
    }
  }
  return result;
}
