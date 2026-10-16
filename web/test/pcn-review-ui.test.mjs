import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { setupJournalColumns } from "../journal-columns.js";
import { setupPcnReview } from "../pcn-review-ui.js";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

// A journal row with the 19 cells of the real table; the amounts, reference and allocation live in the cells and in
// the dataset the way rowSnapshot reads them.
function makeRow(doc, id, { net = 6000, vat = 1080, allocation = "", reference = id, date = "10/07/26", active = true } = {}) {
  const row = doc.createElement("tr");
  row.dataset.documentId = id;
  row.dataset.rawNet = String(net);
  row.dataset.rawVat = String(vat);
  row.dataset.fullReference = reference;
  for (let column = 0; column < 19; column += 1) row.append(doc.createElement("td"));
  row.cells[2].textContent = date;
  row.cells[4].textContent = "Acme Ltd";
  row.cells[5].textContent = "515000001";
  row.cells[7].textContent = allocation;
  row.cells[9].textContent = String(net);
  row.cells[10].textContent = String(vat);
  row.cells[16].className = "state ready";
  row.cells[16].innerHTML = 'מוכן לייצוא<br><button class="retry">עבד מחדש</button>';
  row.cells[17].innerHTML = `<input type="checkbox"${active ? " checked" : ""}>`;
  return row;
}
const snapshot = (row) => ({
  documentId: row.dataset.documentId,
  values: [row.cells[2].textContent, "", "", "", row.cells[5].textContent, row.dataset.fullReference.slice(-4), row.cells[7].textContent, "", row.cells[9].textContent, row.cells[10].textContent],
  rawNet: row.dataset.rawNet,
  rawVat: row.dataset.rawVat,
  reference: row.dataset.fullReference,
  pcnApproved: row.dataset.pcnApproved || "",
  active: row.cells[17].querySelector("input").checked,
  statusText: row.cells[16].childNodes[0]?.textContent?.trim(),
});

function setup({ rows, pcnRequired = true, locked = false } = {}) {
  const { window } = new JSDOM(html, { url: "https://vitaliksh.github.io/ocr/" });
  const doc = window.document;
  const records = doc.querySelector("#records");
  records.replaceChildren(...(rows ?? [makeRow(doc, "big"), makeRow(doc, "small", { net: 100 })]));
  const columns = setupJournalColumns({ table: doc.querySelector("#journal-table"), menu: doc.querySelector("#columns-menu"), storage: null });
  const state = { pcnRequired, locked, saves: 0 };
  const pcn = setupPcnReview({
    records,
    plate: doc.querySelector("#pcn-plate"),
    columns,
    snapshot,
    isTableLocked: () => state.locked,
    onChange: () => { state.saves += 1; },
    getContext: () => (state.open === false ? null : { pcnRequired: state.pcnRequired }),
  });
  return { window, doc, records, columns, pcn, state, plate: doc.querySelector("#pcn-plate"), allocationCol: () => doc.querySelector("#journal-table colgroup").children[7] };
}
const box = (row) => row.querySelector(".pcn-approve input");
const click = (window, input) => {
  input.checked = !input.checked;
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
};

test("a client without the PCN duty sees nothing: no colour, no box, no plate, allocation column as chosen", () => {
  const { records, plate, allocationCol } = setup({ pcnRequired: false });
  assert.equal(records.querySelector("[data-pcn]"), null);
  assert.equal(box(records), null);
  assert.equal(plate.hidden, true);
  assert.equal(allocationCol().style.visibility, "collapse");
});

test("an invoice above the ceiling gets a yellow row, a box and a plate; a small one does not", () => {
  const { records, plate, allocationCol } = setup();
  const [big, small] = records.rows;
  assert.equal(big.dataset.pcn, "review");
  assert.ok(box(big));
  assert.equal(box(big).checked, false);
  assert.equal(small.dataset.pcn, undefined);
  assert.equal(box(small), null);
  assert.equal(plate.hidden, false);
  assert.match(plate.textContent, /1 שורה מעל סף מספר ההקצאה ממתינה לאישור/);
  assert.match(plate.textContent, /1 שורה ללא מספר הקצאה/);
  assert.equal(allocationCol().style.visibility, "", "the allocation column is shown for this client");
});

test("the box label text does not leak into the status text that is saved", () => {
  const { records } = setup();
  assert.equal(snapshot(records.rows[0]).statusText, "מוכן לייצוא");
  assert.equal(records.rows[0].cells[16].textContent.includes("נבדק"), false);
});

test("a missing allocation number is marked in its cell and explained in a tooltip; giving it clears the mark", async () => {
  const { records, window } = setup();
  const cell = records.rows[0].cells[7];
  assert.equal(cell.dataset.pcnMissing, "true");
  assert.match(cell.title, /5,000/);
  cell.textContent = "123456789";
  cell.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
  await settle();
  assert.equal(cell.dataset.pcnMissing, undefined);
  assert.equal(cell.title, "");
});

test("ticking the box approves exactly this document, saves the table and turns the row white", () => {
  const { records, window, state, plate } = setup();
  const [big] = records.rows;
  big.cells[7].textContent = "123456789";
  click(window, box(big));
  assert.ok(big.dataset.pcnApproved);
  assert.equal(state.saves, 1);
  assert.equal(big.dataset.pcn, "approved");
  assert.equal(box(big).checked, true);
  assert.match(plate.textContent, /כל החשבוניות מעל סף מספר ההקצאה אושרו/);
  click(window, box(big));
  assert.equal(big.dataset.pcnApproved, "");
  assert.equal(big.dataset.pcn, "review");
});

test("editing an approved amount takes the approval back", async () => {
  const { records, window } = setup();
  const [big] = records.rows;
  big.cells[7].textContent = "123456789";
  click(window, box(big));
  assert.equal(big.dataset.pcn, "approved");
  big.dataset.rawNet = "6500";
  big.cells[2].dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
  await settle();
  assert.equal(big.dataset.pcn, "review");
  assert.equal(box(big).checked, false);
});

test("the lock check names what is left and passes once every invoice is approved and numbered", () => {
  const { records, window, pcn } = setup();
  const [big] = records.rows;
  assert.match(pcn.lockProblem(), /יש 1 שורה מעל סף מספר ההקצאה/);
  click(window, box(big));
  assert.match(pcn.lockProblem(), /שלא אושרו או שחסר להן מספר הקצאה/, "approved but still without a number");
  big.cells[7].textContent = "123456789";
  click(window, box(big));
  click(window, box(big));
  assert.equal(pcn.lockProblem(), "");
});

test("a locked table keeps the box visible but disabled", () => {
  const { records, state, pcn } = setup({ locked: true });
  pcn.refresh();
  assert.equal(state.locked, true);
  assert.equal(box(records.rows[0]).disabled, true);
});

test("switching the client off removes the marks and gives the column back to the user", () => {
  const { records, state, pcn, plate, allocationCol } = setup();
  assert.ok(records.querySelector("[data-pcn]"));
  state.pcnRequired = false;
  pcn.refresh();
  assert.equal(records.querySelector("[data-pcn]"), null);
  assert.equal(box(records), null);
  assert.equal(plate.hidden, true);
  assert.equal(allocationCol().style.visibility, "collapse");
});

test("rows that are not active or come from Excel are left alone", () => {
  const { doc, records, pcn } = setup({ rows: [] });
  records.append(makeRow(doc, "off", { active: false }), makeRow(doc, "import-1-abc"));
  pcn.refresh();
  assert.equal(records.querySelector("[data-pcn]"), null);
});
