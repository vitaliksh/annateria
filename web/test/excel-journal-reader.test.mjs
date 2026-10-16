import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseJournalGrid } from "../excel-journal.js";
import { readJournalGrid, validateExcelFile } from "../excel-journal-reader.js";
import { buildJournalGrid } from "./excel-journal-fixture.mjs";

const loadLibrary = async () => XLSX;

function xlsxFile(sheets, name = "journal.xlsx") {
  const workbook = XLSX.utils.book_new();
  for (const [sheetName, sheet] of sheets) XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytes };
}

test("Excel-ридер: данные берутся с листа גיליון2, пустой лист игнорируется", async () => {
  const grid = buildJournalGrid({ month: 5 });
  const file = xlsxFile([["גיליון2", XLSX.utils.aoa_to_sheet(grid)], ["גיליון1", {}]]);
  const result = parseJournalGrid(await readJournalGrid(file, { loadLibrary }));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.declarationMonth, { month: 5, year: 2026 });
  assert.equal(result.rows[0].date, "2026-01-01");
});

test("Excel-ридер: единственный лист с данными берётся независимо от имени", async () => {
  const file = xlsxFile([["Sheet1", XLSX.utils.aoa_to_sheet(buildJournalGrid())]]);
  const result = parseJournalGrid(await readJournalGrid(file, { loadLibrary }));
  assert.deepEqual(result.errors, []);
});

test("Excel-ридер: диапазон, начинающийся не с A1, выравнивается по колонкам Excel", async () => {
  const sheet = XLSX.utils.aoa_to_sheet(buildJournalGrid().slice(2), { origin: "A3" });
  const grid = await readJournalGrid(xlsxFile([["גיליון2", sheet]]), { loadLibrary });
  assert.equal(grid[4][10], "לחודש 1/2026");
  assert.equal(parseJournalGrid(grid).rows.length, 8);
});

test("Excel-ридер: два заполненных листа без גיליון2 — ошибка", async () => {
  const sheet = () => XLSX.utils.aoa_to_sheet([["a"]]);
  const file = xlsxFile([["A", sheet()], ["B", sheet()]]);
  await assert.rejects(readJournalGrid(file, { loadLibrary }), /גיליון נתונים/);
});

test("Excel-ридер: повреждённый файл даёт понятную ошибку", async () => {
  const file = { name: "bad.xlsx", size: 4, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer };
  await assert.rejects(readJournalGrid(file, { loadLibrary }), /לא ניתן לקרוא/);
});

test("Excel-ридер: проверка файла — тип, пустой, слишком большой", () => {
  assert.throws(() => validateExcelFile(null), /לא נבחר/);
  assert.throws(() => validateExcelFile({ name: "a.xlsx", size: 0 }), /ריק/);
  assert.throws(() => validateExcelFile({ name: "a.xlsx", size: 6 * 1024 * 1024 }), /5MB/);
  assert.throws(() => validateExcelFile({ name: "a.xls", size: 10 }), /xlsx/);
  assert.doesNotThrow(() => validateExcelFile({ name: "A.XLSX", size: 10 }));
});
