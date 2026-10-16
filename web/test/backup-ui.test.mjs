import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createBackup, keyFromRecoveryCode, listSnapshots, newRecoveryCode } from "../backup-store.js";
import { readBackupState, saveBackupState } from "../backup-state.js";
import { BACKUP_FOLDER_KEYS, BACKUP_KEY_NAME } from "../backup-handles.js";
import { binaryDirectory, listPaths, putFile } from "./memory-binary-directory.mjs";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve, 15));
const settle = async () => { for (let i = 0; i < 8; i += 1) await tick(); };

// A directory handle with the permission API of a real one; `resolve` tells whether another handle lies inside the root.
function withPermission(directory, { permission = "granted", isRoot = false } = {}) {
  const handle = Object.assign(directory, {
    permission,
    grantOnRequest: true,
    requested: false,
    queryPermission: async () => handle.permission,
    requestPermission: async () => {
      handle.requested = true;
      handle.permission = handle.grantOnRequest ? "granted" : "denied";
      return handle.permission;
    },
  });
  if (isRoot) handle.resolve = async (other) => (other === handle ? [] : null);
  return handle;
}

async function setup({ confirm } = {}) {
  const dom = new JSDOM(html, { url: "https://vitaliksh.github.io/ocr/" });
  const { window } = dom;
  Object.assign(globalThis, { document: window.document, window });
  const dialog = window.document.querySelector("#backup-dialog");
  dialog.showModal = () => { dialog.open = true; };
  const root = withPermission(binaryDirectory("data"), { isRoot: true });
  await putFile(root, "common/ui-settings.json", "{}");
  await putFile(root, "clients/c1/workspace.json", '{"name":"synthetic"}');
  await putFile(root, "clients/c1/declarations/2026-01/draft-table.json", '{"rows":[]}');
  const stored = new Map();
  const store = { readSetting: async (key) => stored.get(key), writeSetting: async (key, value) => { stored.set(key, value); } };
  const picks = [];
  const clock = { value: "2026-10-10T12:00:00.000Z" };
  const errors = [];
  const { setupBackup } = await import("../backup-ui.js");
  const openButton = window.document.querySelector("#open-backup");
  const backup = setupBackup({
    dialog,
    openButton,
    getDataRoot: () => root,
    onError: (message) => errors.push(message),
    store,
    pickDirectory: async () => {
      if (!picks.length) throw Object.assign(new Error("cancelled"), { name: "AbortError" });
      return picks.shift();
    },
    now: () => clock.value,
    ...(confirm ? { confirm } : {}),
  });
  await backup.refresh();
  const q = (selector) => dialog.querySelector(selector);
  const slotButton = (slot, action) => q(`[data-slot="${slot}"] [data-action="${action}"]`);
  const click = async (button) => { button.click(); await settle(); };
  const giveKey = async () => {
    const code = newRecoveryCode();
    stored.set(BACKUP_KEY_NAME, await keyFromRecoveryCode(code));
    await backup.refresh();
    return code;
  };
  // Picks `folder` for a slot through the dialog, as the user would.
  const choose = async (slot, folder) => { picks.push(folder); await click(slotButton(slot, "choose")); };
  return {
    window, dialog, root, stored, picks, clock, errors, backup, openButton, q, slotButton, click, giveKey, choose,
    plate: () => q("#backup-summary").textContent,
    error: () => q("#backup-error").textContent,
  };
}

test("the page has the backup dialog and the sidebar item with every id the module needs", () => {
  for (const id of ["open-backup", "backup-dialog", "backup-summary", "backup-error", "backup-images", "backup-key-state", "backup-create-key", "backup-code-box", "backup-code", "backup-code-saved", "backup-code-confirm", "backup-restore-choose", "backup-restore-details", "backup-restore-snapshot", "backup-restore-code", "backup-restore-run"]) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
});

test("before anything is set up: warning dot, no run button, a button to create the code", async () => {
  const { openButton, plate, q, slotButton } = await setup();
  assert.equal(openButton.dataset.level, "warning");
  assert.match(plate(), /טרם הוגדר/);
  assert.equal(slotButton("cloud", "run").disabled, true);
  assert.equal(q("#backup-create-key").hidden, false);
});

test("recovery code is shown once and stored as a non-extractable key only after the confirmation", async () => {
  const { q, stored, click } = await setup();
  await click(q("#backup-create-key"));
  assert.equal(q("#backup-code-box").hidden, false);
  assert.match(q("#backup-code").textContent, /^([0-9A-Z]{4}-){13}[0-9A-Z]{4}$/);
  assert.equal(q("#backup-code-confirm").disabled, true);
  assert.equal(stored.has(BACKUP_KEY_NAME), false);
  await click(q("#backup-code-saved"));
  assert.equal(q("#backup-code-confirm").disabled, false);
  await click(q("#backup-code-confirm"));
  assert.equal(stored.get(BACKUP_KEY_NAME).extractable, false);
  assert.equal(q("#backup-code-box").hidden, true);
  assert.equal(q("#backup-code").textContent, "");
});

test("backup needs a key; then it writes the copy, remembers the time and keeps the dot a warning until the flash copy exists", async () => {
  const { q, slotButton, choose, click, giveKey, clock, root, error, plate, openButton } = await setup();
  const drive = withPermission(binaryDirectory("drive"));
  await choose("cloud", drive);
  await click(slotButton("cloud", "run"));
  assert.match(error(), /קוד שחזור/);
  assert.match(plate(), /קוד שחזור/, "the error is also on the top plate");
  await click(q("#backup-create-key"));
  await click(slotButton("cloud", "run"));
  assert.match(error(), /שמירת הקוד במחשב/, "a created but unconfirmed code is named");
  await giveKey();
  await click(slotButton("cloud", "run"));
  assert.equal(error(), "");
  assert.match(plate(), /הגיבוי הושלם: 3 קבצים/);
  assert.equal((await listSnapshots(drive)).length, 1);
  assert.equal((await readBackupState(root)).cloud.at, clock.value);
  assert.equal(openButton.dataset.level, "warning");
});

test("both copies fresh turn the dot green; a stale cloud copy turns it red", async () => {
  const { slotButton, choose, click, giveKey, clock, backup, openButton } = await setup();
  await giveKey();
  await choose("cloud", withPermission(binaryDirectory("drive")));
  await choose("usb", withPermission(binaryDirectory("flash")));
  await click(slotButton("cloud", "run"));
  await click(slotButton("usb", "run"));
  assert.equal(openButton.dataset.level, "ok");
  clock.value = "2026-10-14T12:00:00.000Z";
  await backup.refresh();
  assert.equal(openButton.dataset.level, "error");
});

test("a folder inside the data root is refused and not remembered", async () => {
  const { choose, root, error, stored } = await setup();
  await choose("cloud", root);
  assert.match(error(), /בתוך תיקיית הנתונים/);
  assert.equal(stored.has(BACKUP_FOLDER_KEYS.cloud), false);
});

test("a cancelled folder picker is not an error", async () => {
  const { slotButton, click, error } = await setup();
  await click(slotButton("cloud", "choose"));
  assert.equal(error(), "");
});

test("without permission: the button says so, the automatic run stays silent and never asks", async () => {
  const { slotButton, choose, click, giveKey, backup, errors, error } = await setup();
  await giveKey();
  const drive = withPermission(binaryDirectory("drive"), { permission: "prompt" });
  drive.grantOnRequest = false;
  await choose("cloud", drive);
  await backup.runAuto("lock");
  assert.equal(drive.requested, false);
  assert.deepEqual(errors, []);
  assert.equal((await listSnapshots(drive)).length, 0);
  await click(slotButton("cloud", "run"));
  assert.match(error(), /לא ניתנה הרשאה/);
  assert.equal(drive.requested, true);
});

test("automatic run: at start only when the cloud copy is older than a day, after a lock always", async () => {
  const { choose, giveKey, backup, root, clock, errors } = await setup();
  await giveKey();
  const drive = withPermission(binaryDirectory("drive"));
  await choose("cloud", drive);
  await saveBackupState(root, { cloud: { folder: "drive", at: "2026-10-10T10:00:00.000Z", files: 1, skipped: 0 } });
  await backup.runAuto("start");
  assert.equal((await listSnapshots(drive)).length, 0, "two hours old: skipped");
  await backup.runAuto("lock");
  assert.equal((await listSnapshots(drive)).length, 1, "after a lock: runs");
  clock.value = "2026-10-11T13:00:00.000Z";
  await backup.runAuto("start");
  assert.equal((await listSnapshots(drive)).length, 2, "more than a day later: runs");
  assert.deepEqual(errors, []);
});

test("automatic run without a key or a folder does nothing and says nothing", async () => {
  const { backup, errors, giveKey } = await setup();
  await backup.runAuto("lock");
  await giveKey();
  await backup.runAuto("lock");
  assert.deepEqual(errors, []);
});

test("verify reports a healthy copy; the images switch is saved in the data root", async () => {
  const { slotButton, choose, click, giveKey, plate, q, root } = await setup();
  await giveKey();
  await choose("cloud", withPermission(binaryDirectory("drive")));
  await click(slotButton("cloud", "run"));
  await click(slotButton("cloud", "verify"));
  assert.match(plate(), /הגיבוי תקין: 1 עותקים/);
  await click(q("#backup-images"));
  assert.equal((await readBackupState(root)).includeImages, true);
});

test("restore: pick the backup folder, choose a snapshot, give the code, get the files in an empty folder", async () => {
  const { q, picks, click, plate } = await setup();
  const code = newRecoveryCode();
  const key = await keyFromRecoveryCode(code);
  const source = binaryDirectory("data");
  await putFile(source, "clients/c1/workspace.json", '{"name":"synthetic"}');
  await putFile(source, "common/ui-settings.json", "{}");
  const flash = binaryDirectory("flash");
  await createBackup({ source, destination: flash, key, now: "2026-10-01T10:00:00.000Z" });
  await createBackup({ source, destination: flash, key, now: "2026-10-02T10:00:00.000Z" });
  picks.push(flash);
  await click(q("#backup-restore-choose"));
  assert.equal(q("#backup-restore-details").hidden, false);
  assert.equal(q("#backup-restore-snapshot").options.length, 2);
  q("#backup-restore-code").value = code.toLowerCase();
  const target = binaryDirectory("restored");
  picks.push(target);
  await click(q("#backup-restore-run"));
  assert.match(plate(), /שוחזרו 2 קבצים אל «restored»/);
  assert.deepEqual(await listPaths(target), ["clients/c1/workspace.json", "common/ui-settings.json"]);
});

test("restore: a wrong or malformed code and a folder without a backup are reported", async () => {
  const { q, picks, click, error } = await setup();
  const key = await keyFromRecoveryCode(newRecoveryCode());
  const source = binaryDirectory("data");
  await putFile(source, "a.json", "{}");
  const flash = binaryDirectory("flash");
  await createBackup({ source, destination: flash, key });
  picks.push(binaryDirectory("empty"));
  await click(q("#backup-restore-choose"));
  assert.match(error(), /לא נמצא גיבוי/);
  picks.push(flash);
  await click(q("#backup-restore-choose"));
  q("#backup-restore-code").value = newRecoveryCode();
  picks.push(binaryDirectory("t1"));
  await click(q("#backup-restore-run"));
  assert.match(error(), /אינו מתאים/);
  q("#backup-restore-code").value = "garbage";
  await click(q("#backup-restore-run"));
  assert.match(error(), /אינו תקין/);
});

test("a recovery code from the other PC can be entered instead of creating a new one; a malformed code is refused", async () => {
  const { q, click, stored, error } = await setup();
  q("#backup-enter-code").value = "garbage";
  await click(q("#backup-use-code"));
  assert.match(error(), /אינו תקין/);
  assert.equal(stored.has(BACKUP_KEY_NAME), false);
  q("#backup-enter-code").value = newRecoveryCode();
  await click(q("#backup-use-code"));
  assert.equal(stored.get(BACKUP_KEY_NAME).extractable, false);
  assert.equal(q("#backup-create-key").hidden, true);
  assert.equal(q("#backup-enter-box").hidden, false, "the box stays, now as the way to replace the code");
  assert.equal(q("#backup-use-code").textContent, "החלפת הקוד");
});

test("replacing the saved code asks first; declining keeps the old key, a malformed code is refused", async () => {
  const answers = [];
  const { q, click, stored, error, giveKey, plate } = await setup({ confirm: async (message) => { answers.push(message); return answers.length > 1; } });
  await giveKey();
  const original = stored.get(BACKUP_KEY_NAME);
  q("#backup-enter-code").value = "garbage";
  await click(q("#backup-use-code"));
  assert.match(error(), /אינו תקין/);
  assert.equal(answers.length, 0, "nothing to confirm for a malformed code");
  q("#backup-enter-code").value = newRecoveryCode();
  await click(q("#backup-use-code"));
  assert.equal(answers.length, 1);
  assert.match(answers[0], /לא ייפתחו בלעדיו/);
  assert.equal(stored.get(BACKUP_KEY_NAME), original, "declined: the old key stays");
  await click(q("#backup-use-code"));
  assert.notEqual(stored.get(BACKUP_KEY_NAME), original);
  assert.match(plate(), /הוחלף/);
  assert.equal(q("#backup-enter-code").value, "");
});
