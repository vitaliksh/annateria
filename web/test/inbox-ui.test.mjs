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

const items = (ui) => [...ui.q("#inbox-list").children].map((node) => (node.tagName === "H4" ? node.textContent : node.querySelector("strong").textContent));
const fill = async (ui) => {
  await ui.inbox.open();
  ui.q("#inbox-client").value = "Levi";
  await ui.pickFiles([file("inv-1.pdf", "one"), file("photo.jpg", "two")]);
  ui.q("#inbox-client").value = "";
  await ui.pickFiles([file("loose.png", "three")]);
};

test("the page has the list, the count line and the clear button", () => {
  for (const id of ["inbox-list", "inbox-count", "inbox-clear"]) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(html.includes("data-inbox-total"));
});

test("the list shows unassigned files first, then each client, with counts, sizes and the date", async () => {
  const counts = [];
  const ui = setup({ onCounts: (value) => counts.push(value) });
  await fill(ui);
  assert.deepEqual(items(ui), ["ללא שיוך (1)", "loose.png", "Levi Ltd (2)", "inv-1.pdf", "photo.jpg"]);
  assert.equal(ui.q("#inbox-count").textContent, "בתיבה: 3 קבצים");
  assert.match(ui.q(".inbox-item .muted").textContent, /^1 KB · 2026-10-01$/);
  assert.equal(ui.q(".inbox-thumb").textContent, "PNG");
  assert.deepEqual(counts.at(-1), { total: 3, byFolder: { Levi: 2, _unsorted: 1 } });
  const badge = ui.window.document.querySelector("[data-inbox-total]");
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, "3");
});

test("refreshCounts reads an existing inbox without opening the dialog; an empty inbox hides the badge", async () => {
  const ui = setup();
  assert.equal(await ui.inbox.refreshCounts(), true);
  assert.equal(ui.window.document.querySelector("[data-inbox-total]").hidden, true);
  assert.equal(ui.q("#inbox-count").textContent, "התיבה ריקה");
  assert.equal(ui.q("#inbox-clear").disabled, true);
  assert.equal(ui.dialog.open, false);
});

test("removing one file moves it to _trash and updates the list and the counts", async () => {
  const counts = [];
  const ui = setup({ onCounts: (value) => counts.push(value) });
  await fill(ui);
  ui.q(".inbox-item[data-hash] .inbox-remove").click();
  await settle();
  assert.equal(ui.plate(), "הועבר לפח: loose.png");
  assert.deepEqual(items(ui), ["Levi Ltd (2)", "inv-1.pdf", "photo.jpg"]);
  assert.deepEqual(await listPaths(ui.root), ["inbox/Levi/inv-1.pdf", "inbox/Levi/photo.jpg", "inbox/_trash/loose.png", "inbox/index.json"]);
  assert.deepEqual(counts.at(-1), { total: 2, byFolder: { Levi: 2 } });
  assert.equal(ui.window.document.querySelector("[data-inbox-total]").textContent, "2");
});

test("clear all asks first; declining changes nothing, accepting moves everything to _trash", async () => {
  const asked = [];
  let answer = false;
  const ui = setup({ confirm: async (question, options) => { asked.push([question, options.confirmLabel]); return answer; } });
  await fill(ui);
  ui.q("#inbox-clear").click();
  await settle();
  assert.match(asked[0][0], /3 קבצים.*inbox\/_trash ולא יימחקו/);
  assert.equal(asked[0][1], "העברה לפח");
  assert.equal(ui.q("#inbox-count").textContent, "בתיבה: 3 קבצים");
  answer = true;
  ui.q("#inbox-clear").click();
  await settle();
  assert.equal(ui.plate(), "הועברו לפח: 3");
  assert.equal(ui.q("#inbox-count").textContent, "התיבה ריקה");
  assert.equal(ui.q("#inbox-clear").disabled, true);
  assert.deepEqual((await listPaths(ui.root)).filter((path) => !path.startsWith("inbox/_trash/")), ["inbox/index.json"]);
  assert.equal((await listPaths(ui.root)).filter((path) => path.startsWith("inbox/_trash/")).length, 3);
  await ui.pickFiles([file("inv-1.pdf", "one")]);
  assert.match(ui.plate(), /נוסף קובץ אחד/, "the same file can be added again after the clean-up");
});

test("problems of the move are listed and the files that stayed remain in the list", async () => {
  const ui = setup({ trash: async (root, hashes) => ({ moved: [], missing: [], failed: hashes.map((hash) => ({ name: "x", error: "נעול" })) }) });
  await fill(ui);
  ui.q(".inbox-remove").click();
  await settle();
  assert.equal(ui.plate(), "לא הועברו קבצים");
  assert.equal(ui.q("#inbox-summary").className, "plate plate-warning");
  assert.deepEqual(ui.lines(), ["x: נעול"]);
  assert.equal(ui.q("#inbox-count").textContent, "בתיבה: 3 קבצים");
});

test("thumbnails are made for photos only; a failure or a missing preview keeps the extension label", async () => {
  const made = [];
  const ui = setup({
    makeThumbnail: async (stored, entry) => {
      made.push(entry.name);
      if (entry.name === "bad.png") throw new Error("cannot decode");
      const canvas = ui.window.document.createElement("canvas");
      canvas.dataset.for = entry.name;
      return canvas;
    },
  });
  await ui.inbox.open();
  await ui.pickFiles([file("ok.jpg", "1"), file("bad.png", "2"), file("doc.pdf", "3"), file("sheet.xlsx", "4")]);
  await settle();
  assert.deepEqual(made.sort(), ["bad.png", "ok.jpg"]);
  const label = (name) => [...ui.dialog.querySelectorAll(".inbox-item")].find((node) => node.querySelector("strong").textContent === name).querySelector(".inbox-thumb");
  assert.equal(label("ok.jpg").querySelector("canvas").dataset.for, "ok.jpg");
  assert.equal(label("bad.png").textContent, "PNG");
  assert.equal(label("doc.pdf").textContent, "PDF");
  assert.equal(label("sheet.xlsx").textContent, "XLSX");
});

test("an unreadable index is reported and the list stays empty", async () => {
  const ui = setup();
  await putFile(ui.root, "inbox/index.json", "{ broken");
  await ui.inbox.open();
  assert.equal(ui.errors.length, 1);
  assert.match(ui.errors[0], /אינו תקין/);
  assert.equal(ui.q("#inbox-count").textContent, "התיבה ריקה");
});

test("buttons of the list are disabled without a data root", async () => {
  const ui = setup({ withRoot: false });
  assert.equal(await ui.inbox.refreshCounts(), true);
  assert.equal(ui.q("#inbox-clear").disabled, true);
});

test("the phone guide has the three routes and opens from the inbox dialog", () => {
  const ui = setup();
  const guide = ui.window.document.querySelector("#phone-guide-dialog");
  let opened = 0;
  guide.showModal = () => { opened += 1; };
  ui.q("#inbox-guide").click();
  assert.equal(opened, 1);
  const headings = [...guide.querySelectorAll("h3")].map((node) => node.textContent);
  assert.equal(headings.length, 3);
  assert.match(headings[0], /WhatsApp/);
  assert.match(headings[1], /סריקה/);
  assert.match(headings[2], /USB/);
  const text = guide.textContent;
  for (const needle of ["«מסמך»", "Save to Files", "Scan Documents", "File transfer", "Transfer to Mac or PC", "Automatic", "Keep Originals", "DCIM", "תיבת קלט"]) {
    assert.ok(text.includes(needle), needle);
  }
});

test("the button that hands the files to the assistant is on only when something waits; it closes the dialog and starts the check", async () => {
  let checks = 0;
  const ui = setup({ onCheck: () => { checks += 1; } });
  await ui.inbox.open();
  assert.equal(ui.q("#inbox-check").disabled, true, "nothing in the inbox yet");
  ui.q("#inbox-check").click();
  assert.equal(checks, 0);
  await ui.pickFiles([file("a.pdf", "alpha")]);
  assert.equal(ui.q("#inbox-check").disabled, false);
  assert.equal(ui.dialog.open, true);
  ui.dialog.close = () => { ui.dialog.open = false; };
  ui.q("#inbox-check").click();
  assert.deepEqual([checks, ui.dialog.open], [1, false]);
  const none = setup({ withRoot: false, onCheck: () => { checks += 1; } });
  assert.equal(none.q("#inbox-check").disabled, true, "no data root");
});

test("the select says it is for the files that are added now", () => {
  assert.match(html, /<label>שיוך ללקוח, לקבצים שמוסיפים עכשיו <select id="inbox-client">/);
});

test("the client that is open in the journal is offered as the folder of new files; without one the choice stays as it was", async () => {
  const open = setup({ getOpenFolder: () => "Levi" });
  open.window.document.querySelector("#open-inbox").click();
  await settle();
  assert.equal(open.q("#inbox-client").value, "Levi");
  const unknown = setup({ getOpenFolder: () => "Elsewhere" });
  unknown.window.document.querySelector("#open-inbox").click();
  await settle();
  assert.equal(unknown.q("#inbox-client").value, "", "a client that has no inbox folder here is not offered");
  const none = setup();
  none.window.document.querySelector("#open-inbox").click();
  await settle();
  assert.equal(none.q("#inbox-client").value, "");
});

// Seen on 23 October 2026: after a reload Chrome lets the page read the data root but refuses to write until it asked.
function writeLockedRoot(ui) {
  const realGet = ui.root.getDirectoryHandle.bind(ui.root);
  Object.assign(ui.root, {
    permission: "prompt",
    requested: 0,
    queryPermission: async () => ui.root.permission,
    requestPermission: async () => { ui.root.requested += 1; ui.root.permission = "granted"; return "granted"; },
    getDirectoryHandle: async (name, options = {}) => {
      if (options.create && ui.root.permission !== "granted") {
        throw Object.assign(new Error("The request is not allowed by the user agent or the platform in the current context."), {
          name: "NotAllowedError",
        });
      }
      return realGet(name, options);
    },
  });
}

test("opening the inbox after a reload asks Chrome for the write permission first, then creates the folders", async () => {
  const ui = setup();
  writeLockedRoot(ui);
  ui.window.document.querySelector("#open-inbox").click();
  await settle();
  assert.deepEqual(ui.errors, []);
  assert.equal(ui.root.requested, 1);
  assert.deepEqual([...(await ui.root.getDirectoryHandle("inbox")).children.keys()].sort(), ["Levi", "_unsorted"]);
  ui.window.document.querySelector("#open-inbox").click();
  await settle();
  assert.equal(ui.root.requested, 1);
});

test("a refused permission is said plainly and nothing is written", async () => {
  const ui = setup();
  writeLockedRoot(ui);
  ui.root.requestPermission = async () => { ui.root.requested += 1; return "denied"; };
  ui.window.document.querySelector("#open-inbox").click();
  await settle();
  assert.match(ui.errors[0], /הרשאה/);
  await assert.rejects(ui.root.getDirectoryHandle("inbox"), { name: "NotFoundError" });
});
