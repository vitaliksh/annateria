import test from "node:test";
import assert from "node:assert/strict";
import { buildJournalGrid, formatMoney, SAMPLE_ROWS } from "./excel-journal-fixture.mjs";

const number = (text) => {
  const value = Number(text.replace(/[(),]/g, ""));
  return text.startsWith("(") ? -value : value;
};
const footerValue = (text) => number(text.match(/:\s*([\d,.()]+)$/)[1]);
const dataRows = (grid) => grid.slice(10).filter((cells) => cells[13] !== "" && cells[0] !== "");

test("фикстура журнала Excel: данные только в нечётных строках, пустые строки между ними", () => {
  const grid = buildJournalGrid();
  const rowNumbers = grid.map((cells, i) => [i + 1, cells[13] !== ""]).filter(([n, hasDate]) => n >= 11 && hasDate);
  assert.equal(rowNumbers.length, SAMPLE_ROWS.length);
  assert.ok(rowNumbers.every(([n]) => n >= 11 && n % 2 === 1));
  assert.equal(grid[4][10], "לחודש 1/2026");
  assert.ok(grid[11].every((cell) => cell === ""));
});

test("фикстура журнала Excel: знаки по правилам расхода, кредит-ноты и дохода", () => {
  const rows = dataRows(buildJournalGrid());
  assert.deepEqual([1, 3, 4].map((col) => rows[0][col]), ["(18.00)", "100.00", "118.00"]);
  assert.deepEqual([1, 3, 4].map((col) => rows[5][col]), ["3.60", "(20.00)", "(23.60)"]);
  assert.deepEqual([1, 3, 4].map((col) => rows[7][col]), ["1,800.00", "10,000.00", "11,800.00"]);
  assert.equal(formatMoney(-1325.42), "(1,325.42)");
});

test("фикстура журнала Excel: нетто + НДС = брутто на каждой строке", () => {
  for (const cells of dataRows(buildJournalGrid())) {
    const [vat, net, gross] = [1, 3, 4].map((col) => number(cells[col]));
    assert.ok(Math.abs(Math.abs(net) + Math.abs(vat) - Math.abs(gross)) < 0.005);
  }
});

test("фикстура журнала Excel: итоги подвала сходятся с суммами строк", () => {
  const grid = buildJournalGrid();
  const rows = dataRows(grid);
  const sum = (col) => Math.round(rows.reduce((total, cells) => total + number(cells[col]), 0) * 100) / 100;
  const footer = grid.slice(10 + rows.length * 2 - 1);
  const totalVat = footer.find((cells) => cells[4] === ':סה"כ מע"מ לחודש');
  assert.equal(number(totalVat[1]), sum(1));
  const [arith] = footer.filter((cells) => cells[8].startsWith("סיכום אריטמטי"));
  assert.equal(footerValue(arith[8]), sum(3));
  assert.equal(footerValue(arith[12]), sum(4));
  const gross = footer.find((cells) => cells[8].startsWith("תשומות כולל"));
  const vat = footer.find((cells) => cells[8].startsWith('מע"מ תשומות'));
  // Inputs: expenses without equipment and the classes outside the VAT input base; the credit note subtracts.
  assert.equal(footerValue(gross[8]), 1770.19);
  assert.equal(footerValue(vat[8]), 249.69);
  assert.equal(footerValue(vat[12]), 1800);
  assert.equal(footerValue(vat[3]), 270);
  assert.equal(number(totalVat[1]), 1280.31);
});

test("фикстура журнала Excel: подмена итога подвала для проверки ошибки контрольной суммы", () => {
  const grid = buildJournalGrid({ footer: { totalVat: "1.00" } });
  const totalVat = grid.find((cells) => cells[4] === ':סה"כ מע"מ לחודש');
  assert.equal(totalVat[1], "1.00");
});
