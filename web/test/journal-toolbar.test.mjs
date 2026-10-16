import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { FILTERS, matchesFilter, rowKinds, setupJournalToolbar } from "../journal-toolbar.js";
import { formatShekels, summarise, summaryItems } from "../journal-summary.js";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8").replace(/<script\b[^>]*><\/script>/g, "");

function page() {
  const dom = new JSDOM(html, { url: "https://vitaliksh.github.io/ocr/" });
  const { document } = dom.window;
  const records = document.querySelector("#records");
  records.replaceChildren();
  const addRow = ({ id, supplier = "ספק", state = "ready", duplicate = false, excluded = false, image = "001.jpg" }) => {
    const row = document.createElement("tr");
    row.dataset.documentId = id;
    if (image) row.dataset.imageFile = image;
    if (duplicate) row.dataset.duplicate = "true";
    if (excluded) row.classList.add("not-for-export");
    for (let index = 0; index < 19; index += 1) row.append(document.createElement("td"));
    row.cells[4].textContent = supplier;
    row.cells[16].className = `state ${state}`;
    row.cells[16].textContent = state;
    records.append(row);
    return row;
  };
  return { dom, document, records, addRow, menu: document.querySelector("#filter-menu"), summaryElement: document.querySelector("#journal-summary") };
}

test("a row needs review only when flagged, included, and either photographed or a possible duplicate", () => {
  const { addRow } = page();
  assert.deepEqual(rowKinds(addRow({ id: "a", state: "review" })), { review: true, duplicate: false, excluded: false });
  assert.equal(rowKinds(addRow({ id: "b", state: "review", image: "" })).review, false);
  assert.equal(rowKinds(addRow({ id: "c", state: "review", image: "", duplicate: true })).review, true);
  assert.equal(rowKinds(addRow({ id: "d", state: "review", excluded: true })).review, false);
  assert.equal(matchesFilter(addRow({ id: "e" }), "all"), true);
  assert.deepEqual(FILTERS.map((filter) => filter.key), ["all", "review", "duplicate", "excluded"]);
});

test("the filter menu lists counts, filters rows, and disables empty filters", () => {
  const { records, addRow, menu } = page();
  addRow({ id: "a" });
  addRow({ id: "b", state: "review", duplicate: true });
  addRow({ id: "c", excluded: true });
  const toolbar = setupJournalToolbar({ records, menu, summary: null });
  const labels = () => [...menu.querySelectorAll(".menu-panel button")].map((button) => button.textContent);
  assert.deepEqual(labels(), ["הכול · 3", "לבדיקה · 1", "כפילויות · 1", "מחוץ לדוחות · 1"]);
  menu.querySelector('[data-filter="duplicate"]').click();
  assert.deepEqual([...records.rows].map((row) => row.hidden), [true, false, true]);
  assert.equal(menu.querySelector("summary").dataset.active, "כפילויות");
  assert.equal(menu.querySelector('[data-filter="duplicate"]').getAttribute("aria-checked"), "true");
  menu.querySelector('[data-filter="all"]').click();
  assert.equal(menu.querySelector("summary").dataset.active, "");
  assert.equal(toolbar.getFilter(), "all");
  records.rows[1].dataset.duplicate = "false";
  records.rows[1].cells[16].className = "state ready";
  toolbar.refresh();
  assert.equal(menu.querySelector('[data-filter="duplicate"]').disabled, true);
});

test("the summary bar shows labelled figures, flags review and excluded rows, and hides when the journal is empty", () => {
  const { records, addRow, menu, summaryElement } = page();
  const figures = { rows: 1, turnover: 10000, expenses: 200, outputVat: 1800, inputVat: 36, equipmentVat: 0, payable: 1764 };
  setupJournalToolbar({ records, menu, summary: { element: summaryElement, compute: () => (records.querySelector("tr") ? figures : { rows: 0 }) } });
  assert.equal(summaryElement.hidden, true);
  addRow({ id: "a", state: "review" });
  addRow({ id: "b", excluded: true });
  const toolbar = setupJournalToolbar({ records, menu: null, summary: { element: summaryElement, compute: () => figures } });
  toolbar.refresh();
  assert.equal(summaryElement.hidden, false);
  const text = [...summaryElement.querySelectorAll(".summary-item")].map((item) => item.textContent);
  assert.deepEqual(text, ["מחזור10,000 ₪", "הוצאות200 ₪", "מע״מ עסקאות1,800 ₪", "מע״מ תשומות36 ₪", "לתשלום1,764 ₪", "לבדיקה1", "מחוץ לדוחות1"]);
});

test("summarise uses the VAT report logic: income by chart type, equipment separate, payable = output - input - equipment", () => {
  const chart = { 160: { name: "הכנסות", type: "income" }, 202: { name: "משרדיות", type: "expense" }, 900: { name: "ציוד", type: "equipment" } };
  const row = (code, net, vat, active = true) => ({ active, values: ["2026-05-01", code, "", "x", "", "", "", String(net + vat), String(net), String(vat)] });
  const result = summarise([row("160", 10000, 1800), row("202", 200, 36), row("202", 99, 18, false), row("900", 1000, 180)], { chart });
  assert.deepEqual([result.turnover, result.expenses, result.outputVat, result.inputVat, result.equipmentVat, result.payable, result.hasIncome], [10000, 200, 1800, 36, 180, 1584, true]);
  assert.equal(formatShekels(-1234.4), "1,234 ₪");
  const refund = summaryItems({ ...result, payable: -50 }).at(-1);
  assert.deepEqual([refund.label, refund.value], ["להחזר", "50 ₪"]);
  assert.ok(summaryItems(result).some((item) => item.label === "מע״מ ציוד"));
  assert.deepEqual(summaryItems({ rows: 0 }), []);
});
