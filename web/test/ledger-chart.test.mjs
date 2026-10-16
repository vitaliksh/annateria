import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { chartFromLedgerEntries, ledgerEntriesFromGrid, ledgerEntriesFromPdfPages, readLedgerFile, sectionType } from "../ledger-chart.js";
import { ledgerGrid, ledgerPdfPages, LEDGER_SECTIONS } from "./ledger-fixture.mjs";

const EXPECTED = [
  { section: "הכנסות", code: "110", name: "הכנסה חייבת" },
  { section: "עלות המכר", code: "200", name: "ציוד ספורט מתכלה" },
  { section: "הוצאות הנהלה וכלליות", code: "202", name: "משרדיות" },
  { section: "הוצאות הנהלה וכלליות", code: "205", name: "ארנונה" },
  { section: "הוצאות הנהלה וכלליות", code: "212", name: "ביגוד" },
  { section: "הוצאות הנהלה וכלליות", code: "214", name: 'הנה"ח' },
  { section: "לא משתתף", code: "900", name: "רכישת ציוד/רכוש קבוע" },
];

function file(name, bytes, type = "") {
  return { name, size: bytes.byteLength, type, arrayBuffer: async () => bytes };
}
const xlsxBytes = (grid) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(grid), "גיליון2");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" });
};

test("כרטסת: קטגוריה קובעת סוג — הכנסות, לא משתתף (ציוד), כל השאר הוצאה", () => {
  assert.deepEqual(["הכנסות", "לא משתתף", "עלות המכר", "הוצאות הנהלה וכלליות"].map(sectionType), ["income", "equipment", "expense", "expense"]);
});

test("כרטסת: גיליון — קוד, שם וקטגוריה מכל בלוק, גם כשהשם «הכנסות» זהה לכותרת הקטגוריה", () => {
  assert.deepEqual(ledgerEntriesFromGrid(ledgerGrid()), EXPECTED);
  const same = [{ title: "הכנסות", accounts: [["160", "הכנסות"]] }, ...LEDGER_SECTIONS.slice(2, 3)];
  assert.deepEqual(ledgerEntriesFromGrid(ledgerGrid(same)).slice(0, 2).map((e) => [e.section, e.code, e.name]), [["הכנסות", "160", "הכנסות"], ["הוצאות הנהלה וכלליות", "202", "משרדיות"]]);
});

test("כרטסת: PDF — קוד משמאל לתווית, שם מתחתיה, כותרות קטגוריה רק בשוליים השמאליים", () => {
  assert.deepEqual(ledgerEntriesFromPdfPages(ledgerPdfPages()), EXPECTED);
  // A continuation page repeats the section title above the same code.
  const [page] = ledgerPdfPages([{ title: "הוצאות הנהלה וכלליות", accounts: [["203", "אחזקה"]] }]);
  assert.deepEqual(ledgerEntriesFromPdfPages([page, page]).map((e) => e.code), ["203", "203"]);
});

test("כרטסת: תרשים — סוגים מהקטגוריה, סוג «מחוץ לבסיס» מהסוגים הידועים של הלקוח, כפילויות ופסולים מדולגים", () => {
  const { accounts, skipped } = chartFromLedgerEntries(
    [...EXPECTED, { section: "", code: "202", name: "משרדיות" }, { section: "", code: "202", name: "אחר" }, { section: "", code: "", name: "בלי קוד" }, { section: "", code: "12", name: "קצר" }, { section: "", code: "300", name: "ארנונה" }],
    { typeByName: { "ארנונה": "outsideVatBase", "ביגוד": "outsideVatBase", "הכנסה חייבת": "expense" }, reserved: { 214: "x" } },
  );
  assert.deepEqual(Object.keys(accounts), ["110", "200", "202", "205", "212", "900"]);
  assert.deepEqual(Object.values(accounts).map((a) => a.type), ["income", "expense", "expense", "outsideVatBase", "outsideVatBase", "equipment"]);
  assert.deepEqual(skipped.map((s) => s.reason).sort(), ["conflict", "incomplete", "invalid", "invalid", "invalid"]);
});

test("כרטסת: קריאת קובץ — xlsx ו-pdf נקראים, סיומת זרה וקובץ בלי קודים נדחים", async () => {
  const fromXlsx = await readLedgerFile(file("כרטסת.xlsx", xlsxBytes(ledgerGrid())), { loadLibrary: async () => XLSX });
  assert.equal(fromXlsx.accounts[214].name, 'הנה"ח');
  const pdfjs = { getDocument: () => ({ promise: Promise.resolve({
    numPages: 1,
    getPage: async () => ({ getTextContent: async () => ({ items: ledgerPdfPages()[0].map((i) => ({ str: i.str, width: i.width, transform: [1, 0, 0, 1, i.x, i.y] })) }) }),
  }) }) };
  const fromPdf = await readLedgerFile(file("כרטסת.pdf", new ArrayBuffer(8), "application/pdf"), { loadPdf: async () => pdfjs });
  assert.deepEqual(fromPdf.accounts, fromXlsx.accounts);
  await assert.rejects(readLedgerFile(file("כרטסת.docx", new ArrayBuffer(8))), /PDF או/);
  await assert.rejects(readLedgerFile(file("x.xlsx", xlsxBytes([["a"], ["b"]])), { loadLibrary: async () => XLSX }), /לא נמצאו קודי מיון/);
});
