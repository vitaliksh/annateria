import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { SEED_CHART_OF_ACCOUNTS, matchClassNames, normaliseChart } from "../chart-of-accounts.js";
import { buildImportedRows } from "../excel-import.js";
import { parseJournalGrid } from "../excel-journal.js";
import { advancesReport, classificationLedger, profitLoss, reportEntries, vatReport } from "../reports.js";
import { buildJournalGrid } from "./excel-journal-fixture.mjs";

// reports-view.js builds nodes with the global document, so bind one before importing it.
globalThis.document = new JSDOM("<!doctype html><body></body>").window.document;
const { formatAmount, renderAdvancesReport, renderLedgerReport, renderProfitLossReport, renderVatReport } = await import("../reports-view.js");

const accounts = normaliseChart({ accounts: SEED_CHART_OF_ACCOUNTS });
const parsed = parseJournalGrid(buildJournalGrid()).rows;
const rows = buildImportedRows(parsed, matchClassNames(parsed.map((r) => r.classificationName), accounts).codes);
const entries = reportEntries([{ month: "2026-01", status: "open", rows }], accounts);
const context = { clientName: "Test Client", from: "2026-01", to: "2026-02" };
const cells = (node) => [...node.querySelectorAll("tr")].map((tr) => [...tr.children].map((cell) => cell.textContent));

test("формат сумм: скобки для отрицательных, разделитель тысяч, минус ноль не показывается", () => {
  assert.equal(formatAmount(-1325.4, 2), "(1,325.40)");
  assert.equal(formatAmount(172046), "172,046");
  assert.equal(formatAmount(-0.001, 2), "0.00");
});

test("вид отчёта НДС: строки, сумма к уплате и предупреждение о незакрытых", () => {
  const node = renderVatReport(vatReport(entries), context);
  assert.equal(node.dir, "rtl");
  assert.deepEqual(cells(node).slice(1), [
    ["מחזור עסקאות", "10,000"], ["מע״מ עסקאות (18%)", "1,800"], ["מע״מ תשומות", "250"], ["מע״מ תשומות ציוד", "270"],
    ["סה״כ מע״מ לתשלום", "1,280"],
  ]);
  assert.equal(node.querySelector(".report-warning").textContent, "קיימות 8 תנועות לא מעודכנות");
  assert.match(node.querySelector(".report-period").textContent, /2026-01 – 2026-02/);
});

test("вид отчёта НДС: отрицательный результат — к возврату, без предупреждения при закрытых", () => {
  const closed = reportEntries([{ month: "2026-01", status: "closed", rows }], accounts);
  const refund = { ...vatReport(closed), payable: -40 };
  const node = renderVatReport(refund, context);
  assert.equal(node.querySelector(".report-warning"), null);
  assert.deepEqual(cells(node).at(-1), ["סה״כ מע״מ להחזר", "40"]);
});

test("вид отчёта по авансам", () => {
  const node = renderAdvancesReport(advancesReport(entries, { percent: 12 }), context);
  assert.deepEqual(cells(node).slice(1).map((r) => r[1]), ["10,000", "12%", "1,200", "0", "1,200"]);
});

test("вид отчёта о прибылях и убытках: расходы в скобках, проценты, итоги", () => {
  const node = renderProfitLossReport(profitLoss(entries), context);
  const table = cells(node);
  assert.deepEqual(table.find((r) => r[0] === "אחזקה"), ["אחזקה", "(80)", "0.80%"]);
  assert.deepEqual(table.find((r) => r[0] === "סה״כ הוצאות הנהלה וכלליות"), ["סה״כ הוצאות הנהלה וכלליות", "(2,021)", "20.21%"]);
  assert.deepEqual(table.at(-1), ["רווח לתקופה", "7,980", "79.80%"]);
  assert.equal(node.querySelector(".report-note").textContent, "ללא מס ערך מוסף");
  assert.ok(!table.some((r) => r[0].includes("ציוד")));
});

test("вид ведомости кодов: строки, подитоги по кодам, итоги разделов и отчёта", () => {
  const node = renderLedgerReport(classificationLedger(entries), context);
  const upkeep = [...node.querySelectorAll("h4")].find((h) => h.textContent === "קוד 203 · אחזקה");
  assert.ok(upkeep);
  const rowsOfTable = cells(upkeep.nextElementSibling);
  assert.deepEqual(rowsOfTable[1], ["ינואר", "01/01/26", "Shop A", "1001", "(118.00)", "(100.00)", "(18.00)", "טיוטא"]);
  assert.deepEqual(rowsOfTable.at(-1), ["סה״כ אחזקה", "", "", "", "(94.40)", "(80.00)", "(14.40)", ""]);
  assert.deepEqual([...node.querySelectorAll("h3")].map((h) => h.textContent), ["הכנסות", "הוצאות הנהלה וכלליות", "לא משתתף"]);
  assert.match(node.querySelector(".grand").textContent, /^סה״כ לדוח: 7,759\.81/);
});
