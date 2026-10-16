import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { filesFromDrop, setupInbox } from "../inbox-ui.js";
import { binaryDirectory, listPaths, putFile, readFileBytes } from "./memory-binary-directory.mjs";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const settle = async () => { for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 10)); };
const file = (name, content) => new File([new TextEncoder().encode(content)], name, { lastModified: Date.UTC(2026, 9, 1) });
const levi = { entryName: "Levi", clientName: "Levi Ltd", parent: {} };
const outsider = { entryName: "Elsewhere", clientName: "Opened from elsewhere", parent: null };

function setup({ withRoot = true, clients = [levi, outsider], ...options } = {}) {
  const { window } = new JSDOM(html, { url: "https://vitaliksh.github.io/annateria/" });
  const dialog = window.document.querySelector("#inbox-dialog");
  dialog.showModal = () => { dialog.open = true; };
  const root = binaryDirectory("data");
  const errors = [];
  const inbox = setupInbox({
    dialog, openButton: window.document.querySelector("#open-inbox"), getDataRoot: () => (withRoot ? root : null),
    getClients: () => clients, onError: (message) => errors.push(message), now: () => "2026-10-17T09:00:00.000Z", ...options,
  });
  const q = (selector) => dialog.querySelector(selector);
  const pickFiles = async (files) => {
    Object.defineProperty(q("#inbox-file"), "files", { value: files, configurable: true });
    q("#inbox-file").dispatchEvent(new window.Event("change"));
    await settle();
  };
  const drop = async (dataTransfer, target = q("#inbox-drop")) => {
    const event = new window.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], ...dataTransfer } });
    target.dispatchEvent(event);
    await settle();
    return event;
  };
  return { window, dialog, root, errors, inbox, q, pickFiles, drop, plate: () => q("#inbox-summary").textContent, lines: () => [...q("#inbox-problems").children].map((li) => li.textContent) };
}

test("the page has the inbox dialog and its entry point", () => {
  for (const id of ["open-inbox", "inbox-dialog", "inbox-summary", "inbox-client", "inbox-drop", "inbox-pick", "inbox-file", "inbox-problems", "inbox-error"]) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.match(html, /<link rel="stylesheet" href="inbox\.css">/);
});

test("opening creates the folders of the clients inside the data root and lists only them", async () => {
  const ui = setup();
  ui.window.document.querySelector("#open-inbox").click();
  await settle();
  assert.equal(ui.dialog.open, true);
  assert.deepEqual([...(await ui.root.getDirectoryHandle("inbox")).children.keys()].sort(), ["Levi", "_unsorted"]);
  assert.deepEqual([...ui.q("#inbox-client").options].map((option) => [option.value, option.textContent]), [["", "ללא שיוך (יסווגו אחר כך)"], ["Levi", "Levi Ltd"]]);
  assert.equal(ui.q("#inbox-pick").disabled, false);
});

test("without a data root nothing can be added", async () => {
  const ui = setup({ withRoot: false });
  ui.window.document.querySelector("#open-inbox").click();
  await settle();
  assert.match(ui.plate(), /תיקיית נתונים/);
  assert.equal(ui.q("#inbox-pick").disabled, true);
  assert.equal(ui.q("#inbox-drop").getAttribute("aria-disabled"), "true");
  await ui.pickFiles([file("a.pdf", "a")]);
  assert.deepEqual(await listPaths(ui.root), []);
});

test("the picker stores the files unchanged in _unsorted and reports the count", async () => {
  const ui = setup();
  await ui.inbox.open();
  await ui.pickFiles([file("one.pdf", "first"), file("two.jpg", "second")]);
  assert.match(ui.plate(), /נוספו 2 קבצים/);
  assert.equal(ui.q("#inbox-summary").className, "plate plate-success");
  assert.equal(ui.q("#inbox-problems").hidden, true);
  assert.equal(new TextDecoder().decode(await readFileBytes(ui.root, "inbox/_unsorted/one.pdf")), "first");
  assert.deepEqual(await listPaths(ui.root), ["inbox/_unsorted/one.pdf", "inbox/_unsorted/two.jpg", "inbox/index.json"]);
  assert.equal(ui.q("#inbox-file").value, "", "the picker is cleared so the same file can be chosen again");
});

test("the chosen client decides the folder", async () => {
  const ui = setup();
  await ui.inbox.open();
  ui.q("#inbox-client").value = "Levi";
  await ui.pickFiles([file("inv.pdf", "invoice")]);
  assert.deepEqual(await listPaths(ui.root), ["inbox/Levi/inv.pdf", "inbox/index.json"]);
});

test("a drop reports added files, duplicates, refused types and folders", async () => {
  const ui = setup();
  await ui.inbox.open();
  await ui.pickFiles([file("old.pdf", "seen")]);
  const items = [
    { kind: "file", webkitGetAsEntry: () => ({ isDirectory: false }), getAsFile: () => file("new.png", "fresh") },
    { kind: "file", webkitGetAsEntry: () => ({ isDirectory: false }), getAsFile: () => file("again.pdf", "seen") },
    { kind: "file", webkitGetAsEntry: () => ({ isDirectory: false }), getAsFile: () => file("notes.docx", "word") },
    { kind: "file", webkitGetAsEntry: () => ({ isDirectory: true, name: "Scans" }), getAsFile: () => null },
    { kind: "string", getAsFile: () => null },
  ];
  const event = await ui.drop({ items });
  assert.equal(event.defaultPrevented, true);
  assert.equal(ui.plate(), "נוסף קובץ אחד · קובץ כפול דולג · 2 קבצים לא נקלטו");
  assert.equal(ui.q("#inbox-summary").className, "plate plate-warning");
  assert.deepEqual(ui.lines(), [
    "Scans: תיקייה: יש לגרור קבצים ולא תיקיות",
    "notes.docx: סוג קובץ שאינו נתמך (.docx)",
    "again.pdf: כבר קיים בתיבת הקלט (ללא שיוך)",
  ]);
  assert.deepEqual((await listPaths(ui.root)).filter((path) => path.endsWith(".docx") || path.includes("Scans")), []);
  assert.equal(ui.q("#inbox-drop").dataset.over, "false");
});

test("a drop on the dialog but outside the zone is taken too, and a drag without files is left alone", async () => {
  const ui = setup();
  await ui.inbox.open();
  await ui.drop({ files: [file("x.csv", "1,2")] }, ui.q("#inbox-title"));
  assert.match(ui.plate(), /נוסף קובץ אחד/);
  const text = await ui.drop({ types: ["text/plain"], files: [] });
  assert.equal(text.defaultPrevented, false);
});

test("a file already stored among the images of a declaration is named as such", async () => {
  const ui = setup();
  await putFile(ui.root, "clients/Levi/declarations/2026-08/images/001.jpg", new TextEncoder().encode("photo"));
  await ui.inbox.open();
  await ui.pickFiles([file("copy.jpg", "photo")]);
  assert.match(ui.plate(), /לא נוספו קבצים · קובץ כפול דולג/);
  assert.equal(ui.q("#inbox-summary").className, "plate plate-info");
  assert.deepEqual(ui.lines(), ["copy.jpg: כבר קיים בהצהרה 2026-08 של «Levi»"]);
});

test("the zone opens the picker by click and by keyboard, and the button does not open it twice", async () => {
  const ui = setup();
  await ui.inbox.open();
  let opened = 0;
  ui.q("#inbox-file").click = () => { opened += 1; };
  ui.q("#inbox-drop").click();
  assert.equal(opened, 1);
  ui.q("#inbox-pick").click();
  assert.equal(opened, 2);
  ui.q("#inbox-drop").dispatchEvent(new ui.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(opened, 3);
});

test("a failure of the store is shown and passed on; the dialog stays usable", async () => {
  let calls = 0;
  const ui = setup({ add: async () => { calls += 1; if (calls === 1) throw new Error("אינדקס פגום"); return { added: [], duplicates: [], failed: [] }; } });
  await ui.inbox.open();
  await ui.pickFiles([file("a.pdf", "a")]);
  assert.equal(ui.plate(), "אינדקס פגום");
  assert.equal(ui.q("#inbox-error").textContent, "אינדקס פגום");
  assert.deepEqual(ui.errors, ["תיבת הקלט: אינדקס פגום"]);
  assert.equal(ui.q("#inbox-pick").disabled, false);
  await ui.pickFiles([file("b.pdf", "b")]);
  assert.equal(calls, 2);
});

test("a client that disappeared since the dialog was filled is refused", async () => {
  const clients = [levi];
  const ui = setup({ clients });
  await ui.inbox.open();
  ui.q("#inbox-client").value = "Levi";
  clients.length = 0;
  await ui.pickFiles([file("a.pdf", "a")]);
  assert.equal(ui.plate(), "הלקוח שנבחר אינו זמין.");
  assert.deepEqual(await listPaths(ui.root), []);
});

test("filesFromDrop falls back to dataTransfer.files when there are no items", () => {
  const a = file("a.pdf", "a");
  assert.deepEqual(filesFromDrop({ files: [a] }), { files: [a], refused: [] });
  assert.deepEqual(filesFromDrop(null), { files: [], refused: [] });
});
