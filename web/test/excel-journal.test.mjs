import test from "node:test";
import assert from "node:assert/strict";
import { footerErrors, parseJournalGrid, suggestClassTypes } from "../excel-journal.js";
import { buildJournalGrid, OTHER_CLIENT, SAMPLE_ROWS } from "./excel-journal-fixture.mjs";

const codes = (list) => list.map((item) => item.code);

test("журнал Excel: разбор строк, месяца и итогов подвала без ошибок", () => {
  const result = parseJournalGrid(buildJournalGrid({ month: 8 }));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.declarationMonth, { month: 8, year: 2026 });
  assert.equal(result.rows.length, SAMPLE_ROWS.length);
  assert.equal(result.footer.totalVat, 1280.31);
  assert.equal(result.footer.inputsGross, 1770.19);
  assert.deepEqual(codes(result.warnings), ["draft-rows"]);
});

test("журнал Excel: вид строки определяется по классу и знаку, а не по одному знаку", () => {
  const { rows } = parseJournalGrid(buildJournalGrid());
  assert.deepEqual(rows.map((row) => row.kind), ["expense", "expense", "expense", "expense", "expense", "credit", "expense", "income"]);
  assert.deepEqual([rows[0].vat, rows[0].net, rows[0].gross], [-18, 100, 118]);
  assert.deepEqual([rows[5].vat, rows[5].net, rows[5].gross], [3.6, -20, -23.6]);
});

test("журнал Excel: пустая ссылка 1, дата-серийник и номера строк листа", () => {
  const { rows } = parseJournalGrid(buildJournalGrid());
  assert.equal(rows[1].reference1, "");
  assert.equal(rows[0].reference1, "1001");
  assert.equal(rows[0].date, "2026-01-01");
  assert.deepEqual(rows.slice(0, 3).map((row) => row.sourceRow), [11, 13, 15]);
});

test("журнал Excel: пробелы и RLM вокруг текста не мешают", () => {
  const grid = buildJournalGrid();
  grid[10][1] = ` ‏${grid[10][1]} `;
  grid[10][11] = `‏${grid[10][11]} `;
  const { rows, errors } = parseJournalGrid(grid);
  assert.deepEqual(errors, []);
  assert.equal(rows[0].vat, -18);
  assert.equal(rows[0].classificationName, "אחזקה");
});

test("журнал Excel: неверный итог подвала — ошибка, а не молчаливый импорт", () => {
  const result = parseJournalGrid(buildJournalGrid({ footer: { totalVat: "1.00" } }));
  assert.deepEqual(codes(result.errors), ["footer-mismatch", "footer-mismatch"]);
  assert.equal(result.errors[0].key, "totalVat");
});

test("журнал Excel: расхождение арифметической суммы нетто", () => {
  const grid = buildJournalGrid({ footer: { arithmeticNet: "סיכום אריטמטי ללא מע''מ לביקורת : 1.00" } });
  const result = parseJournalGrid(grid);
  assert.deepEqual(result.errors.map((error) => error.key), ["arithmeticNet"]);
});

test("журнал Excel: класс вне базы НДС настраивается типами счетов", () => {
  const rows = SAMPLE_ROWS.map((row) => ({ ...row }));
  const result = parseJournalGrid(buildJournalGrid({ rows }), {
    classTypes: { income: ["הכנסות"], equipment: ["רכישת ציוד/רכוש קבוע"], outsideVatBase: [] },
  });
  assert.deepEqual(result.errors.map((error) => error.key), ["inputsGross"]);
});

test("журнал Excel: нечисловая сумма и неверная дата называют строку листа", () => {
  const grid = buildJournalGrid();
  grid[12][3] = "abc";
  grid[14][13] = "";
  grid[14][12] = "7";
  grid[16][13] = "next week";
  const result = parseJournalGrid(grid);
  assert.deepEqual(result.errors.map((error) => [error.code, error.row]), [["bad-money", 13], ["bad-date", 17]]);
});

test("журнал Excel: разность нетто + НДС и брутто — ошибка строки", () => {
  const grid = buildJournalGrid();
  grid[10][4] = "119.00";
  const [error] = parseJournalGrid(grid).errors;
  assert.deepEqual([error.code, error.row], ["amount-mismatch", 11]);
});

test("журнал Excel: статус не «טיוטא» остаётся текстом и даёт предупреждение", () => {
  const result = parseJournalGrid(buildJournalGrid({ status: "סופי" }));
  assert.deepEqual(codes(result.warnings), ["other-status"]);
  assert.equal(result.rows[0].status, "סופי");
});

test("журнал Excel: без заголовка и без строк файл отвергается", () => {
  assert.deepEqual(codes(parseJournalGrid([[""], ["x"]]).errors), ["no-header"]);
  const grid = buildJournalGrid({ rows: [] });
  assert.deepEqual(codes(parseJournalGrid(grid).errors), ["no-rows"]);
});

test("журнал Excel: месяц в шапке отсутствует — только предупреждение", () => {
  const grid = buildJournalGrid();
  grid[4][10] = "";
  const result = parseJournalGrid(grid);
  assert.deepEqual(result.errors, []);
  assert.equal(result.declarationMonth, null);
  assert.ok(codes(result.warnings).includes("no-month"));
});

test("журнал Excel: НДС строк вне базы входит в итог месяца, но не в תשומות — баланс сходится", () => {
  const grid = buildJournalGrid(OTHER_CLIENT);
  const classTypes = { income: OTHER_CLIENT.income, equipment: [], outsideVatBase: OTHER_CLIENT.outside };
  assert.deepEqual(parseJournalGrid(grid, { classTypes }).errors, []);
  const wrong = parseJournalGrid(grid);
  assert.deepEqual(wrong.errors.map((error) => error.key), ["outputsGross", "outputsVat", "inputsGross", "inputsVat", "balance"]);
  assert.deepEqual(footerErrors(wrong.rows, wrong.footer, classTypes), []);
});

test("журнал Excel: типы классов подбираются по итогам файла с минимумом правок", () => {
  const grid = buildJournalGrid(OTHER_CLIENT);
  const { rows, footer } = parseJournalGrid(grid);
  const found = suggestClassTypes(rows, footer, { "אחזקה": "expense", "ביגוד": "expense", "רכב רשוי וביטוח": "expense", "הכנסה חייבת": "expense" });
  assert.deepEqual(found, { "אחזקה": "expense", "ביגוד": "outsideVatBase", "רכב רשוי וביטוח": "outsideVatBase", "הכנסה חייבת": "income" });
  assert.deepEqual(footerErrors(rows, footer, { income: ["הכנסה חייבת"], equipment: [], outsideVatBase: ["ביגוד", "רכב רשוי וביטוח"] }), []);
  // The current types are kept when they already fit.
  assert.deepEqual(suggestClassTypes(rows, footer, found), found);
  assert.equal(suggestClassTypes(rows, { ...footer, outputsGross: 1 }, {}), null);
  assert.equal(suggestClassTypes(rows, { ...footer, equipmentGross: undefined }, {}), null);
});
