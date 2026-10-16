// Synthetic classification ledgers in the layout of the real Rivhit files (no client data).
export const LEDGER_SECTIONS = [
  { title: "הכנסות", accounts: [["110", "הכנסה חייבת"]] },
  { title: "עלות המכר", accounts: [["200", "ציוד ספורט מתכלה"]] },
  { title: "הוצאות הנהלה וכלליות", accounts: [["202", "משרדיות"], ["205", "ארנונה"], ["212", "ביגוד"], ["214", 'הנה"ח']] },
  { title: "לא משתתף", accounts: [["900", "רכישת ציוד/רכוש קבוע"]] },
];

// Sheet grid: section title in column G, the code in M next to the label in N, the name in N of the next row.
export function ledgerGrid(sections = LEDGER_SECTIONS) {
  const line = () => Array(15).fill("");
  const grid = [line(), line()];
  for (const { title, accounts } of sections) {
    const section = line();
    section[6] = title;
    grid.push(section, line());
    for (const [code, name] of accounts) {
      const label = line();
      label[12] = code;
      label[13] = ":'קוד מס";
      const nameRow = line();
      nameRow[13] = name;
      const header = line();
      header[2] = 'מע"מ';
      header[8] = "פרטים";
      const detail = line();
      detail[0] = "טיוטא";
      detail[2] = "(18.00)";
      detail[8] = title === "הכנסות" ? "הכנסות" : "פרטים";
      const total = line();
      total[13] = `:סה''כ ${name}`;
      grid.push(label, nameRow, line(), header, detail, line(), total, line());
    }
  }
  return grid;
}

// pdf.js text items { str, x, y, width }: label at x 527, code left of it, name right below with the same right edge,
// section titles at the left margin; detail cells (also reading "הכנסות") elsewhere on the page.
export function ledgerPdfPages(sections = LEDGER_SECTIONS) {
  const page = [{ str: "כרטסת קודי מיון", x: 252, y: 772, width: 80 }, { str: "לתקופה: 1 - 12 2026", x: 268, y: 752, width: 70 }];
  let y = 728;
  for (const { title, accounts } of sections) {
    page.push({ str: title, x: 84, y, width: 60 });
    for (const [code, name] of accounts) {
      const width = 6 * name.length;
      page.push({ str: "קוד מס':", x: 527, y: y - 23, width: 36 }, { str: code, x: 502, y: y - 23, width: 20 });
      page.push({ str: name, x: 563 - width, y: y - 41, width });
      page.push({ str: "חשבון נגדי", x: 406, y: y - 70, width: 40 }, { str: "הכנסות", x: 336, y: y - 88, width: 40 }, { str: "(18.00)", x: 73, y: y - 88, width: 30 });
      page.push({ str: `סה''כ ${name}:`, x: 218, y: y - 110, width: 80 });
      y -= 130;
    }
  }
  return [page];
}

// ---- Operations (rows below each class). `blocks` are in the ledger's own signs: expenses negative, credits positive.
import { formatMoney } from "./excel-journal-fixture.mjs";

const MONTH_NAMES = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const serial = (iso) => (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000;
const shortDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
const sum = (rows, field) => Math.round(rows.reduce((total, row) => total + row[field], 0) * 100) / 100;

export const OPERATION_BLOCKS = [
  { section: "הכנסות", code: "110", name: "הכנסות", rows: [
    { month: 1, line: "1", date: "2026-01-30", details: "הכנסות", ref1: "6006", gross: 11800, net: 10000, vat: 1800 },
  ] },
  { section: "הוצאות הנהלה וכלליות", code: "203", name: "אחזקה", rows: [
    { month: 1, line: "2", date: "2026-01-02", details: "Shop A", ref1: "1001", gross: -118, net: -100, vat: -18 },
    { month: 2, line: "3", date: "2026-01-23", details: "Shop B", ref1: "", gross: 23.6, net: 20, vat: 3.6 },
  ] },
  { section: "לא משתתף", code: "900", name: "רכישת ציוד/רכוש קבוע", rows: [
    { month: 1, line: "4", date: "2026-01-04", details: "Gear F", ref1: "5005", gross: -1770, net: -1500, vat: -270 },
  ] },
];

const row = (cells, size = 15) => Object.assign(Array(size).fill(""), cells);

// Sheet grid: header row per class names the columns, dates are Excel serial numbers as the reader returns them.
export function ledgerRowsGrid(blocks = OPERATION_BLOCKS, year = 2026) {
  const grid = [row({ 2: "תאריך - 04/10/26 18:15:04" }), row({ 10: `לתקופה: 1 - 12 ${year}` })];
  for (const { section, code, name, rows } of blocks) {
    grid.push(row({ 6: section }), row({}));
    grid.push(row({ 12: code, 13: ":'קוד מס" }), row({ 13: name }), row({}));
    grid.push(row({ 2: 'מע"מ', 3: 'ללא מע"מ', 4: 'כולל מע"מ', 5: "אסמכ' 2", 6: "אסמכ' 1", 8: "פרטים", 10: "חשבון נגדי", 11: "ת. ערך", 12: "שורה", 13: "חודש", 14: "תאריך" }));
    for (const r of rows) {
      grid.push(row({ 0: "טיוטא", 2: formatMoney(r.vat), 3: formatMoney(r.net), 4: formatMoney(r.gross), 6: r.ref1, 8: r.details, 10: "כרטיס כללי 0", 11: serial(r.date), 12: r.line, 13: MONTH_NAMES[r.month - 1], 14: serial(r.date) }));
    }
    grid.push(row({}), row({ 2: formatMoney(sum(rows, "vat")), 3: formatMoney(sum(rows, "net")), 4: formatMoney(sum(rows, "gross")), 13: `:סה''כ ${name}` }), row({}));
  }
  return grid;
}

// pdf.js items: every column right aligned at the edges of the real Rivhit report. `split` puts the rows of the first class
// that has more than one row on two pages, with the class header repeated.
export function ledgerRowsPdfPages(blocks = OPERATION_BLOCKS, year = 2026, { split = false } = {}) {
  const at = (str, right, y) => ({ str, x: right - 6 * str.length, y, width: 6 * str.length });
  const pages = [[{ str: `לתקופה: 1 - 12 ${year}`, x: 268, y: 752, width: 70 }]];
  let y = 728;
  let page = pages[0];
  const header = (title, code, name) => {
    page.push({ str: title, x: 84, y, width: 60 }, { str: "קוד מס':", x: 527, y: y - 23, width: 46 }, { str: code, x: 502, y: y - 23, width: 22 }, at(name, 573, y - 41));
    y -= 90;
  };
  for (const { section, code, name, rows } of blocks) {
    header(section, code, name);
    rows.forEach((r, index) => {
      if (split && rows.length > 1 && index === 1) {
        page = [];
        pages.push(page);
        y = 728;
        header(section, code, name);
      }
      page.push(at(MONTH_NAMES[r.month - 1], 574, y), at(r.line, 541, y), at(shortDate(r.date), 517, y), at(shortDate(r.date), 480, y));
      page.push({ str: "כרטיס כללי", x: 406, y, width: 37 }, { str: "0", x: 400, y, width: 4 }, at(r.details, 361, y));
      if (r.ref1) page.push(at(r.ref1, 273, y));
      page.push(at(formatMoney(r.gross), 216, y), at(formatMoney(r.net), 159, y), at(formatMoney(r.vat), 103, y), { str: "טיוטא", x: 22, y: y - 1, width: 21 });
      y -= 14;
    });
    page.push({ str: `סה''כ ${name}:`, x: 218, y, width: 44 }, at(formatMoney(sum(rows, "gross")), 216, y), at(formatMoney(sum(rows, "net")), 159, y), at(formatMoney(sum(rows, "vat")), 103, y));
    y -= 40;
  }
  return pages;
}

