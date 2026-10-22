import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { keyFromRecoveryCode, listSnapshots, newRecoveryCode } from "../backup-store.js";
import { BACKUP_KEY_NAME, SYNC_FOLDER_KEY } from "../backup-handles.js";
import { SYNC_DIR, readSyncState } from "../sync-store.js";
import { setupSync } from "../sync-ui.js";
import { binaryDirectory, putFile } from "./memory-binary-directory.mjs";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");

// A directory handle with the permission API of a real one; `resolve` tells whether another handle lies inside the root.
function withPermission(directory, { permission = "granted", isRoot = false } = {}) {
  const handle = Object.assign(directory, {
    permission,
    requested: false,
    queryPermission: async () => handle.permission,
    requestPermission: async () => {
      handle.requested = true;
      handle.permission = "granted";
      return handle.permission;
    },
  });
  if (isRoot) handle.resolve = async (other) => (other === handle ? [] : null);
  return handle;
}

// Timers that run only when the test says so.
function manualTimers() {
  const pending = new Map();
  let next = 1;
  const add = (kind) => (fn, ms) => { pending.set(next, { kind, fn, ms }); return next++; };
  const remove = (id) => { pending.delete(id); };
  return {
    pending,
    setTimeout: add("timeout"),
    setInterval: add("interval"),
    clearTimeout: remove,
    clearInterval: remove,
    async fire(kind) {
      for (const [id, timer] of [...pending]) {
        if (timer.kind !== kind) continue;
        if (kind === "timeout") pending.delete(id);
        await timer.fn();
      }
      for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    },
  };
}

async function setup({ key = true, folder = null } = {}) {
  const { window } = new JSDOM(html, { url: "https://vitaliksh.github.io/annateria/" });
  const document = window.document;
  const root = withPermission(binaryDirectory("data"), { isRoot: true });
  await putFile(root, "clients/c1/workspace.json", '{"name":"synthetic"}');
  await putFile(root, "clients/c1/declarations/2026-09/draft-table.json", '{"rows":[]}');
  await putFile(root, "clients/c1/declarations/2026-09/images/001.jpg", "photo");
  const stored = new Map();
  if (key) stored.set(BACKUP_KEY_NAME, await keyFromRecoveryCode(newRecoveryCode()));
  if (folder) stored.set(SYNC_FOLDER_KEY, folder);
  const store = {
    readSetting: async (name) => stored.get(name),
    writeSetting: async (name, value) => { stored.set(name, value); },
  };
  const picks = [];
  const timers = manualTimers();
  const clock = { value: "2026-10-22T08:30:00.000Z" };
  const sync = setupSync({
    icon: document.querySelector("#sync-status"),
    section: document.querySelector("#sync-section"),
    getDataRoot: () => root,
    store,
    pickDirectory: async () => {
      if (!picks.length) throw Object.assign(new Error("cancelled"), { name: "AbortError" });
      return picks.shift();
    },
    now: () => clock.value,
    timers,
  });
  await sync.refresh();
  const icon = document.querySelector("#sync-status");
  const section = document.querySelector("#sync-section");
  const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 5)); };
  const snapshots = async (shared) => {
    try {
      return await listSnapshots(await shared.getDirectoryHandle(SYNC_DIR));
    } catch {
      return [];
    }
  };
  return { document, root, stored, picks, timers, clock, sync, icon, section, settle, snapshots };
}

test("no shared folder: the icon is hidden and a save starts no timer", async () => {
  const { icon, section, sync, timers } = await setup();
  assert.equal(icon.hidden, true);
  assert.match(section.querySelector('[data-role="folder"]').textContent, /טרם נבחרה/);
  sync.start();
  sync.changed();
  assert.equal(timers.pending.size, 0);
});

test("choosing the folder pushes at once; the icon shows ✓ with the time", async () => {
  const { icon, section, picks, settle, snapshots, root } = await setup();
  const shared = withPermission(binaryDirectory("drive"));
  picks.push(shared);
  section.querySelector('[data-action="choose"]').click();
  await settle();
  assert.equal((await snapshots(shared)).length, 1);
  assert.equal(icon.hidden, false);
  assert.equal(icon.dataset.state, "ok");
  assert.match(icon.textContent, /^☁ ✓ /);
  assert.match(icon.title, /מעודכן/);
  assert.match(section.querySelector('[data-role="folder"]').textContent, /«drive»/);
  assert.equal((await readSyncState(root)).lastPush.files, 3);
});

test("saves in a row give one push a minute after the last one; no change gives no new snapshot", async () => {
  const shared = withPermission(binaryDirectory("drive"));
  const { sync, timers, snapshots, root } = await setup({ folder: shared });
  sync.changed();
  sync.changed();
  sync.changed();
  const waiting = [...timers.pending.values()].filter((timer) => timer.kind === "timeout");
  assert.deepEqual(waiting.map((timer) => timer.ms), [60000]);
  await timers.fire("timeout");
  assert.equal((await snapshots(shared)).length, 1);
  sync.changed();
  await timers.fire("timeout");
  assert.equal((await snapshots(shared)).length, 1);
  await putFile(root, "clients/c1/declarations/2026-09/draft-table.json", '{"rows":[1]}');
  sync.changed();
  await timers.fire("timeout");
  assert.equal((await snapshots(shared)).length, 2);
});

test("the five-minute check runs only with a folder and catches changes made without a save call", async () => {
  const shared = withPermission(binaryDirectory("drive"));
  const { sync, timers, snapshots, root } = await setup({ folder: shared });
  sync.start();
  const intervals = [...timers.pending.values()].filter((timer) => timer.kind === "interval");
  assert.deepEqual(intervals.map((timer) => timer.ms), [300000]);
  await putFile(root, "clients/c1/rules.md", "- rule\n");
  await timers.fire("interval");
  assert.equal((await snapshots(shared)).length, 1);
  sync.start();
  assert.equal([...timers.pending.values()].filter((timer) => timer.kind === "interval").length, 1);
});

test("without the folder permission nothing is written and the icon asks for a click; the click pushes", async () => {
  const shared = withPermission(binaryDirectory("drive"), { permission: "prompt" });
  const { sync, icon, snapshots, settle } = await setup({ folder: shared });
  await sync.push();
  assert.equal(shared.requested, false);
  assert.equal(icon.dataset.state, "click");
  assert.equal(icon.textContent, "☁ !");
  assert.equal((await snapshots(shared)).length, 0);
  icon.click();
  await settle();
  assert.equal(shared.requested, true);
  assert.equal(icon.dataset.state, "ok");
  assert.equal((await snapshots(shared)).length, 1);
});

test("without a key nothing is written and the icon says why", async () => {
  const shared = withPermission(binaryDirectory("drive"));
  const { sync, icon, snapshots } = await setup({ key: false, folder: shared });
  await sync.push();
  assert.equal(icon.dataset.state, "error");
  assert.match(icon.title, /קוד שחזור/);
  assert.equal((await snapshots(shared)).length, 0);
});

test("a failed push turns the icon red with the reason; the next push recovers", async () => {
  const shared = withPermission(binaryDirectory("drive"));
  const { sync, icon, root } = await setup({ folder: shared });
  shared.state.failures.push({ match: /^snap-/, name: "TypeError", times: 1 });
  await sync.push();
  assert.equal(icon.dataset.state, "error");
  assert.match(icon.title, /נכשלה/);
  assert.equal((await readSyncState(root)).lastPush, null);
  await sync.push();
  assert.equal(icon.dataset.state, "ok");
  assert.notEqual((await readSyncState(root)).lastPush, null);
});

test("a folder inside the data root is refused", async () => {
  const { root, picks, section, stored, settle } = await setup();
  picks.push(root);
  section.querySelector('[data-action="choose"]').click();
  await settle();
  assert.equal(stored.has(SYNC_FOLDER_KEY), false);
  assert.match(section.querySelector('[data-role="state"]').textContent, /בתוך תיקיית הנתונים/);
});
