// What the page does with the rows of the agent: they go into the open table like any other row, keep their data across a save and a
// reopening, show their own status, get their original and open it (a PDF at its page).
import test from "node:test";
import assert from "node:assert/strict";
import { createDeclaration, loadDeclaration, saveDraft, saveSourceImage } from "../declaration-store.js";
import { buildRowSnapshot } from "../row-builder.js";
import { normalizeRecord } from "../agent/fact-record.js";
import { loadApp } from "./app-harness.mjs";
import { rawRecord } from "./agent-fixtures.mjs";
import { binaryDirectory } from "./memory-binary-directory.mjs";

const entry = { hash: "f".repeat(64), addedAt: "2026-10-16T08:00:00.000Z" };
const facts = { reasons: [], exclude: null, year: { year: 2026 }, duplicates: { level: null, matches: [] } };
const snapshot = (overrides = {}, extra = {}) => buildRowSnapshot({
  record: normalizeRecord(rawRecord(overrides)), entry, documentId: "agent-ffff-p0", decision: "expense", account: "202", facts, kind: "office", month: "2026-02",
  reason: "חשבונית משרדית", needsReview: false, agent: { run: "r1", version: "v1", fact: "F1.1" }, ...extra,
});

async function openMonth(rows = [], businessKind = "office") {
  const client = binaryDirectory("Client");
  const created = await createDeclaration(client, { clientId: "c1", month: "2026-02" });
  await saveDraft(created.directory, created.declaration, rows);
  const loaded = await loadDeclaration(client, "2026-02");
  const config = { clientId: "c1", clientName: "Client", businessActivity: "x", businessKind };
  return { client, selected: { workspace: { config, directory: client, parent: {} }, declaration: loaded.declaration, directory: loaded.directory, draft: loaded.draft } };
}

test("rows of the agent are added at the end of the open table, with their values, status and numbers", async () => {
  const { app, rows } = await loadApp();
  const { selected } = await openMonth();
  await app.activateDeclaration(selected);
  const positions = app.appendSnapshots([snapshot(), snapshot({ document_number: "INV-2003", net: 50, vat: 9, total: 59 }, { documentId: "agent-ffff-p1" })]);
  assert.deepEqual(positions, [1, 2]);
  assert.equal(rows().length, 2);
  const first = rows()[0];
  assert.deepEqual([first.cells[0].textContent, first.cells[2].textContent, first.cells[4].textContent, first.cells[6].textContent], ["1", "20/02/26", "Paper Shop", "2002"]);
  assert.deepEqual([first.cells[8].querySelector("input").value, first.cells[9].querySelector("input").value, first.cells[10].querySelector("input").value], ["236.00", "200.00", "36.00"]);
  assert.equal(first.cells[1].querySelector("select").value, "202");
  assert.deepEqual([first.cells[16].textContent, first.cells[16].className], ["מוכן לייצוא", "state ready"], "no 'marks missing' for a row of the agent");
  assert.equal(first.cells[17].querySelector("input").checked, true);
  assert.equal(first.cells[14].textContent, "חשבונית משרדית");
  assert.equal(first.cells[15].textContent, "92%");
  assert.equal(first.cells[13].textContent, "—", "no original yet");
  assert.equal(app.appendSnapshots([snapshot({ document_number: "INV-9" }, { documentId: "agent-ffff-p2" })])[0], 3);
});

test("a row that needs a look, and a row the code excluded, keep their own status and are not checked for export", async () => {
  const { app, rows } = await loadApp();
  const { selected } = await openMonth();
  await app.activateDeclaration(selected);
  app.appendSnapshots([
    snapshot({ document_number: "A-1" }, { needsReview: true, documentId: "a" }),
    snapshot({ document_number: "A-2" }, { documentId: "b", facts: { reasons: ["duplicate"], exclude: "duplicate", year: { year: 2026 }, duplicates: { level: "strong", matches: [] } } }),
  ]);
  assert.deepEqual([rows()[0].cells[16].textContent, rows()[0].cells[16].className, rows()[0].cells[17].querySelector("input").checked], ["נדרש עיון", "state review", true]);
  assert.deepEqual([rows()[1].cells[16].textContent, rows()[1].cells[17].querySelector("input").checked, rows()[1].classList.contains("not-for-export")], ["כפילות — המסמך כבר הוזן", false, true]);
});

test("the data of the agent survives the saving of the table and the reopening of the month", async () => {
  const { app, rows } = await loadApp();
  const { selected, client } = await openMonth();
  await app.activateDeclaration(selected);
  app.appendSnapshots([snapshot()]);
  await app.saveCurrentDraft();
  const saved = (await loadDeclaration(client, "2026-02")).draft.rows[0];
  assert.deepEqual([saved.agent.run, saved.agent.fact, saved.agent.file, saved.agent.page, saved.agent.reasons], ["r1", "F1.1", entry.hash, null, []]);
  assert.deepEqual([saved.values[1], saved.statusText, saved.statusClass, saved.active], ["202", "מוכן לייצוא", "ready", true]);
  const again = await loadApp();
  const reopened = await loadDeclaration(client, "2026-02");
  await again.app.activateDeclaration({ ...selected, declaration: reopened.declaration, draft: reopened.draft, directory: reopened.directory });
  assert.deepEqual([again.rows()[0].cells[16].textContent, again.rows()[0].cells[16].className, again.app.rowSnapshot(again.rows()[0]).agent.fact], ["מוכן לייצוא", "state ready", "F1.1"]);
});

test("an old row is unchanged: an active row without marked regions still says that marks are missing", async () => {
  const { app, rows } = await loadApp();
  const { selected } = await openMonth();
  await app.activateDeclaration(selected);
  const old = { ...snapshot(), agent: undefined, statusText: "מוכן לייצוא", statusClass: "ready" };
  app.restoreRow(old, null);
  assert.deepEqual([rows()[0].cells[16].textContent, rows()[0].cells[16].className], ["מוכן, חסרים סימונים", "state review"]);
});

test("the rows made from one file get its image: the button names the kind, the row remembers the file", async () => {
  const { app, rows } = await loadApp();
  const { selected, client } = await openMonth();
  await app.activateDeclaration(selected);
  app.appendSnapshots([snapshot(), snapshot({ document_number: "B-1" }, { documentId: "other", agent: { run: "r1", version: "v1", fact: "F2.1" }, entry: { ...entry, hash: "e".repeat(64) } })]);
  const month = await client.getDirectoryHandle("declarations").then((d) => d.getDirectoryHandle("2026-02"));
  await saveSourceImage(month, "001.pdf", new File([new Uint8Array([37, 80, 68, 70])], "001.pdf", { type: "application/pdf" }));
  const attached = await app.attachRowImages({ fileHash: entry.hash, imageFile: "001.pdf", imageIndex: 1 });
  assert.equal(attached, 1, "only the row made from that file");
  assert.deepEqual([rows()[0].dataset.imageFile, rows()[0].dataset.imageIndex, rows()[0].cells[13].textContent], ["001.pdf", "1", "מקור PDF #1"]);
  assert.equal(rows()[1].dataset.imageFile ?? "", "");
  assert.equal(app.rowSnapshot(rows()[0]).imageFile, "001.pdf");
});

test("the original of a PDF row opens in the viewer of the browser at the page of the row; an image opens as before, and the window is not reused across kinds", async () => {
  const { app, rows, window } = await loadApp();
  const { selected, client } = await openMonth();
  await app.activateDeclaration(selected);
  const opened = [];
  const popup = (url) => ({ closed: false, location: { href: url }, focus() {}, close() { this.closed = true; }, document: window.document.implementation.createHTMLDocument("p") });
  window.open = (url, name) => { const created = popup(url); opened.push({ url, name, created }); return created; };
  app.appendSnapshots([snapshot({ page: 3 }, { agent: { run: "r", version: "v", fact: "F1.1" } })]);
  const month = await client.getDirectoryHandle("declarations").then((d) => d.getDirectoryHandle("2026-02"));
  await saveSourceImage(month, "001.pdf", new File([new Uint8Array([1])], "001.pdf", { type: "application/pdf" }));
  await app.attachRowImages({ fileHash: entry.hash, imageFile: "001.pdf", imageIndex: 1 });
  rows()[0].cells[13].querySelector("button").click();
  assert.equal(opened.length, 1);
  assert.match(opened[0].url, /#page=3$/);
  assert.equal(opened[0].name, "rivhit-document-image");
  rows()[0].cells[13].querySelector("button").click();
  assert.equal(opened.length, 1, "the viewer that is open is reused");
  assert.match(opened[0].created.location.href, /#page=3$/);
  // a photo after a PDF: the PDF window is closed and a fresh one is made for the image
  const row = rows()[0];
  const photo = new File([new Uint8Array([1])], "002.jpg", { type: "image/jpeg" });
  app.setRowImage(row, photo, "002.jpg", 2);
  row.cells[13].querySelector("button").click();
  assert.equal(opened[0].created.closed, true);
  assert.equal(opened.length, 2);
  assert.equal(opened[1].url, "");
});

// Electricity of a home client: the agent gives 25 %; a line of a ledger (amounts as already booked) keeps 100 %.
const electricity = (overrides = {}, extra = {}) => snapshot({ supplier_name: "Electric Co", purpose: "חשמל", document_title: "חשבון חשמל", ...overrides }, { kind: "home", account: "204", ...extra });

test("a home client: the agent's electricity is 25 %, a booked ledger line keeps 100 % and says so in the saved row", async () => {
  const { app, rows } = await loadApp({ businessKind: "home" });
  const { selected } = await openMonth([], "home");
  await app.activateDeclaration(selected);
  app.appendSnapshots([electricity(), electricity({ booked: true }, { documentId: "agent-ffff-p1" })]);
  const [bill, line] = rows().map((row) => JSON.parse(JSON.stringify(app.rowSnapshot(row))));
  assert.deepEqual(bill.values.slice(8, 12), ["50.00", "9.00", "25", "25"]);
  assert.equal(bill.booked, undefined);
  assert.deepEqual(line.values.slice(8, 12), ["200.00", "36.00", "100", "100"]);
  assert.equal(line.booked, true);
});

test("a home client: percentages saved in the table stay when the month is opened again", async () => {
  const typed = { ...electricity(), values: [...electricity().values.slice(0, 7), "236.00", "200.00", "36.00", "100", "100"] };
  const { app, rows } = await loadApp({ businessKind: "home" });
  const { selected } = await openMonth([typed, { ...electricity({ booked: true }), documentId: "agent-ffff-p1" }], "home");
  await app.activateDeclaration(selected);
  assert.deepEqual(rows().map((row) => [...app.rowSnapshot(row).values.slice(8, 12)]), [["200.00", "36.00", "100", "100"], ["200.00", "36.00", "100", "100"]]);
});

test("a home client: saving the client card again keeps the percentages; a new kind of business applies the rule", async () => {
  const typed = { ...electricity(), values: [...electricity().values.slice(0, 7), "236.00", "200.00", "36.00", "100", "100"] };
  const { app, rows } = await loadApp({ businessKind: "home" });
  const { selected } = await openMonth([typed], "home");
  await app.activateDeclaration(selected);
  app.updateWorkspace({ ...selected.workspace, config: { ...selected.workspace.config, clientName: "Client renamed" } });
  assert.deepEqual([...app.rowSnapshot(rows()[0]).values.slice(10)], ["100", "100"]);
  app.updateWorkspace({ ...selected.workspace, config: { ...selected.workspace.config, businessKind: "office" } });
  app.updateWorkspace({ ...selected.workspace, config: { ...selected.workspace.config, businessKind: "home" } });
  assert.deepEqual([...app.rowSnapshot(rows()[0]).values.slice(10)], ["25", "25"]);
});

test("a HEIC original: the window says it is loading instead of staying black, and says so when the browser cannot show it", async () => {
  const { app, rows, window } = await loadApp();
  const { selected } = await openMonth();
  await app.activateDeclaration(selected);
  const created = { closed: false, focus() {}, close() { this.closed = true; }, document: window.document.implementation.createHTMLDocument("p") };
  window.open = () => created;
  app.appendSnapshots([snapshot()]);
  app.setRowImage(rows()[0], new File([new Uint8Array([1])], "003.heic", { type: "" }), "003.heic", 3);
  rows()[0].cells[13].querySelector("button").click();
  const note = created.document.querySelector("#document-note");
  assert.deepEqual([note.hidden, note.textContent], [false, "טוען את התמונה, רק רגע…"]);
  assert.equal(created.document.querySelector("#document-image").hasAttribute("src"), false);
  // In the test the decoder cannot be loaded from the CDN, as when the browser is offline.
  for (let tries = 0; tries < 50 && note.textContent.startsWith("טוען"); tries += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual([note.hidden, note.textContent], [false, "לא ניתן להציג את מקור #3 בדפדפן."]);
  // The note has no display of its own, which would beat the hidden attribute and leave it over the photo.
  assert.equal(note.style.display, "");
  app.setRowImage(rows()[0], new File([new Uint8Array([1])], "004.jpg", { type: "image/jpeg" }), "004.jpg", 4);
  rows()[0].cells[13].querySelector("button").click();
  assert.equal(note.hidden, true);
});

test("a row imported from Excel has a source button that finds its file in imports/ by its hash; a missing file is said in the window", async () => {
  const { app, rows, window } = await loadApp();
  const { selected } = await openMonth([{ ...snapshot(), agent: undefined, sourceHash: "e".repeat(64), booked: true }]);
  await app.activateDeclaration(selected);
  const button = rows()[0].cells[13].querySelector("button");
  assert.equal(button.textContent, "מקור Excel");
  assert.equal(app.rowSnapshot(rows()[0]).sourceHash, "e".repeat(64));
  const created = { focus() {}, document: window.document.implementation.createHTMLDocument("p") };
  const names = [];
  window.open = (url, name) => { names.push(name); return created; };
  button.click();
  assert.deepEqual(names, ["document-source"]);
  assert.equal(created.document.body.textContent, "טוען את הקובץ, רק רגע…");
  for (let tries = 0; tries < 50 && created.document.body.textContent.startsWith("טוען"); tries += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(created.document.body.textContent, "קובץ המקור לא נמצא בתיקיית imports של הלקוח.");
});
