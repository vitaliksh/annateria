import test from "node:test";
import assert from "node:assert/strict";
import { backupLevel, normaliseBackupState, readBackupState, saveBackupState, usbReminder } from "../backup-state.js";
import { memoryDirectory } from "./memory-directory.mjs";

const NOW = "2026-10-10T12:00:00.000Z";
const slot = (at) => ({ folder: "x", at, files: 3, skipped: 0 });

test("state: unreadable or odd input means never backed up", () => {
  assert.deepEqual(normaliseBackupState(null), { schemaVersion: 1, includeImages: false, cloud: null, usb: null });
  assert.equal(normaliseBackupState({ cloud: { at: "not a date" } }).cloud, null);
  assert.equal(normaliseBackupState({ cloud: { at: NOW, files: -2, folder: 5 } }).cloud.files, 0);
  assert.equal(normaliseBackupState({ includeImages: "yes" }).includeImages, false);
});

test("state file: reads defaults when missing, saves and merges fields", async () => {
  const root = memoryDirectory("root");
  assert.equal((await readBackupState(root)).cloud, null);
  await saveBackupState(root, { cloud: slot(NOW) });
  await saveBackupState(root, { includeImages: true });
  const state = await readBackupState(root);
  assert.equal(state.cloud.at, NOW);
  assert.equal(state.includeImages, true);
  assert.equal(state.usb, null);
});

// 7.6: the Google Drive slot is gone (the shared folder of the two PCs is that copy); the plate follows the flash copy only.
test("level: no flash copy is a warning, a fresh one is ok, one older than 35 days an error; an old cloud time is ignored", () => {
  assert.equal(backupLevel(normaliseBackupState(null), NOW).level, "warning");
  const fresh = normaliseBackupState({ cloud: slot("2026-01-01T00:00:00Z"), usb: slot("2026-09-20T08:00:00Z") });
  assert.equal(backupLevel(fresh, NOW).level, "ok");
  const old = backupLevel(normaliseBackupState({ usb: slot("2026-09-01T00:00:00Z") }), NOW);
  assert.deepEqual([old.level, old.slots.usb.state, old.slots.usb.days], ["error", "stale", 39]);
  assert.deepEqual(Object.keys(old.slots), ["usb"]);
});

test("level: a time in the future does not break the plate", () => {
  const state = normaliseBackupState({ usb: slot("2026-10-11T00:00:00Z") });
  assert.deepEqual(backupLevel(state, NOW).slots.usb, { state: "ok", days: 0 });
});

test("weekly reminder: due when never made or 7 days old, not before", () => {
  assert.deepEqual(usbReminder(normaliseBackupState(null), NOW), { due: true, days: null });
  assert.deepEqual(usbReminder(normaliseBackupState({ usb: slot("2026-10-04T08:00:00Z") }), NOW), { due: false, days: 6 });
  assert.deepEqual(usbReminder(normaliseBackupState({ usb: slot("2026-10-03T08:00:00Z") }), NOW), { due: true, days: 7 });
});
