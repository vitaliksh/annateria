import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { UNSORTED, addToInbox, readInboxIndex } from "../inbox-store.js";
import { PHONE_DIR, takePhoneScans } from "../phone-intake.js";
import { setupPhoneIntake } from "../phone-ui.js";
import { binaryDirectory, listPaths, putFile, readFileBytes } from "./memory-binary-directory.mjs";

const NOW = "2026-10-24T18:00:00.000Z";
const noDelay = async () => {};

async function folders(phoneFiles = {}) {
  const dataRoot = binaryDirectory("data");
  const shared = binaryDirectory("shared");
  for (const [name, content] of Object.entries(phoneFiles)) await putFile(shared, `${PHONE_DIR}/${name}`, content);
  return { dataRoot, shared };
}

const phoneNames = async (shared) => (await listPaths(await shared.getDirectoryHandle(PHONE_DIR))).sort();

test("a new scan goes into inbox/_unsorted and is deleted from phone/", async () => {
  const { dataRoot, shared } = await folders({ "scan 1.jpg": "synthetic photo" });
  const result = await takePhoneScans({ dataRoot, shared, now: NOW, delay: noDelay });
  assert.deepEqual(result.added.map((entry) => [entry.name, entry.folder]), [["scan 1.jpg", UNSORTED]]);
  assert.equal(new TextDecoder().decode(await readFileBytes(dataRoot, "inbox/_unsorted/scan 1.jpg")), "synthetic photo");
  assert.equal((await readInboxIndex(dataRoot)).files.length, 1);
  assert.deepEqual(await phoneNames(shared), []);
});

test("phone/ is created when missing, and an empty folder needs no second listing", async () => {
  const { dataRoot, shared } = await folders();
  let waited = false;
  const result = await takePhoneScans({ dataRoot, shared, now: NOW, delay: async () => { waited = true; } });
  assert.equal(waited, false);
  assert.deepEqual(result.added, []);
  assert.ok(await shared.getDirectoryHandle(PHONE_DIR));
});

test("a file still growing, or still empty, waits in phone/ for the next check", async () => {
  const { dataRoot, shared } = await folders({ "big.pdf": "%PDF-1", "empty.jpg": "" });
  const grow = async () => { await putFile(shared, `${PHONE_DIR}/big.pdf`, "%PDF-1 more bytes"); };
  const result = await takePhoneScans({ dataRoot, shared, now: NOW, delay: grow });
  assert.deepEqual(result.waiting.sort(), ["big.pdf", "empty.jpg"]);
  assert.deepEqual(result.added, []);
  assert.deepEqual(await phoneNames(shared), ["big.pdf", "empty.jpg"]);
  const later = await takePhoneScans({ dataRoot, shared, now: NOW, delay: noDelay });
  assert.deepEqual(later.added.map((entry) => entry.name), ["big.pdf"]);
});

test("a scan already in the inbox is counted as a duplicate and deleted from phone/", async () => {
  const { dataRoot, shared } = await folders({ "again.jpg": "same bytes" });
  await addToInbox(dataRoot, [new File(["same bytes"], "first.jpg")], { now: NOW });
  const result = await takePhoneScans({ dataRoot, shared, now: NOW, delay: noDelay });
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.duplicates.map((item) => [item.name, item.reason]), [["again.jpg", "inbox"]]);
  assert.deepEqual(await phoneNames(shared), []);
  assert.equal((await readInboxIndex(dataRoot)).files.length, 1);
});

test("a type the inbox does not take stays in phone/; temporary and system files are not even reported", async () => {
  const { dataRoot, shared } = await folders({ "notes.docx": "x", "a.jpg.crswap": "x", "desktop.ini": "x", ".hidden": "x" });
  const result = await takePhoneScans({ dataRoot, shared, now: NOW, delay: noDelay });
  assert.deepEqual(result.refused.map((item) => item.name), ["notes.docx"]);
  assert.deepEqual([result.added, result.waiting], [[], []]);
  assert.equal((await phoneNames(shared)).length, 4);
});

test("a scan that could not be deleted is kept, and the next check takes it as a duplicate and deletes it", async () => {
  const { dataRoot, shared } = await folders({ "stuck.jpg": "synthetic" });
  const phone = await shared.getDirectoryHandle(PHONE_DIR);
  const removeEntry = phone.removeEntry;
  phone.removeEntry = async () => { throw Object.assign(new Error("locked"), { name: "NoModificationAllowedError" }); };
  const first = await takePhoneScans({ dataRoot, shared, now: NOW, delay: noDelay });
  assert.deepEqual([first.added.length, first.kept], [1, ["stuck.jpg"]]);
  phone.removeEntry = removeEntry;
  const second = await takePhoneScans({ dataRoot, shared, now: NOW, delay: noDelay });
  assert.deepEqual([second.added.length, second.duplicates.length], [0, 1]);
  assert.deepEqual(await phoneNames(shared), []);
  assert.equal((await readInboxIndex(dataRoot)).files.length, 1);
});

test("a scan the inbox could not store stays in phone/", async () => {
  const { dataRoot, shared } = await folders({ "bad.jpg": "synthetic" });
  const add = async (root, files) => ({ added: [], duplicates: [], failed: files.map((file) => ({ name: file.name, error: "x" })) });
  const result = await takePhoneScans({ dataRoot, shared, now: NOW, delay: noDelay, add });
  assert.equal(result.failed.length, 1);
  assert.deepEqual(await phoneNames(shared), ["bad.jpg"]);
});

// ---- the button and the line in the inbox dialog ----

function ui({ canCheck, take, shared = {}, root = {} } = {}) {
  const { window } = new JSDOM('<button id="b"></button><span id="l"></span>');
  const button = window.document.querySelector("#b");
  const line = window.document.querySelector("#l");
  const intervals = [];
  const timers = { setInterval: (fn, ms) => intervals.push({ fn, ms }), clearInterval: () => {} };
  const taken = [];
  const intake = setupPhoneIntake({
    button, line, getDataRoot: () => root, getSharedFolder: async () => shared, canCheck, take, timers,
    now: () => NOW, onTaken: (result) => taken.push(result),
  });
  return { button, line, intake, intervals, taken };
}

const empty = { added: [], duplicates: [], failed: [], refused: [], waiting: [], kept: [] };

test("the timer checks every 30 s; a check that found nothing leaves the line alone", async () => {
  let calls = 0;
  const { line, intake, intervals } = ui({ take: async () => { calls += 1; return empty; } });
  await intake.start();
  await intake.start();
  assert.deepEqual(intervals.map((item) => item.ms), [30000]);
  await intervals[0].fn();
  assert.equal(calls, 1);
  assert.equal(line.textContent, "");
});

test("a check that took scans says how many and tells the host", async () => {
  const result = { ...empty, added: [{ name: "a.jpg" }, { name: "b.jpg" }], duplicates: [{ name: "c.jpg" }] };
  const { line, intake, taken } = ui({ take: async () => result });
  await intake.check();
  assert.match(line.textContent, /התקבלו 2 סריקות מהטלפון · 1 כפולות דולגו/);
  assert.equal(taken.length, 1);
});

test("the timer takes nothing while this PC does not hold the baton; the button says why", async () => {
  let calls = 0;
  const { button, line, intake } = ui({ canCheck: async () => false, take: async () => { calls += 1; return empty; } });
  assert.equal(await intake.check(), null);
  assert.equal(line.textContent, "");
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 0);
  assert.match(line.textContent, /פתוחה במחשב אחר/);
});

test("the button runs one check at a time", async () => {
  let release;
  let calls = 0;
  const { button, intake } = ui({ take: () => { calls += 1; return new Promise((resolve) => { release = () => resolve(empty); }); } });
  const first = intake.check({ interactive: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(button.disabled, true);
  assert.equal(await intake.check({ interactive: true }), null);
  release();
  await first;
  assert.equal(calls, 1);
  assert.equal(button.disabled, false);
});

test("without a shared folder no timer runs, and the button says where to choose it", async () => {
  const { line, intake, intervals } = ui({ shared: null, take: async () => assert.fail("no check without a folder") });
  await intake.start();
  assert.equal(intervals.length, 0);
  await intake.check({ interactive: true });
  assert.match(line.textContent, /לא נבחרה תיקייה משותפת/);
});

test("the button asks for the folder permission; the timer does not", async () => {
  const handle = () => {
    const h = { permission: "prompt", queryPermission: async () => h.permission, requestPermission: async () => { h.permission = "granted"; return "granted"; } };
    return h;
  };
  const shared = handle();
  let calls = 0;
  const { intake } = ui({ shared, take: async () => { calls += 1; return empty; } });
  await intake.check();
  assert.deepEqual([shared.permission, calls], ["prompt", 0]);
  await intake.check({ interactive: true });
  assert.deepEqual([shared.permission, calls], ["granted", 1]);
});
