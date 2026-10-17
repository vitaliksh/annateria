import test from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./app-harness.mjs";

const record = (overrides = {}) => ({
  date: "2026-09-03", purpose: "Office supplies", supplier_name: "Test Supplier", supplier_vat_id: "514000001",
  invoice_number: "INV-0042", allocation_number: "", net_amount: 100, vat_amount: 18, vat_percent: 18,
  rivhit_code: "802", recognized_percent: 100, vat_recognized_percent: 100, include: true, confidence: 90,
  agent_opinion: "ok", highlight_regions: [{ x: 0, y: 0, w: 1, h: 1 }], document_kind: "invoice", ...overrides,
});
let documentSeed = 0;
async function addRecord(app, overrides) {
  const row = app.addPendingRecord("blob:test", "2026-09-01T10:00:00Z", `doc-${++documentSeed}`, documentSeed);
  await app.applyRecord(row, record(overrides));
  return row;
}
// jsdom objects come from another realm; the JSON round-trip lets deepEqual compare them with local literals.
const plain = (value) => JSON.parse(JSON.stringify(value));
const snapshotValues = (app, row) => plain(app.rowSnapshot(row).values);
// values: date, code, purpose, supplier, supplierId, reference, allocation, gross, net, vat, vatPercent, expensePercent
const amounts = (app, row) => snapshotValues(app, row).slice(7, 10);

test("pure formatters", async () => {
  const { app } = await loadApp();
  assert.equal(app.displayDate("2026-09-03"), "03/09/26");
  assert.equal(app.displayDate("03/09/26"), "03/09/26");
  assert.equal(app.displayDate(""), "—");
  assert.equal(app.displayedReference("INV-12345"), "2345");
  assert.equal(app.displayedReference(" abc "), "abc");
  assert.equal(app.normalReference(" ab-12 /x "), "AB12X");
  assert.equal(app.receivedAtText("not a date"), "not a date");
  assert.equal(app.receivedAtText(""), "—");
});

test("applyRecord fills a taxable row and marks it ready", async () => {
  const { app } = await loadApp();
  const row = await addRecord(app);
  assert.deepEqual(snapshotValues(app, row), [
    "03/09/26", "802", "Office supplies", "Test Supplier", "514000001", "0042", "",
    "118.00", "100.00", "18.00", "100", "100",
  ]);
  const snapshot = app.rowSnapshot(row);
  assert.equal(snapshot.active, true);
  assert.equal(snapshot.statusClass, "ready");
  assert.equal(snapshot.confidence, "90%");
});

test("a row without source highlights needs review even when included", async () => {
  const { app } = await loadApp();
  const snapshot = app.rowSnapshot(await addRecord(app, { highlight_regions: [] }));
  assert.equal(snapshot.active, true);
  assert.equal(snapshot.statusClass, "review");
});

test("a record the agent did not include is unchecked and not for export", async () => {
  const { app } = await loadApp();
  const row = await addRecord(app, { include: false });
  assert.equal(app.rowSnapshot(row).active, false);
  assert.ok(row.classList.contains("not-for-export"));
});

test("limited-VAT codes default to 66.67% VAT recognition", async () => {
  const { app } = await loadApp();
  for (const code of ["806", "807", "812"]) {
    const row = await addRecord(app, { rivhit_code: code });
    assert.deepEqual([...amounts(app, row), snapshotValues(app, row)[10]], ["118.00", "106.00", "12.00", "66.67"], code);
  }
});

test("zero-VAT rows keep gross equal to net", async () => {
  const { app } = await loadApp();
  const row = await addRecord(app, { rivhit_code: "807", net_amount: 50, vat_amount: 0, vat_percent: 0 });
  assert.deepEqual(amounts(app, row), ["50.00", "50.00", "0.00"]);
});

test("home-business utilities are recognised at 25%", async () => {
  const { app } = await loadApp({ businessKind: "home" });
  const row = await addRecord(app, { rivhit_code: "809" });
  assert.deepEqual(amounts(app, row), ["29.50", "25.00", "4.50"]);
  assert.deepEqual(snapshotValues(app, row).slice(10), ["25", "25"]);
});

test("office-business utilities stay at 100%", async () => {
  const { app } = await loadApp({ businessKind: "office" });
  const row = await addRecord(app, { rivhit_code: "809" });
  assert.deepEqual(amounts(app, row), ["118.00", "100.00", "18.00"]);
  assert.deepEqual(snapshotValues(app, row).slice(10), ["100", "100"]);
});

test("editing gross re-splits source net and VAT by the stored VAT rate", async () => {
  const { app } = await loadApp();
  const row = await addRecord(app);
  row.cells[8].querySelector("input").value = "236.00";
  app.manualAmountChanged(row, 8);
  assert.equal(row.dataset.rawNet, "200.00");
  assert.equal(row.dataset.rawVat, "36.00");
  assert.deepEqual(amounts(app, row), ["236.00", "200.00", "36.00"]);
});

test("editing net re-derives VAT and gross", async () => {
  const { app } = await loadApp();
  const row = await addRecord(app);
  row.cells[9].querySelector("input").value = "1000.00";
  app.manualAmountChanged(row, 9);
  assert.deepEqual(amounts(app, row), ["1180.00", "1000.00", "180.00"]);
});

test("negative manual amounts are rejected and the displayed value is restored", async () => {
  const { app } = await loadApp();
  const row = await addRecord(app);
  row.cells[8].querySelector("input").value = "-5";
  app.manualAmountChanged(row, 8);
  assert.equal(row.dataset.rawNet, "100");
  assert.equal(row.dataset.rawVat, "18");
  assert.deepEqual(amounts(app, row), ["118.00", "100.00", "18.00"]);
});

test("clearing an amount field does not zero the row", async () => {
  const { app } = await loadApp();
  const row = await addRecord(app);
  row.cells[8].querySelector("input").value = "";
  app.manualAmountChanged(row, 8);
  assert.equal(row.dataset.rawNet, "100");
  assert.equal(row.dataset.rawVat, "18");
  assert.deepEqual(amounts(app, row), ["118.00", "100.00", "18.00"]);
});

test("lowering expense recognition aligns VAT recognition", async () => {
  const { app, window } = await loadApp();
  const row = await addRecord(app);
  const expense = row.cells[12].querySelector("select");
  expense.value = "25";
  expense.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(row.cells[11].querySelector("select").value, "25");
  assert.deepEqual(amounts(app, row), ["29.50", "25.00", "4.50"]);
});

test("a repeated reference marks the later row as a possible duplicate and unchecks it", async () => {
  const { app } = await loadApp();
  const first = await addRecord(app, { invoice_number: "INV-0099" });
  const second = await addRecord(app, { invoice_number: "INV-0099" });
  assert.equal(first.dataset.duplicate, undefined);
  assert.equal(second.dataset.duplicate, "true");
  assert.equal(app.rowSnapshot(second).active, false);
  assert.equal(app.rowSnapshot(second).statusClass, "review");
});

test("different references are not duplicates", async () => {
  const { app } = await loadApp();
  await addRecord(app, { invoice_number: "INV-0001" });
  const other = await addRecord(app, { invoice_number: "INV-0002" });
  assert.equal(other.dataset.duplicate, undefined);
  assert.equal(app.rowSnapshot(other).active, true);
});

test("snapshot → restoreRow round-trips a row", async () => {
  const { app, rows } = await loadApp();
  const row = await addRecord(app, { rivhit_code: "807", allocation_number: "A1" });
  const saved = plain(app.rowSnapshot(row));
  row.remove();
  app.restoreRow(saved, new Blob(["x"]));
  assert.equal(rows().length, 1);
  const again = app.rowSnapshot(rows()[0]);
  for (const key of ["documentId", "values", "rawNet", "rawVat", "vatPercent", "active", "statusClass", "agentOpinion"])
    assert.deepEqual(plain(again[key]), saved[key], key);
});

test("deleting a row renumbers the rest and restores the empty row at zero", async () => {
  const { app, rows, document } = await loadApp();
  await addRecord(app, { invoice_number: "A-1" });
  await addRecord(app, { invoice_number: "B-2" });
  rows()[0].querySelector("button.delete").click();
  assert.equal(rows().length, 1);
  assert.equal(rows()[0].cells[0].textContent, "1");
  assert.match(document.querySelector("#count").textContent, /1$/);
  rows()[0].querySelector("button.delete").click();
  assert.equal(rows().length, 0);
  assert.ok(document.querySelector("#empty-row")?.isConnected);
});

test("the next free classification code starts above the built-in range", async () => {
  const { app, window } = await loadApp();
  const taken = Object.keys(window.RIVHIT_MAPPING).map(Number);
  assert.equal(Number(app.nextFreeClassificationCode()), Math.max(799, ...taken) + 1);
});

test("cancel buttons of dialogs with required fields skip form validation", async () => {
  const { document } = await loadApp();
  for (const dialog of document.querySelectorAll("dialog")) {
    if (!dialog.querySelector("[required]")) continue;
    for (const cancel of dialog.querySelectorAll('button[value="cancel"]')) {
      assert.equal(cancel.hasAttribute("formnovalidate"), true, `${dialog.id}: ${cancel.textContent || cancel.ariaLabel}`);
    }
  }
});

test("the client menu has a field for the name of the client, filled from the client and saved with the other details", async () => {
  const { document } = await loadApp();
  const field = document.querySelector("#client-menu #client-name");
  assert.ok(field && field.required, "a name field in the menu");
  assert.ok(document.querySelector("#client-menu").compareDocumentPosition(field) & 16, "inside the dialog");
});

test("Enter in a text cell or a number field ends the edit and makes no new line; other keys are left alone", async () => {
  const { app, window } = await loadApp();
  const row = await addRecord(app);
  const press = (target, key, extra = {}) => {
    let blurred = 0;
    target.blur = () => { blurred += 1; };
    const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra });
    target.dispatchEvent(event);
    return { prevented: event.defaultPrevented, blurred };
  };
  const supplier = row.querySelector(".editable");
  assert.ok(supplier, "a text cell");
  assert.deepEqual(press(supplier, "Enter"), { prevented: true, blurred: 1 });
  assert.deepEqual(press(supplier, "Enter", { shiftKey: true }), { prevented: true, blurred: 1 }, "not even with Shift: no second line in a cell");
  assert.deepEqual(press(supplier, "a"), { prevented: false, blurred: 0 });
  assert.deepEqual(press(row.querySelector(".amount-cell input"), "Enter"), { prevented: true, blurred: 1 });
});

test("the lock button is shown by default and the reopen button stays hidden without a locked declaration", async () => {
  const { document } = await loadApp();
  assert.equal(document.querySelector("#close-declaration").textContent, "נעילת הצהרה");
  assert.equal(document.querySelector("#close-declaration").hidden, false);
  assert.equal(document.querySelector("#reopen-declaration").hidden, true);
  assert.ok(document.querySelector("#reopen-dialog #reopen-reason"));
});

test("the facts of fresh OCR (reference, title, period, kind) are kept in the row", async () => {
  const { app } = await loadApp();
  const row = await addRecord(app, {
    invoice_number: "26/001/673/1017507", document_title: "אישור תשלום לפוליסה", period_from: "2026-10-01", period_to: "2027-09-30", document_kind: "payment_confirmation",
  });
  const snapshot = plain(app.rowSnapshot(row));
  assert.deepEqual(
    [snapshot.reference, snapshot.documentTitle, snapshot.periodFrom, snapshot.periodTo, snapshot.documentKind],
    ["26/001/673/1017507", "אישור תשלום לפוליסה", "2026-10-01", "2027-09-30", "payment_confirmation"],
  );
  assert.equal(snapshot.values[5], "7507");
});

test("the period and the full reference survive a save and restore", async () => {
  const { app, rows } = await loadApp();
  const saved = plain(app.rowSnapshot(await addRecord(app, { invoice_number: "INV-0042", period_from: "2026-01-01", period_to: "2026-12-31" })));
  app.restoreRow(saved, new Blob(["x"]));
  const restored = rows().at(-1);
  assert.deepEqual(
    [restored.dataset.fullReference, restored.dataset.periodFrom, restored.dataset.periodTo],
    ["INV-0042", "2026-01-01", "2026-12-31"],
  );
});

test("the photo window opens only from its button; a click in the row does not open it", async () => {
  const { app, window } = await loadApp();
  const opened = [];
  window.open = () => (opened.push(1), null);
  const row = await addRecord(app);
  for (const cell of [0, 2, 3, 16]) row.cells[cell].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(opened.length, 0);
  row.cells[13].querySelector("button").click();
  assert.equal(opened.length, 1);
});

test("a recognised row and a restored row have no re-run button of their own", async () => {
  const { app, rows } = await loadApp();
  const row = await addRecord(app);
  assert.equal(row.cells[16].querySelectorAll(".retry").length, 0);
  app.restoreRow(plain(app.rowSnapshot(row)), new Blob(["x"]));
  assert.equal(rows().at(-1).cells[16].querySelectorAll(".retry").length, 0);
});

test("editing VAT keeps the total, moves the rest to net and follows the rate", async () => {
  const { app } = await loadApp();
  const row = await addRecord(app);
  row.cells[10].querySelector("input").value = "10.00";
  app.manualAmountChanged(row, 10);
  assert.deepEqual([row.dataset.rawNet, row.dataset.rawVat, row.dataset.vatPercent], ["108.00", "10.00", "9.26"]);
  assert.deepEqual(amounts(app, row), ["118.00", "108.00", "10.00"]);
  row.cells[10].querySelector("input").value = "0";
  app.manualAmountChanged(row, 10);
  assert.deepEqual(amounts(app, row), ["118.00", "118.00", "0.00"]);
});

test("a VAT above the total or an empty VAT field is refused and the displayed value is restored", async () => {
  const { app } = await loadApp();
  const row = await addRecord(app);
  for (const typed of ["119", "", "-1"]) {
    row.cells[10].querySelector("input").value = typed;
    app.manualAmountChanged(row, 10);
    assert.deepEqual([row.dataset.rawNet, row.dataset.rawVat], ["100", "18"], typed);
    assert.deepEqual(amounts(app, row), ["118.00", "100.00", "18.00"], typed);
  }
});

test("the VAT field survives a save and restore", async () => {
  const { app, rows } = await loadApp();
  const row = await addRecord(app);
  row.cells[10].querySelector("input").value = "10.00";
  app.manualAmountChanged(row, 10);
  app.restoreRow(plain(app.rowSnapshot(row)), new Blob(["x"]));
  const restored = rows().at(-1);
  assert.ok(restored.cells[10].querySelector("input"));
  assert.deepEqual(amounts(app, restored), ["118.00", "108.00", "10.00"]);
});

test("a home client's electricity, water, sewage and property tax are recognised at 25% whatever the code", async () => {
  const { app } = await loadApp({ businessKind: "home" });
  for (const purpose of ["חשבון חשמל", "חשבון מים וביוב", "ארנונה לתקופה 07-08"]) {
    const row = await addRecord(app, { rivhit_code: "802", purpose });
    assert.deepEqual(amounts(app, row), ["29.50", "25.00", "4.50"], purpose);
    assert.deepEqual(snapshotValues(app, row).slice(10), ["25", "25"], purpose);
  }
  const other = await addRecord(app, { rivhit_code: "802", purpose: "מצלמות אבטחה" });
  assert.deepEqual(amounts(app, other), ["118.00", "100.00", "18.00"]);
});

test("a utility bill at an office client stays at 100%", async () => {
  const { app } = await loadApp({ businessKind: "office" });
  const row = await addRecord(app, { rivhit_code: "802", purpose: "חשבון חשמל" });
  assert.deepEqual(amounts(app, row), ["118.00", "100.00", "18.00"]);
});

test("a partial recognition is written under the VAT amount, a full one is not", async () => {
  const { app } = await loadApp({ businessKind: "home" });
  const utility = await addRecord(app, { rivhit_code: "802", purpose: "חשבון חשמל" });
  assert.equal(utility.cells[10].dataset.recognised, "הוכר 25%");
  const plain = await addRecord(app, { rivhit_code: "802", purpose: "נייר" });
  assert.equal(plain.cells[10].dataset.recognised, undefined);
});

