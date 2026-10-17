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

async function openMonth(rows = []) {
  const client = binaryDirectory("Client");
  const created = await createDeclaration(client, { clientId: "c1", month: "2026-02" });
  await saveDraft(created.directory, created.declaration, rows);
  const loaded = await loadDeclaration(client, "2026-02");
  const config = { clientId: "c1", clientName: "Client", businessActivity: "x", businessKind: "office" };
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
  assert.deepEqual([rows()[0].dataset.imageFile, rows()[0].dataset.imageIndex, rows()[0].cells[13].textContent], ["001.pdf", "1", "PDF #1"]);
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
