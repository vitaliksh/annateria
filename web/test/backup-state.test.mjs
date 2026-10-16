import test from "node:test";
import assert from "node:assert/strict";
import { backupLevel, normaliseBackupState, readBackupState, saveBackupState } from "../backup-state.js";
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

test("level: nothing done is a warning, a fresh cloud copy plus a fresh flash copy is ok", () => {
  assert.equal(backupLevel(normaliseBackupState(null), NOW).level, "warning");
  const fresh = normaliseBackupState({ cloud: slot("2026-10-10T08:00:00Z"), usb: slot("2026-09-20T08:00:00Z") });
  assert.equal(backupLevel(fresh, NOW).level, "ok");
});

test("level: cloud older than 2 days and flash older than 35 days are errors, a missing flash copy only a warning", () => {
  const cloudOld = normaliseBackupState({ cloud: slot("2026-10-07T11:00:00Z"), usb: slot("2026-10-01T00:00:00Z") });
  const result = backupLevel(cloudOld, NOW);
  assert.equal(result.level, "error");
  assert.equal(result.slots.cloud.state, "stale");
  assert.equal(result.slots.cloud.days, 3);
  const usbOld = normaliseBackupState({ cloud: slot("2026-10-10T08:00:00Z"), usb: slot("2026-09-01T00:00:00Z") });
  assert.equal(backupLevel(usbOld, NOW).slots.usb.state, "stale");
  const noUsb = normaliseBackupState({ cloud: slot("2026-10-10T08:00:00Z") });
  assert.equal(backupLevel(noUsb, NOW).level, "warning");
  const justInside = normaliseBackupState({ cloud: slot("2026-10-08T12:00:00Z"), usb: slot("2026-10-10T00:00:00Z") });
  assert.equal(backupLevel(justInside, NOW).level, "ok", "exactly two days is still fresh");
});

test("level: a time in the future does not break the plate", () => {
  const state = normaliseBackupState({ cloud: slot("2026-10-11T00:00:00Z"), usb: slot("2026-10-11T00:00:00Z") });
  assert.deepEqual(backupLevel(state, NOW).slots.cloud, { state: "ok", days: 0 });
});
