import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { checkLedgerBlocks, ledgerBlocksFromGrid, ledgerBlocksFromPdfPages, readLedgerFile } from "../ledger-rows.js";
import { ledgerRowsGrid, ledgerRowsPdfPages, OPERATION_BLOCKS } from "./ledger-fixture.mjs";

const shape = (blocks) => blocks.map(({ section, code, name, rows }) => ({ section, code, name, rows: rows.map(({ month, line, date, details, ref1, gross, net, vat }) => ({ month, line, date, details, ref1, gross, net, vat })) }));
const withoutTotals = (blocks) => blocks.map((block) => ({ ...block, total: null }));

function file(name, bytes, type = "") {
  return { name, size: bytes.byteLength, type, arrayBuffer: async () => bytes };
}
const xlsxBytes = (grid) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(grid), "גיליון2");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" });
};
const pdfjsOf = (pages) => ({ getDocument: () => ({ promise: Promise.resolve({
  numPages: pages.length,
  getPage: async (number) => ({ getTextContent: async () => ({ items: pages[number - 1].map((i) => ({ str: i.str, width: i.width, transform: [1, 0, 0, 1, i.x, i.y] })) }) }),
}) }) });

test("כרטסת: גיליון — לכל קוד שורות הפעולות, הסיכום והשנה מכותרת התקופה", () => {
  const ledger = ledgerBlocksFromGrid(ledgerRowsGrid());
  assert.equal(ledger.year, 2026);
  assert.deepEqual(shape(ledger.blocks), shape(OPERATION_BLOCKS).map((block) => ({ ...block, rows: block.rows })));
  assert.deepEqual(ledger.blocks[1].total, { gross: -94.4, net: -80, vat: -14.4 });
  assert.doesNotThrow(() => checkLedgerBlocks(ledger));
});

test("כרטסת: PDF — עמודות לפי הקצה הימני, ודף שמשך קוד קיים ממשיך את אותו קוד", () => {
  const whole = ledgerBlocksFromPdfPages(ledgerRowsPdfPages());
  assert.equal(whole.year, 2026);
  assert.deepEqual(shape(whole.blocks), shape(OPERATION_BLOCKS));
  const split = ledgerBlocksFromPdfPages(ledgerRowsPdfPages(OPERATION_BLOCKS, 2026, { split: true }));
  assert.deepEqual(shape(split.blocks), shape(OPERATION_BLOCKS), "a class on two pages is one block");
  assert.deepEqual(split.blocks[1].total, whole.blocks[1].total);
  assert.doesNotThrow(() => checkLedgerBlocks(split));
});

test("כרטסת: קריאה לא מלאה (שורה חסרה מול הסיכום) נדחית, וקוד בלי סיכום לא נבדק", () => {
  const grid = ledgerRowsGrid();
  const index = grid.findIndex((cells) => cells[8] === "Shop A");
  grid.splice(index, 1);
  assert.throws(() => checkLedgerBlocks(ledgerBlocksFromGrid(grid)), /אינו תואם לסיכום של קוד 203 אחזקה/);
  const partial = ledgerBlocksFromGrid(grid);
  assert.doesNotThrow(() => checkLedgerBlocks({ ...partial, blocks: withoutTotals(partial.blocks) }));
  const broken = ledgerBlocksFromPdfPages(ledgerRowsPdfPages());
  broken.blocks[0].rows[0].date = null;
  assert.throws(() => checkLedgerBlocks(broken), /לא ניתן לקרוא שורה/);
});

test("כרטסת: קריאת קובץ — xlsx ו-pdf נותנים אותן פעולות, סיומת זרה, בלי תקופה וקובץ בלי קודים נדחים", async () => {
  const fromXlsx = await readLedgerFile(file("כרטסת.xlsx", xlsxBytes(ledgerRowsGrid())), { loadLibrary: async () => XLSX });
  const fromPdf = await readLedgerFile(file("כרטסת.pdf", new ArrayBuffer(8), "application/pdf"), { loadPdf: async () => pdfjsOf(ledgerRowsPdfPages()) });
  assert.deepEqual(shape(fromXlsx.blocks), shape(fromPdf.blocks));
  await assert.rejects(readLedgerFile(file("כרטסת.docx", new ArrayBuffer(8))), /PDF או/);
  await assert.rejects(readLedgerFile(file("x.xlsx", xlsxBytes([["a"], ["b"]])), { loadLibrary: async () => XLSX }), /לא נמצאו קודי מיון/);
  const noPeriod = ledgerRowsGrid().filter((cells) => !String(cells[10]).startsWith("לתקופה"));
  await assert.rejects(readLedgerFile(file("x.xlsx", xlsxBytes(noPeriod)), { loadLibrary: async () => XLSX }), /תקופת הכרטסת/);
});
