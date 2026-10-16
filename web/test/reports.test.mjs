import test from "node:test";
import assert from "node:assert/strict";
import { SEED_CHART_OF_ACCOUNTS, matchClassNames, normaliseChart } from "../chart-of-accounts.js";
import { buildImportedRows } from "../excel-import.js";
import { parseJournalGrid } from "../excel-journal.js";
import {
  advancesReport,
  classificationLedger,
  inPeriod,
  monthName,
  monthsInPeriod,
  periodContaining,
  profitLoss,
  reportEntries,
  vatReport,
} from "../reports.js";
import { buildJournalGrid } from "./excel-journal-fixture.mjs";

const accounts = normaliseChart({ accounts: SEED_CHART_OF_ACCOUNTS });
const parsed = parseJournalGrid(buildJournalGrid()).rows;
const rows = () => buildImportedRows(parsed, matchClassNames(parsed.map((r) => r.classificationName), accounts).codes);
const declaration = (month, status = "closed", list = rows()) => ({ month, status, rows: list });
const entries = (...declarations) => reportEntries(declarations, accounts);

test("отчёты: периоды — месяцы подряд и пары 1–2, 3–4 для двухмесячной отчётности", () => {
  assert.deepEqual(monthsInPeriod("2026-11", "2027-02"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
  assert.deepEqual(periodContaining("2026-08", "bimonthly"), { from: "2026-07", to: "2026-08" });
  assert.deepEqual(periodContaining("2026-07", "bimonthly"), { from: "2026-07", to: "2026-08" });
  assert.deepEqual(periodContaining("2026-08"), { from: "2026-08", to: "2026-08" });
  assert.equal(monthName("2026-02"), "פברואר");
});

test("отчёты: в записи попадают только активные строки, тип берётся из плана счетов", () => {
  const list = rows();
  list[0].active = false;
  const result = reportEntries([declaration("2026-01", "open", list)], accounts);
  assert.equal(result.length, 7);
  assert.equal(result.at(-1).type, "income");
  assert.equal(result.find((entry) => entry.code === "900").type, "equipment");
  const fallback = reportEntries([declaration("2026-01")], {}, { 160: "הכנסות", 203: "אחזקה" });
  assert.deepEqual([fallback[0].type, fallback.at(-1).type], ["expense", "income"]);
});

test("отчёт НДС: целые шекели, оборудование отдельной строкой, предупреждение о незакрытых", () => {
  const report = vatReport(entries(declaration("2026-01", "open")));
  assert.deepEqual(report, {
    vatRate: 18, turnover: 10000, outputVat: 1800, inputVat: 250, equipmentVat: 270, payable: 1280, openCount: 8,
  });
  assert.equal(vatReport(entries(declaration("2026-01", "closed"))).openCount, 0);
});

// Lines are rounded after summing the period, so the payable amount is not twice the single-month figure.
test("отчёт НДС: период складывает все декларации с месяцами внутри него", () => {
  const all = entries(declaration("2026-01"), declaration("2026-02"), declaration("2026-03"));
  const report = vatReport(inPeriod(all, "2026-01", "2026-02"));
  assert.deepEqual([report.turnover, report.outputVat, report.payable], [20000, 3600, 2561]);
});

test("отчёт по авансам: оборот × процент, округление до шекеля", () => {
  const result = advancesReport(entries(declaration("2026-01")), { percent: 12 });
  assert.deepEqual(result, { turnover: 10000, percent: 12, advance: 1200, deductions: 0, total: 1200 });
  assert.equal(advancesReport(entries(declaration("2026-01")), { percent: 12.5, deductions: 100 }).total, 1150);
});

test("отчёт о прибылях и убытках: нетто по классам, оборудование исключено, проценты от дохода", () => {
  const report = profitLoss(entries(declaration("2026-01")));
  assert.deepEqual(report.income, [{ code: "160", name: "הכנסות", amount: 10000, percent: 100 }]);
  assert.deepEqual(report.expenses.map((line) => [line.code, line.amount]), [
    ["203", 80], ["204", 1251], ["205", 500], ["208", 90], ["234", 100],
  ]);
  assert.equal(report.expenses[1].percent, 12.51);
  assert.deepEqual([report.expenseTotal, report.expensePercent, report.profit, report.profitPercent], [2021, 20.21, 7980, 79.8]);
});

test("отчёт о прибылях и убытках: без дохода проценты равны нулю", () => {
  const onlyExpenses = rows().filter((row) => row.values[1] !== "160");
  assert.equal(profitLoss(entries(declaration("2026-01", "closed", onlyExpenses))).expensePercent, 0);
});

test("ведомость кодов: расходы отрицательные, кредит-нота положительная, итоги по кодам и группам", () => {
  const ledger = classificationLedger(entries(declaration("2026-01")));
  assert.deepEqual(ledger.sections.map((section) => section.title), ["הכנסות", "הוצאות הנהלה וכלליות", "לא משתתף"]);
  const upkeep = ledger.sections[1].accounts.find((account) => account.code === "203");
  assert.deepEqual(upkeep.rows.map((row) => row.gross), [-118, 23.6]);
  assert.deepEqual([upkeep.gross, upkeep.net, upkeep.vat], [-94.4, -80, -14.4]);
  assert.equal(ledger.sections[0].gross, 11800);
  assert.equal(ledger.sections[2].accounts[0].vat, -270);
  assert.equal(ledger.gross, 7759.81);
  assert.equal(upkeep.rows[0].monthName, "ינואר");
});

test("ведомость кодов: строки внутри кода идут по месяцам", () => {
  const ledger = classificationLedger(entries(declaration("2026-03"), declaration("2026-01")));
  assert.deepEqual(ledger.sections[0].accounts[0].rows.map((row) => row.month), ["2026-01", "2026-03"]);
});

test("отчёт НДС: НДС статей вне базы (ביגוד) не вычитается, расход в P&L остаётся", () => {
  const types = { "200": { name: "ביגוד", type: "outsideVatBase" }, "203": { name: "אחזקה", type: "expense" } };
  const row = (code, net, vat) => ({ active: true, values: ["", code, "", "", "", "", "", String(net + vat), String(net), String(vat)] });
  const list = reportEntries([declaration("2026-01", "open", [row("200", 101.61, 18.29), row("203", 100, 18)])], types);
  assert.equal(vatReport(list).inputVat, 18);
  assert.equal(profitLoss(list).expenseTotal, 202);
});
