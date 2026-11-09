import test from "node:test";
import assert from "node:assert/strict";
import { createDeclaration, loadDeclaration, saveDraft } from "../declaration-store.js";
import { binaryDirectory } from "./memory-binary-directory.mjs";
import { loadApp } from "./app-harness.mjs";

// A copy restored without images (the default of the backup) keeps imageFile in the draft table of an open month.
const row = (id, imageFile) => ({
  documentId: id, imageIndex: 1, imageFile, receivedAt: "2026-10-01T10:00:00.000Z",
  values: ["10/09/26", "", "x", "Supplier", "514000001", "1234", "", "118.00", "100.00", "18.00", "100", "100"],
  rawNet: "100", rawVat: "18", vatPercent: 18, reference: "INV-1234", active: true,
  agentOpinion: "—", confidence: "", statusText: "מוכן לייצוא", statusClass: "ready",
});

async function restoredMonth(rows) {
  const client = binaryDirectory("Client");
  const created = await createDeclaration(client, { clientId: "c1", month: "2026-09" });
  await saveDraft(created.directory, created.declaration, rows, "2026-10-11T10:00:00.000Z");
  const loaded = await loadDeclaration(client, "2026-09");
  const config = { clientId: "c1", clientName: "Client", businessActivity: "x", businessKind: "office" };
  return { client, selected: { workspace: { config, directory: client, parent: {} }, declaration: loaded.declaration, directory: loaded.directory, draft: loaded.draft } };
}

test("an open month restored without its images still shows its rows, without photos", async () => {
  const { app, rows } = await loadApp();
  const { selected } = await restoredMonth([row("d1", "001.jpg"), row("d2", "002.jpg")]);
  assert.equal(await app.activateDeclaration(selected), true);
  assert.equal(rows().length, 2);
  assert.equal(rows()[0].cells[6].textContent, "1234");
  assert.equal(rows()[0].dataset.imageFile, "001.jpg", "the reference to the image is kept, so a later copy of the images works");
});

test("opening a month that fails half way must not let the next save empty its table", async () => {
  const { app, rows } = await loadApp();
  const { client, selected } = await restoredMonth([row("d1", "001.jpg"), row("d2", "002.jpg")]);
  // An unreadable image that is not simply missing: the opening fails.
  const images = await client.getDirectoryHandle("declarations").then((d) => d.getDirectoryHandle("2026-09")).then((d) => d.getDirectoryHandle("images", { create: true }));
  const broken = { kind: "file", name: "001.jpg", getFile: async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); } };
  const realGet = images.getFileHandle;
  images.getFileHandle = async (name, options) => (name === "001.jpg" ? broken : realGet.call(images, name, options));
  await assert.rejects(app.activateDeclaration(selected), /001\.jpg/);
  await app.saveCurrentDraft();
  const draft = (await loadDeclaration(client, "2026-09")).draft;
  assert.equal(draft.rows.length, 2, "the saved table is untouched");
  assert.equal(rows().length, 0);
});

// Lab, 8 November 2026: the filter "לבדיקה" chosen in one month stayed on when the next month opened, so most of its rows seemed
// missing until "הכול" was clicked.
test("opening a month shows all its rows, whatever filter the last month had", async () => {
  const { app, rows, document } = await loadApp();
  const drawn = () => new Promise((resolve) => setTimeout(resolve, 20));
  // A row left out of the reports is not one to look at.
  const other = { ...row("d2", "002.jpg"), reference: "INV-5678", rawNet: "200", rawVat: "36", active: false };
  other.values = ["11/09/26", "", "x", "Other supplier", "514000002", "5678", "", "236.00", "200.00", "36.00", "100", "100"];
  const { selected } = await restoredMonth([row("d1", "001.jpg"), other]);
  await app.activateDeclaration(selected);
  await drawn();
  document.querySelector('[data-filter="review"]').click();
  assert.deepEqual(rows().map((tr) => tr.hidden), [false, true]);
  await app.activateDeclaration(selected);
  await drawn();
  assert.deepEqual(rows().map((tr) => tr.hidden), [false, false]);
});

// Eva's September, 8 November 2026: opening a month turned off every row whose last four digits matched a row above it, whatever the
// supplier and amount (the policy of 2026-27 as a copy of 2025-26; a tax invoice as a copy of its till receipt).
test("opening a month turns off only a real copy: the same full number, supplier and amount", async () => {
  const { app, rows } = await loadApp();
  const policy = (id, reference, date) => ({ ...row(id, "001.jpg"), reference, values: [date, "", "x", "Phoenix", "520004078", reference.slice(-4), "", "941.00", "941.00", "0.00", "100", "100"], rawNet: "941", rawVat: "0" });
  const other = (id) => ({ ...row(id, "002.jpg"), reference: "SHOP-7507", values: ["12/09/26", "", "x", "Shop", "514000002", "7507", "", "50.00", "42.37", "7.63", "100", "100"], rawNet: "42.37", rawVat: "7.63" });
  const copy = (id) => ({ ...policy(id, "26/001/673/1017507", "07/09/26") });
  const { selected } = await restoredMonth([policy("a", "25/001/673/1017507", "16/09/25"), policy("b", "26/001/673/1017507", "07/09/26"), other("c")]);
  await app.activateDeclaration(selected);
  app.appendSnapshots([copy("d")]);
  const off = rows().map((tr) => tr.classList.contains("not-for-export"));
  assert.deepEqual(off, [false, false, false, true], "only the second copy of the same policy is off");
});

// Review of 9 November 2026: a saved choice stands when the month opens again; a receipt above its new tax invoice is turned off.
test("opening a month keeps the rows as saved; the receipt of a tax invoice that arrives is turned off", async () => {
  const { app, rows } = await loadApp();
  const paper = (id, reference, vat) => ({ ...row(id, "001.jpg"), reference, documentKind: "expense_invoice",
    values: ["10/09/26", "", "x", "Shop", "514000002", reference.slice(-4), "", "118.00", (118 - vat).toFixed(2), vat.toFixed(2), "100", "100"],
    rawNet: String(118 - vat), rawVat: String(vat) });
  const kept = { ...paper("k", "R-9001", 0), reference: "R-9001" };
  const { selected } = await restoredMonth([paper("r", "R-1001", 0), kept, { ...paper("t", "T-9001", 18), documentId: "kept-invoice" }]);
  await app.activateDeclaration(selected);
  assert.deepEqual(rows().map((tr) => tr.classList.contains("not-for-export")), [false, false, false], "nothing saved is turned off by opening");
  app.appendSnapshots([paper("t2", "T-2002", 18)]);
  const off = rows().map((tr) => tr.classList.contains("not-for-export"));
  assert.deepEqual(off, [true, true, false, false], "the receipts of the same day and amount are off, the invoices stay");
});

// The owner, 9 November 2026: the empty fields of a bad photo stay empty and red until the user types them.
test("a row of a bad photo opens with empty red amounts; typing the total fills them and clears the mark", async () => {
  const { app, rows, window } = await loadApp();
  const bad = { ...row("d1", "001.jpg"), values: ["10/09/26", "", "x", "Supplier", "514000001", "1234", "", "", "", "", "100", "100"], rawNet: "", rawVat: "", unreadable: ["amounts"], statusText: "צילום לא קריא – לצלם מחדש", statusClass: "review" };
  const { selected } = await restoredMonth([bad]);
  await app.activateDeclaration(selected);
  const [tr] = rows();
  const amounts = () => [8, 9, 10].map((column) => tr.cells[column].querySelector("input").value);
  assert.deepEqual(amounts(), ["", "", ""]);
  assert.equal(tr.dataset.unreadable, "amounts");
  assert.deepEqual([...app.rowSnapshot(tr).unreadable], ["amounts"], "the mark is saved with the row");
  tr.cells[8].querySelector("input").value = "118";
  app.manualAmountChanged(tr, 8);
  assert.deepEqual(amounts(), ["118.00", "100.00", "18.00"]);
  assert.equal(tr.dataset.unreadable, undefined);
});

// The owner, 9 November 2026: "צילום חדש" on the row of a bad photo; the new photo becomes the original and the old one stays.
test("a retake fills the row of a bad photo from the new photo at once, and keeps the old photo", async () => {
  const { app, rows, window } = await loadApp();
  const { rawRecord } = await import("./agent-fixtures.mjs");
  const { normalizeRecord } = await import("../agent/fact-record.js");
  const bad = { ...row("d1", "001.jpg"), values: ["", "202", "x", "Paper Shop", "512345679", "2002", "", "", "", "", "100", "100"], rawNet: "", rawVat: "", unreadable: ["amounts", "date"], statusText: "צילום לא קריא – לצלם מחדש", statusClass: "review" };
  const { client, selected } = await restoredMonth([bad]);
  const images = await (await (await client.getDirectoryHandle("declarations")).getDirectoryHandle("2026-09")).getDirectoryHandle("images", { create: true });
  const old = await (await images.getFileHandle("001.jpg", { create: true })).createWritable();
  await old.write("old photo");
  await old.close();
  await app.activateDeclaration(selected);
  const [tr] = rows();
  window.URL.createObjectURL = () => "blob:test";
  await app.applyRetake(tr, new window.File(["new photo"], "retake.jpg", { type: "image/jpeg" }), normalizeRecord(rawRecord()));
  assert.deepEqual([8, 9, 10].map((column) => tr.cells[column].querySelector("input").value), ["236.00", "200.00", "36.00"]);
  assert.equal(tr.cells[2].textContent, "20/02/26");
  assert.equal(tr.dataset.unreadable, undefined);
  assert.equal(tr.dataset.imageFile, "002.jpg");
  const saved = app.rowSnapshot(tr);
  assert.deepEqual([...saved.previousImages], ["001.jpg"]);
  assert.deepEqual([saved.statusText, saved.statusClass], ["עודכן מצילום חדש – לבדיקה", "review"]);
  const names = [];
  for await (const [name] of images.entries()) names.push(name);
  assert.deepEqual(names.sort(), ["001.jpg", "002.jpg"]);
});

test("a retake that is still unreadable leaves the amounts empty and the row red", async () => {
  const { app, rows, window } = await loadApp();
  const { rawRecord } = await import("./agent-fixtures.mjs");
  const { normalizeRecord } = await import("../agent/fact-record.js");
  const { selected } = await restoredMonth([row("d1", "001.jpg")]);
  await app.activateDeclaration(selected);
  const [tr] = rows();
  window.URL.createObjectURL = () => "blob:test";
  await app.applyRetake(tr, new window.File(["still bad"], "retake.jpg", { type: "image/jpeg" }), normalizeRecord(rawRecord({ confidence: 30 })));
  assert.deepEqual([8, 9, 10].map((column) => tr.cells[column].querySelector("input").value), ["", "", ""]);
  assert.equal(tr.dataset.unreadable, "amounts date");
  assert.equal(app.rowSnapshot(tr).statusText, "צילום לא קריא – לצלם מחדש");
});
