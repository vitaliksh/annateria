// Reads every operation of the classification ledger ("כרטסת קודי מיון"): per class a block with its code, the operations
// below it and the class total. The totals check that the rows were read completely.
import { CODE_LABEL, SECTION_TITLE, clean, readPdfPages } from "./ledger-chart.js";
import { readJournalGrid } from "./excel-journal-reader.js";
import { validatePdfFile } from "./pdf-import.js";

const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const MONEY = /^\(?[\d,]+(?:\.\d+)?\)?$/;
const PERIOD = /לתקופה:?\s*(\d{1,2})\s*-\s*(\d{1,2})\s*(\d{4})/;
const TOTAL = /^:?\s*סה''כ\s+(.+?)\s*:?$/;

const round2 = (value) => Math.round(value * 100) / 100;

function money(text) {
  const value = clean(text);
  if (!MONEY.test(value)) return null;
  const number = Number(value.replace(/[(),]/g, ""));
  return round2(value.startsWith("(") ? -number : number);
}

// Excel serial numbers (grid) and dd/mm/yy text (pdf) become ISO dates.
function ledgerDate(cell) {
  if (typeof cell === "number" && Number.isFinite(cell)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(cell) * 86400000).toISOString().slice(0, 10);
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(clean(cell));
  if (!match) return null;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

const monthNumber = (text) => MONTHS.indexOf(clean(text)) + 1;

function makeRow(cells) {
  const { month, line, date, details, ref1, ref2, gross, net, vat } = cells;
  return {
    month: monthNumber(month),
    line: clean(line),
    date: ledgerDate(date),
    details: clean(details),
    ref1: clean(ref1),
    ref2: clean(ref2),
    gross: money(gross),
    net: money(net),
    vat: money(vat),
  };
}

const validRow = (row) => row.month > 0 && row.date && [row.gross, row.net, row.vat].every((value) => value !== null);

// Sheet grid: the header row of each block names the columns, so the layout may shift between exports.
export function ledgerBlocksFromGrid(rows) {
  const blocks = [];
  let block = null;
  let section = "";
  let columns = null;
  let period = null;
  for (let i = 0; i < rows.length; i += 1) {
    const raw = rows[i];
    const cells = raw.map(clean);
    period ??= PERIOD.exec(cells.find((cell) => PERIOD.test(cell)) ?? "");
    const label = cells.findIndex((cell) => CODE_LABEL.test(cell));
    if (label >= 0) {
      const code = cells.find((cell, index) => index !== label && /^\d{1,4}$/.test(cell)) ?? "";
      let nameRow = i + 1;
      while (nameRow < Math.min(rows.length, i + 4) && !rows[nameRow].some((cell) => clean(cell))) nameRow += 1;
      const name = (rows[nameRow] ?? []).map(clean).find((cell) => cell && !/^\d+$/.test(cell)) ?? "";
      block = { section, code, name, rows: [], total: null };
      blocks.push(block);
      columns = null;
      i = Math.max(i, nameRow);
      continue;
    }
    if (cells.includes("חודש") && cells.includes("שורה")) {
      const at = (text) => cells.indexOf(text);
      columns = { month: at("חודש"), line: at("שורה"), date: at("תאריך"), details: at("פרטים"), ref1: at("אסמכ' 1"), ref2: at("אסמכ' 2"), gross: at('כולל מע"מ'), net: at('ללא מע"מ'), vat: at('מע"מ') };
      continue;
    }
    const filled = cells.filter(Boolean);
    if (filled.length === 1 && SECTION_TITLE.test(filled[0]) && !filled[0].includes(":")) {
      section = filled[0];
      continue;
    }
    if (!block || !columns) continue;
    if (monthNumber(cells[columns.month]) > 0) {
      block.rows.push(makeRow(Object.fromEntries(Object.entries(columns).map(([key, index]) => [key, index >= 0 ? raw[index] : ""]))));
      continue;
    }
    const total = cells.map((cell) => TOTAL.exec(cell)).find(Boolean);
    if (total && total[1] === block.name && !block.total) {
      block.total = { gross: money(raw[columns.gross]), net: money(raw[columns.net]), vat: money(raw[columns.vat]) };
    }
  }
  return { year: period ? Number(period[3]) : null, blocks };
}

// Right edges (pdf.js x + width) of the columns of the Rivhit report; every column is right aligned.
const PDF_COLUMNS = [
  ["month", 560, 580], ["line", 536, 546], ["date", 510, 524], ["valueDate", 474, 486], ["details", 300, 372],
  ["ref1", 266, 280], ["ref2", 236, 252], ["gross", 205, 222], ["net", 148, 166], ["vat", 94, 112],
];

function pdfColumn(item) {
  const right = item.x + item.w;
  return PDF_COLUMNS.find(([, low, high]) => right >= low && right <= high)?.[0] ?? null;
}

// pdf.js text items { str, x, y, width } of each page, in reading order of the report.
export function ledgerBlocksFromPdfPages(pages) {
  const blocks = [];
  let block = null;
  let section = "";
  let period = null;
  for (const page of pages) {
    const items = page
      .map((item) => ({ s: clean(item.str), x: item.x, y: item.y, w: item.width ?? 0 }))
      .filter((item) => item.s)
      .sort((a, b) => b.y - a.y || b.x - a.x);
    period ??= PERIOD.exec(items.map((item) => item.s).find((text) => PERIOD.test(text)) ?? "");
    const lines = [];
    for (const item of items) {
      const last = lines.at(-1);
      if (last && Math.abs(last.y - item.y) <= 2.5) last.items.push(item);
      else lines.push({ y: item.y, items: [item] });
    }
    for (const { y, items: line } of lines) {
      const labelItem = line.find((item) => CODE_LABEL.test(item.s));
      if (labelItem) {
        const code = line.find((item) => item.x < labelItem.x && /^\d{1,4}$/.test(item.s))?.s ?? "";
        const right = labelItem.x + labelItem.w;
        const name = items.find((item) => item.y < y - 8 && item.y > y - 32 && Math.abs(item.x + item.w - right) <= 10)?.s ?? "";
        // A class that goes on to the next page repeats its header there.
        if (block?.code !== code) {
          block = { section, code, name, rows: [], total: null };
          blocks.push(block);
        }
        continue;
      }
      const title = line.find((item) => item.x < 200 && SECTION_TITLE.test(item.s) && !item.s.includes(":"));
      if (title) {
        section = title.s;
        continue;
      }
      if (!block) continue;
      const total = line.map((item) => TOTAL.exec(item.s)).find(Boolean);
      if (total) {
        if (total[1] === block.name && !block.total) {
          const at = (column) => line.find((item) => pdfColumn(item) === column)?.s;
          block.total = { gross: money(at("gross")), net: money(at("net")), vat: money(at("vat")) };
        }
        continue;
      }
      const cells = {};
      for (const item of [...line].sort((a, b) => b.x - a.x)) {
        const column = pdfColumn(item);
        if (column) cells[column] = cells[column] ? `${cells[column]} ${item.s}` : item.s;
      }
      if (monthNumber(cells.month) > 0 && cells.date) block.rows.push(makeRow({ ...cells, date: cells.date }));
    }
  }
  return { year: period ? Number(period[3]) : null, blocks };
}

// A class whose rows do not add up to its own total was read incompletely; reconciling against it would mislead.
export function checkLedgerBlocks({ blocks }) {
  for (const block of blocks) {
    const bad = block.rows.find((row) => !validRow(row));
    if (bad) throw new Error(`לא ניתן לקרוא שורה בכרטסת (קוד ${block.code} ${block.name}, שורה ${bad.line || "?"}).`);
    if (!block.total) continue;
    for (const field of ["gross", "net", "vat"]) {
      const sum = round2(block.rows.reduce((total, row) => total + row[field], 0));
      if (Math.abs(sum - block.total[field]) > 0.011) {
        throw new Error(`סכום הפעולות בכרטסת אינו תואם לסיכום של קוד ${block.code} ${block.name}. הקובץ לא נקרא במלואו.`);
      }
    }
  }
}

export async function readLedgerFile(file, { loadLibrary, loadPdf } = {}) {
  const name = String(file?.name ?? "").toLowerCase();
  let ledger;
  if (name.endsWith(".pdf")) {
    validatePdfFile(file);
    ledger = ledgerBlocksFromPdfPages(await readPdfPages(file, loadPdf));
  } else if (name.endsWith(".xlsx")) {
    ledger = ledgerBlocksFromGrid(await readJournalGrid(file, { loadLibrary }));
  } else {
    throw new Error("יש לבחור קובץ PDF או ‎.xlsx של כרטסת קודי מיון.");
  }
  if (!ledger.blocks.length) throw new Error("לא נמצאו קודי מיון בקובץ. יש לבחור «כרטסת קודי מיון» מ-Rivhit.");
  if (!ledger.year) throw new Error("לא נמצאה תקופת הכרטסת בכותרת הקובץ.");
  checkLedgerBlocks(ledger);
  return ledger;
}
