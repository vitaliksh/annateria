import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createDeclaration, saveDraft } from "../declaration-store.js";
import { FAILED, PENDING, setupBookkeeper } from "../bookkeeper-ui.js";
import { binaryDirectory } from "./memory-binary-directory.mjs";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const NOW = "2026-10-10T10:00:00.000Z";
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

// A journal row with the 19 cells of the real table: editable text cells, amount inputs, selects, photo, status, export, delete.
function makeRow(doc, id, { processing = "", date = "12/09/26" } = {}) {
  const row = doc.createElement("tr");
  row.dataset.documentId = id;
  if (processing) row.dataset.processing = processing;
  for (let column = 0; column < 19; column += 1) {
    const cell = doc.createElement("td");
    if ([2, 3, 4, 5, 6, 7, 10, 14, 15].includes(column)) {
      cell.className = "editable";
      cell.contentEditable = "true";
      cell.textContent = column === 2 ? date : `v${column}`;
    }
    if ([8, 9].includes(column)) cell.innerHTML = '<input type="number">';
    if ([1, 11, 12].includes(column)) cell.innerHTML = "<select><option>x</option></select>";
    if (column === 13) cell.innerHTML = '<button class="photo-button">photo</button>';
    if (column === 16) {
      cell.className = "state ready";
      cell.innerHTML = 'מוכן לייצוא<br><button class="retry">עבד מחדש</button>';
    }
    if (column === 17) cell.innerHTML = '<input type="checkbox" checked>';
    if (column === 18) cell.innerHTML = '<button class="delete">מחק</button>';
    row.append(cell);
  }
  return row;
}

async function setup({ rows, open = true, call, beforeRun, locked = false, autoState, confirmAll } = {}) {
  const { window } = new JSDOM(html, { url: "https://vitaliksh.github.io/ocr/" });
  const doc = window.document;
  const records = doc.querySelector("#records");
  records.replaceChildren(...(rows ?? [["a", { processing: PENDING }], ["b", { processing: PENDING }]]).map(([id, options]) => makeRow(doc, id, options)));
  const directory = binaryDirectory("client");
  const declaration = await createDeclaration(directory, { clientId: "c1", month: "2026-09" });
  await saveDraft(declaration.directory, declaration.declaration, [], NOW);
  const client = { directory, config: { clientId: "c1", businessActivity: "x", businessKind: "office" } };
  const log = { applied: [], rechecked: [], after: [], calls: [], saves: 0 };
  const state = { open, locked };
  const snapshots = () =>
    [...records.querySelectorAll("tr[data-document-id]")].map((row, index) => ({
      documentId: row.dataset.documentId, receivedAt: NOW, active: row.cells[17].querySelector("input").checked,
      values: [row.cells[2].textContent, "", "", "ספק", "", `ref${index}`, "", "118.00", "100.00", "18.00"],
      rawNet: 100, rawVat: 18, autoExclude: row.dataset.autoExclude || "",
    }));
  const bookkeeper = setupBookkeeper({
    records,
    button: doc.querySelector("#run-bookkeeper"),
    plate: doc.querySelector("#bookkeeper-plate"),
    isTableLocked: () => state.locked,
    getContext: () =>
      state.open
        ? { client, month: "2026-09", reserved: {}, snapshots, beforeRun, onChange: () => (log.saves += 1),
            call: async (body) => (log.calls.push(body), call ? call(body) : { results: body.rows.map((row) => ({ n: row.n, decision: "expense", rivhit_code: "204", needs_review: false, reason: "ok" })) }) }
        : null,
    applyPlan: (row, plan) => log.applied.push([row.dataset.documentId, plan.index, plan.include]),
    applyRecheck: (row, facts) => log.rechecked.push([row.dataset.documentId, facts.exclude]),
    afterRun: (plans) => log.after.push(plans.length),
    now: () => new Date(2026, 9, 10),
    autoState,
    autoDelayMs: 5,
    confirmAll,
  });
  await settle();
  return { window, doc, records, bookkeeper, log, state, button: doc.querySelector("#run-bookkeeper"), plate: doc.querySelector("#bookkeeper-plate"), rowOf: (id) => records.querySelector(`tr[data-document-id="${id}"]`) };
}

test("rows with fresh OCR are locked, say why, and the button and the plate appear", async () => {
  const { rowOf, button, plate } = await setup();
  const row = rowOf("a");
  assert.ok(row.classList.contains("waiting-agent"));
  assert.equal(row.cells[2].contentEditable, "false");
  assert.equal(row.cells[8].querySelector("input").disabled, true);
  assert.equal(row.cells[1].querySelector("select").disabled, true);
  assert.equal(row.cells[17].querySelector("input").disabled, true);
  for (const open of [row.cells[13].querySelector("button"), row.cells[16].querySelector("button"), row.cells[18].querySelector("button")]) assert.equal(open.disabled, false);
  assert.equal(button.hidden, false);
  assert.ok(button.classList.contains("attention"));
  assert.equal(plate.hidden, false);
  assert.match(plate.textContent, /2 שורות חדשות ממתינות לעיבוד חשבונאי/);
  assert.match(plate.textContent, /אי אפשר לערוך/);
  assert.ok(plate.classList.contains("plate-warning"));
});

test("a waiting row is locked again when something else has re-enabled its cells (the table was unlocked after a restore)", async () => {
  const { rowOf, bookkeeper } = await setup();
  const row = rowOf("a");
  for (const cell of row.querySelectorAll(".editable")) cell.contentEditable = "true";
  for (const control of row.querySelectorAll("select,input")) control.disabled = false;
  bookkeeper.syncAll();
  assert.equal(row.cells[2].contentEditable, "false");
  assert.equal(row.cells[8].querySelector("input").disabled, true);
  assert.equal(row.cells[1].querySelector("select").disabled, true);
});

test("rows that are not waiting stay editable, and with none waiting there is no button and no plate", async () => {
  const { rowOf, button, plate } = await setup({ rows: [["a", {}], ["b", {}]] });
  assert.equal(rowOf("a").cells[2].contentEditable, "true");
  assert.equal(rowOf("a").cells[8].querySelector("input").disabled, false);
  assert.equal(button.hidden, true);
  assert.equal(plate.hidden, true);
});

test("a click on a blocked cell explains instead of doing nothing; the photo and delete stay usable", async () => {
  const { rowOf, plate } = await setup();
  plate.className = "plate bookkeeper-plate";
  plate.textContent = "";
  rowOf("a").cells[4].click();
  assert.match(plate.textContent, /ממתינות לעיבוד חשבונאי/);
  assert.ok(plate.classList.contains("flash"));
  plate.className = "plate bookkeeper-plate";
  plate.textContent = "";
  rowOf("a").cells[13].querySelector("button").click();
  assert.equal(plate.textContent, "");
});

test("a run applies a plan to every waiting row, unlocks them, reports and offers the distribution", async () => {
  const { rowOf, button, plate, log, records } = await setup();
  button.click();
  await settle();
  await settle();
  assert.deepEqual(log.applied.map(([id, index]) => [id, index]), [["a", 0], ["b", 1]]);
  assert.equal(log.calls.length, 1);
  assert.deepEqual(log.calls[0].rows.map((row) => row.n), [1, 2]);
  assert.deepEqual(log.after, [2]);
  assert.equal(rowOf("a").dataset.processing, "");
  assert.equal(rowOf("a").cells[2].contentEditable, "true");
  assert.equal(rowOf("a").cells[8].querySelector("input").disabled, false);
  assert.equal(button.hidden, true);
  assert.ok(!button.classList.contains("attention"));
  assert.match(plate.textContent, /העיבוד החשבונאי הושלם: 2 שורות/);
  assert.ok(plate.classList.contains("plate-success"));
  assert.ok(log.saves >= 1);
  assert.equal(records.querySelectorAll(".waiting-agent").length, 0);
});

test("a failed run opens the rows for manual editing, says what happened and keeps the button for a retry", async () => {
  let fail = true;
  const { rowOf, button, plate, state } = await setup({ call: async (body) => {
    if (fail) throw new Error("Windows Hello לא אושר.");
    return { results: body.rows.map((row) => ({ n: row.n, decision: "expense", rivhit_code: "204", needs_review: false, reason: "ok" })) };
  } });
  button.click();
  await settle();
  await settle();
  assert.equal(rowOf("a").dataset.processing, FAILED);
  assert.equal(rowOf("a").cells[2].contentEditable, "true");
  assert.equal(rowOf("a").cells[8].querySelector("input").disabled, false);
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
  assert.ok(plate.classList.contains("plate-error"));
  assert.match(plate.textContent, /Windows Hello לא אושר/);
  assert.match(plate.textContent, /אפשר לערוך את השורות ידנית/);
  fail = false;
  button.click();
  await settle();
  await settle();
  assert.equal(rowOf("a").dataset.processing, "");
  assert.equal(button.hidden, true);
  assert.equal(state.open, true);
});

test("the run refuses with a message while images are still being read, and calls nothing", async () => {
  const { button, plate, log } = await setup({ beforeRun: async () => "ממתינים לסיום עיבוד של 3 תמונות לפני העיבוד החשבונאי." });
  button.click();
  await settle();
  assert.match(plate.textContent, /ממתינים לסיום עיבוד של 3 תמונות/);
  assert.equal(log.calls.length, 0);
});

test("no open declaration: no button; a locked table keeps the locks until the rows are processed", async () => {
  const closed = await setup({ open: false });
  assert.equal(closed.button.hidden, true);
  const { rowOf, state, bookkeeper } = await setup({ rows: [["a", { processing: PENDING }]] });
  rowOf("a").dataset.processing = "";
  state.locked = true;
  await settle();
  assert.equal(rowOf("a").cells[2].contentEditable, "false");
  assert.equal(bookkeeper.waitingCount(), 0);
});

test("a corrected date asks for the facts again; including a row by hand ends the exclusion", async () => {
  const { rowOf, log } = await setup({ rows: [["a", {}]] });
  const row = rowOf("a");
  row.dataset.autoExclude = "previous-year";
  row.cells[2].textContent = "12/09/26";
  row.cells[2].dispatchEvent(new row.ownerDocument.defaultView.FocusEvent("focusout", { bubbles: true }));
  await settle();
  assert.deepEqual(log.rechecked, [["a", null]]);
  row.cells[3].dispatchEvent(new row.ownerDocument.defaultView.FocusEvent("focusout", { bubbles: true }));
  await settle();
  assert.equal(log.rechecked.length, 1);
  const checkbox = row.cells[17].querySelector("input");
  checkbox.checked = true;
  checkbox.dispatchEvent(new row.ownerDocument.defaultView.Event("change", { bubbles: true }));
  assert.equal(row.dataset.autoExclude, undefined);
});

test("the run starts by itself when the recognition is over, and not before", async () => {
  const state = { value: "busy" };
  const { log, rowOf, plate } = await setup({ autoState: () => state.value });
  await settle();
  assert.equal(log.calls.length, 0, "busy: it keeps waiting");
  assert.equal(rowOf("a").dataset.processing, PENDING);
  assert.match(plate.textContent, /העיבוד יתחיל מעצמו/);
  state.value = "ready";
  await settle();
  await settle();
  assert.equal(log.calls.length, 1);
  assert.deepEqual(log.applied.map(([id]) => id), ["a", "b"]);
  assert.equal(rowOf("a").dataset.processing, "");
  assert.match(plate.textContent, /העיבוד החשבונאי הושלם/);
});

test("without an upload session there is no automatic run: the rows wait for the button", async () => {
  const { log, rowOf, button } = await setup();
  await settle();
  await settle();
  assert.equal(log.calls.length, 0);
  assert.equal(rowOf("a").dataset.processing, PENDING);
  assert.equal(button.hidden, false);
});

test("a failed automatic run does not start again by itself", async () => {
  const { log, rowOf, plate } = await setup({ autoState: () => "ready", call: async () => { throw new Error("no grant"); } });
  await settle();
  await settle();
  await settle();
  assert.equal(log.calls.length, 1, "one attempt, no second one");
  assert.equal(rowOf("a").dataset.processing, FAILED);
  assert.match(plate.textContent, /no grant/);
});

test("an answer that covers only some rows leaves none of them waiting, so it cannot start a loop", async () => {
  const { log, rowOf } = await setup({ autoState: () => "ready", call: async (body) => ({ results: [{ n: body.rows[0].n, decision: "expense", rivhit_code: "204", needs_review: false, reason: "ok" }] }) });
  await settle();
  await settle();
  await settle();
  assert.equal(log.calls.length, 1);
  assert.notEqual(rowOf("a").dataset.processing, PENDING);
  assert.notEqual(rowOf("b").dataset.processing, PENDING);
});

test("runAll asks first, sends only active rows that are not from Excel or income reports, and the run unlocks them", async () => {
  const asked = [];
  const { doc, log, rowOf, bookkeeper } = await setup({
    rows: [["a", {}], ["b", {}], ["import-1-x", {}], ["off", {}], ["inc", {}]],
    confirmAll: async (count) => (asked.push(count), true),
  });
  rowOf("off").cells[17].querySelector("input").checked = false;
  rowOf("inc").dataset.documentKind = "income_report";
  await bookkeeper.runAll();
  await settle();
  await settle();
  assert.deepEqual(asked, [2]);
  assert.equal(log.calls.length, 1);
  assert.deepEqual(log.applied.map(([id]) => id), ["a", "b"]);
  assert.deepEqual(["a", "b", "import-1-x", "off", "inc"].map((id) => rowOf(id).dataset.processing || ""), ["", "", "", "", ""]);
  assert.ok(doc);
});

test("runAll does nothing when the user declines, when the table is locked or when no row qualifies", async () => {
  const declined = await setup({ rows: [["a", {}]], confirmAll: async () => false });
  await declined.bookkeeper.runAll();
  assert.equal(declined.log.calls.length, 0);
  assert.equal(declined.rowOf("a").dataset.processing || "", "");
  const locked = await setup({ rows: [["a", {}]], locked: true });
  await locked.bookkeeper.runAll();
  assert.match(locked.plate.textContent, /נעולה/);
  assert.equal(locked.log.calls.length, 0);
  const none = await setup({ rows: [["import-1-x", {}]] });
  await none.bookkeeper.runAll();
  assert.match(none.plate.textContent, /אין שורות פעילות/);
});

test("runAll puts the rows back when the run is refused (images still being read)", async () => {
  const { bookkeeper, rowOf, plate, log } = await setup({ rows: [["a", {}]], beforeRun: async () => "ממתינים לסיום עיבוד של 2 תמונות לפני העיבוד החשבונאי." });
  await bookkeeper.runAll();
  assert.match(plate.textContent, /ממתינים לסיום עיבוד/);
  assert.equal(rowOf("a").dataset.processing || "", "");
  assert.equal(log.calls.length, 0);
});
