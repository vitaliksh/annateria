// Reads the classification ledger ("כרטסת קודי מיון") of one client into a chart of that client's own Rivhit codes.
// The ledger comes as .xlsx or .pdf; both are reduced to entries { section, code, name } and then to a chart.
import { normaliseChart } from "./chart-of-accounts.js";
import { readJournalGrid } from "./excel-journal-reader.js";
import { loadPdfJs, validatePdfFile } from "./pdf-import.js";

export const SECTION_TITLE = /^(הכנסות|עלות המכר|הוצאות|לא משתתף)/;
export const CODE_LABEL = /קוד מס/;
export const clean = (value) => String(value ?? "").replace(/[‎‏‪-‮]/g, "").replace(/\s+/g, " ").trim();

// The ledger groups codes into sections; income and "not participating" (equipment) decide the type, the rest are expenses.
export function sectionType(title) {
  return title.startsWith("הכנסות") ? "income" : title.startsWith("לא משתתף") ? "equipment" : "expense";
}

// Sheet grid: a row holding "קוד מס'" carries the code, the name sits in the next non-empty row, a section title is a row
// with that single cell.
export function ledgerEntriesFromGrid(rows) {
  const entries = [];
  let section = "";
  for (let i = 0; i < rows.length; i += 1) {
    const cells = rows[i].map(clean);
    const label = cells.findIndex((cell) => CODE_LABEL.test(cell));
    if (label >= 0) {
      const code = cells.find((cell, index) => index !== label && /^\d{1,4}$/.test(cell)) ?? "";
      let nameRow = i + 1;
      while (nameRow < Math.min(rows.length, i + 4) && !rows[nameRow].some((cell) => clean(cell))) nameRow += 1;
      const name = (rows[nameRow] ?? []).map(clean).find((cell) => cell && !/^\d+$/.test(cell)) ?? "";
      entries.push({ section, code, name });
      i = Math.max(i, nameRow);
      continue;
    }
    const filled = cells.filter(Boolean);
    if (filled.length === 1 && SECTION_TITLE.test(filled[0]) && !filled[0].includes(":")) section = filled[0];
  }
  return entries;
}

// PDF pages as lists of text items { str, x, y, width } (pdf.js coordinates, y grows upwards). The code stands left of the
// label on its line, the name is the item right below the label with the same right edge, section titles are short
// texts at the left margin.
export function ledgerEntriesFromPdfPages(pages) {
  const entries = [];
  let section = "";
  for (const page of pages) {
    const items = page
      .map((item) => ({ s: clean(item.str), x: item.x, y: item.y, w: item.width ?? 0 }))
      .filter((item) => item.s)
      .sort((a, b) => b.y - a.y || b.x - a.x);
    for (const item of items) {
      if (CODE_LABEL.test(item.s)) {
        const code = items.find((other) => Math.abs(other.y - item.y) <= 3 && other.x < item.x && /^\d{1,4}$/.test(other.s))?.s ?? "";
        const right = item.x + item.w;
        const name = items.find((other) => other.y < item.y - 8 && other.y > item.y - 32 && Math.abs(other.x + other.w - right) <= 10)?.s ?? "";
        entries.push({ section, code, name });
      } else if (item.x < 200 && SECTION_TITLE.test(item.s) && !item.s.includes(":")) {
        section = item.s;
      }
    }
  }
  return entries;
}

// `typeByName` carries known types of this client (name -> type): a class outside the VAT input base cannot be told
// from the ledger sections. `skipped` lists entries that could not become accounts.
export function chartFromLedgerEntries(entries, { typeByName = {}, reserved = {} } = {}) {
  const accounts = {};
  const skipped = [];
  for (const { section, code, name } of entries) {
    if (!code || !name) skipped.push({ code, name, reason: "incomplete" });
    else if (accounts[code]) {
      if (accounts[code].name !== name) skipped.push({ code, name, reason: "conflict" });
    } else {
      const type = sectionType(section);
      accounts[code] = { name, type: type === "expense" && typeByName[name] === "outsideVatBase" ? "outsideVatBase" : type };
    }
  }
  const chart = normaliseChart({ accounts }, reserved);
  for (const [code, account] of Object.entries(accounts)) if (!chart[code]) skipped.push({ code, name: account.name, reason: "invalid" });
  return { accounts: Object.fromEntries(Object.entries(chart).sort(([a], [b]) => a.localeCompare(b))), skipped };
}

export async function readPdfPages(file, loadPdf = loadPdfJs) {
  const pdfjs = await loadPdf();
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let number = 1; number <= document.numPages; number += 1) {
    const { items } = await (await document.getPage(number)).getTextContent();
    pages.push(items.filter((item) => "str" in item).map((item) => ({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width })));
  }
  return pages;
}

export async function readLedgerFile(file, { loadLibrary, loadPdf = loadPdfJs, typeByName, reserved } = {}) {
  const name = String(file?.name ?? "").toLowerCase();
  let entries;
  if (name.endsWith(".pdf")) {
    validatePdfFile(file);
    entries = ledgerEntriesFromPdfPages(await readPdfPages(file, loadPdf));
  } else if (name.endsWith(".xlsx")) {
    entries = ledgerEntriesFromGrid(await readJournalGrid(file, { loadLibrary }));
  } else {
    throw new Error("יש לבחור קובץ PDF או ‎.xlsx של כרטסת קודי מיון.");
  }
  const result = chartFromLedgerEntries(entries, { typeByName, reserved });
  if (!Object.keys(result.accounts).length) throw new Error("לא נמצאו קודי מיון בקובץ. יש לבחור «כרטסת קודי מיון» מ-Rivhit.");
  return result;
}
