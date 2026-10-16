// Reads the periodic income report of the "morning" invoicing program (דיווח הכנסות תקופתי) from the text layer of its
// PDF, without any recognition service. Page 1 holds the totals; the following pages list every document with its
// amounts in fixed columns. The listing is summed up and compared with the totals, so a misread shows as a difference.
import { clean, readPdfPages } from "./ledger-chart.js";
import { validatePdfFile } from "./pdf-import.js";
import { formatMonth } from "./month-format.js";

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const TOLERANCE = 0.011;
const norm = (text) => clean(text).replace(/[״“”]/g, '"');
const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const EDGE = 6;

function amount(text) {
  const match = /^(-)?₪?(-)?([\d,]*\d\.\d\d)$/.exec(text.replace(/\s/g, ""));
  return match ? round2((match[1] || match[2] ? -1 : 1) * Number(match[3].replace(/,/g, ""))) : null;
}

const iso = (text) => {
  const match = DATE.exec(text);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
};

// pages: lists of text items { str, x, y, width } as read by readPdfPages.
const prepare = (page) =>
  page
    .map((item) => ({ s: norm(item.str), x: item.x, y: item.y, r: item.x + (item.width ?? 0) }))
    .filter((item) => item.s);

const sameLine = (a, b, tolerance = 3) => Math.abs(a.y - b.y) <= tolerance;

export function isIncomeReport(pages) {
  const text = prepare(pages[0] ?? []).map((item) => item.s).join(" ");
  return text.includes("דיווח הכנסות תקופתי") && text.includes("סיכום הכנסות ותקבולים");
}

function readPeriod(items) {
  const label = items.find((item) => item.s === "לתקופה");
  const dates = label ? items.filter((item) => sameLine(item, label) && DATE.test(item.s)).map((item) => iso(item.s)).sort() : [];
  return dates.length === 2 ? { from: dates[0], to: dates[1] } : null;
}

// A value stands left of its label on the same line; the nearest amount wins.
function summaryValue(items, labelText) {
  const label = items.find((item) => item.s === labelText);
  if (!label) return null;
  const candidates = items.filter((item) => sameLine(item, label) && item.r <= label.x + 3 && amount(item.s) !== null);
  const nearest = candidates.sort((a, b) => b.r - a.r)[0];
  return nearest ? amount(nearest.s) : null;
}

function readSummary(items) {
  const taxable = summaryValue(items, 'סה"כ הכנסות חייבות');
  const exempt = summaryValue(items, 'סה"כ הכנסות פטורות') ?? 0;
  const vat = summaryValue(items, 'מע"מ');
  const gross = summaryValue(items, 'סה"כ הכנסות כולל מע"מ');
  if (taxable === null || vat === null || gross === null) throw new Error("לא נמצא סיכום ההכנסות בדוח. ייתכן שפורמט הדוח השתנה.");
  return { taxable, exempt, vat, gross };
}

const kindOfSection = (title) => (/זיכוי/.test(title) ? "credit" : /חשבונית/.test(title) ? "invoice" : "other");

// Section titles read "<title> ( N מסמכים )"; the text items are split around the number.
function sectionHeadings(items) {
  return items
    .filter((item) => item.s === "מסמכים(")
    .map((label) => {
      const line = items.filter((item) => sameLine(item, label, 2) && item !== label);
      const count = line.filter((item) => /^\d+$/.test(item.s) && item.x > label.x).sort((a, b) => a.x - b.x)[0];
      const title = line.filter((item) => !/^\d+$/.test(item.s)).sort((a, b) => b.x - a.x)[0];
      return title && count ? { y: label.y, title: title.s.replace(/[\s)(]+$/, "").trim(), declared: Number(count.s) } : null;
    })
    .filter(Boolean);
}

function columnEdges(items) {
  const number = items.find((item) => /^מס['׳’]?$/.test(item.s));
  if (!number) return null;
  const header = (text) => items.find((item) => item.s === text && sameLine(item, number, 2));
  const [gross, vat, exempt, taxable] = ['סה"כ', 'מע"מ', 'פטור מע"מ', 'חייב מע"מ'].map(header);
  return gross && vat && exempt && taxable ? { y: number.y, number: number.r, gross: gross.r, vat: vat.r, exempt: exempt.r, taxable: taxable.r } : null;
}

// Every document stands on one line: its number in the first column and the four amounts under their headers.
// Returns the page's sections in reading order; documents above the first heading continue the previous page's section.
function pageSections(items) {
  const sections = [];
  const current = () => sections.at(-1) ?? sections[sections.push({ title: "", declared: null, documents: [], incomplete: [] }) - 1];
  const edges = columnEdges(items);
  const events = sectionHeadings(items).map((section) => ({ y: section.y, section }));
  if (edges) {
    for (const item of items) {
      if (!/^\d+$/.test(item.s) || Math.abs(item.r - edges.number) > EDGE || item.y >= edges.y) continue;
      const at = (edge) => items.find((other) => sameLine(other, item, 2.5) && Math.abs(other.r - edge) <= EDGE && amount(other.s) !== null);
      const [gross, vat, exempt, taxable] = [edges.gross, edges.vat, edges.exempt, edges.taxable].map(at);
      const date = items.find((other) => sameLine(other, item, 2.5) && DATE.test(other.s));
      events.push({
        y: item.y,
        number: item.s,
        document: gross && vat && exempt && taxable
          ? { number: item.s, date: date ? iso(date.s) : null, gross: amount(gross.s), vat: amount(vat.s), exempt: amount(exempt.s), taxable: amount(taxable.s) }
          : null,
      });
    }
  }
  for (const event of events.sort((a, b) => b.y - a.y)) {
    if (event.section) sections.push({ ...event.section, documents: [], incomplete: [] });
    else if (event.document) current().documents.push(event.document);
    else current().incomplete.push(event.number);
  }
  return sections;
}

// Returns null when the pages are not an income report. Throws when they are one but the totals cannot be read.
export function parseIncomeReport(pages) {
  if (!isIncomeReport(pages)) return null;
  const first = prepare(pages[0]);
  const period = readPeriod(first);
  if (!period) throw new Error("לא נמצאה תקופת הדוח.");
  const summary = readSummary(first);
  const declaredLabel = first.find((item) => item.s === "מסמכים(");
  const declaredTotal = declaredLabel
    ? Number(first.filter((item) => sameLine(item, declaredLabel, 2) && /^\d+$/.test(item.s) && item.x > declaredLabel.x).sort((a, b) => a.x - b.x)[0]?.s) || null
    : null;

  const sections = [];
  for (const page of pages.slice(1)) {
    for (const part of pageSections(prepare(page))) {
      const last = sections.at(-1);
      // A section continues over several pages, repeating the heading only on its first page.
      if (part.title === "" && last) {
        last.documents.push(...part.documents);
        last.incomplete.push(...part.incomplete);
      } else sections.push({ ...part, kind: kindOfSection(part.title) });
    }
  }

  const problems = [];
  const sum = (field) => {
    let total = 0;
    for (const section of sections) {
      const sign = section.kind === "invoice" ? 1 : section.kind === "credit" ? -1 : 0;
      for (const document of section.documents) total += sign * document[field];
    }
    return round2(total);
  };
  const parsed = sections.reduce((count, section) => count + section.documents.length, 0);
  for (const section of sections) {
    if (section.incomplete.length) problems.push({ code: "unreadable-documents", title: section.title, count: section.incomplete.length });
    if (section.declared !== null && section.declared !== section.documents.length + section.incomplete.length) {
      problems.push({ code: "section-count", title: section.title, declared: section.declared, parsed: section.documents.length });
    }
  }
  if (declaredTotal !== null && parsed && declaredTotal !== sections.reduce((count, section) => count + section.declared, 0)) {
    problems.push({ code: "document-count", declared: declaredTotal, parsed });
  }
  if (parsed) {
    for (const [field, expected] of [["gross", summary.gross], ["vat", summary.vat], ["taxable", summary.taxable], ["exempt", summary.exempt]]) {
      if (Math.abs(sum(field) - expected) > TOLERANCE) problems.push({ code: "sum-differs", field, listing: sum(field), summary: expected });
    }
  }
  if (Math.abs(summary.taxable + summary.exempt + summary.vat - summary.gross) > TOLERANCE) problems.push({ code: "summary-inconsistent" });

  return {
    period,
    month: period.to.slice(0, 7),
    ...summary,
    documents: declaredTotal ?? parsed,
    parsedDocuments: parsed,
    sections: sections.map(({ title, kind, declared, documents }) => ({ title, kind, declared, parsed: documents.length })),
    verified: parsed > 0 && problems.length === 0,
    problems,
  };
}

export async function readIncomeReportFile(file, { loadPdf } = {}) {
  validatePdfFile(file);
  return parseIncomeReport(await readPdfPages(file, loadPdf));
}

const displayDate = (isoDate) => `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}/${isoDate.slice(2, 4)}`;
const displayLong = (isoDate) => `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}/${isoDate.slice(0, 4)}`;
const money = (value) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PROBLEM_TEXTS = {
  "unreadable-documents": (problem) => `${problem.count} מסמכים ב«${problem.title}» לא נקראו במלואם`,
  "section-count": (problem) => `ב«${problem.title}» נקראו ${problem.parsed} מסמכים מתוך ${problem.declared}`,
  "document-count": (problem) => `נקראו ${problem.parsed} מסמכים מתוך ${problem.declared}`,
  "sum-differs": (problem) => `סכום הפירוט (${money(problem.listing)}) שונה מהסיכום (${money(problem.summary)}) בשדה ${{ gross: "כולל מע״מ", vat: "מע״מ", taxable: "חייב", exempt: "פטור" }[problem.field]}`,
  "summary-inconsistent": () => "סיכום הדוח אינו מתחבר: חייב + פטור + מע״מ שונה מהסה״כ",
};

// One line for the status bar and the row's explanation.
export function describeIncomeReport(report) {
  const head = `דוח הכנסות ${displayLong(report.period.from)}–${displayLong(report.period.to)}: ${report.documents} מסמכים, סה״כ ${money(report.gross)} (ללא מע״מ ${money(report.taxable + report.exempt)}, מע״מ ${money(report.vat)})`;
  if (report.verified) return `${head}. הפירוט נקרא ותואם לסיכום.`;
  if (!report.parsedDocuments) return `${head}. פירוט המסמכים לא נקרא, הסכומים נלקחו מהסיכום בלבד — יש לבדוק מול הדוח.`;
  return `${head}. נדרש עיון: ${report.problems.map((problem) => PROBLEM_TEXTS[problem.code](problem)).join("; ")}.`;
}

// Draft-table rows (saved-snapshot format of app.js): one row for the taxable income and, only when there is exempt
// income, a second row with zero VAT. The VAT is the report's own sum of the documents' VAT, never recomputed.
export function buildIncomeRows(report, code, { now = new Date().toISOString(), makeId = () => crypto.randomUUID() } = {}) {
  const note = describeIncomeReport(report);
  const make = (net, vat, label) => ({
    documentId: `income-${makeId()}`,
    imageIndex: 0,
    imageFile: "",
    receivedAt: now,
    values: [
      displayDate(report.period.to),
      code,
      `${label} ${formatMonth(report.month)}`,
      "חשבונית ירוקה",
      "",
      "",
      "",
      round2(net + vat).toFixed(2),
      net.toFixed(2),
      vat.toFixed(2),
      "100",
      "100",
    ],
    rawNet: net.toFixed(2),
    rawVat: vat.toFixed(2),
    vatPercent: net ? String(round2((Math.abs(vat) / Math.abs(net)) * 100)) : "0",
    form6111Code: "",
    highlights: [],
    active: true,
    agentOpinion: note,
    confidence: "",
    statusText: report.verified ? "יובא מדוח הכנסות" : "נדרש עיון — ראה החלטת הסוכן",
    statusClass: report.verified ? "ready" : "review",
  });
  const rows = [];
  if (report.taxable || !report.exempt) rows.push(make(report.taxable, report.vat, report.exempt ? "הכנסות חייבות" : "הכנסות"));
  if (report.exempt) rows.push(make(report.exempt, 0, "הכנסות פטורות"));
  return rows;
}

// The same report must not be added twice to one declaration: same date, code and gross amount.
export function hasIncomeRow(existingRows, newRow) {
  return existingRows.some(
    (row) => row.active !== false && row.values?.[0] === newRow.values[0] && String(row.values?.[1]) === newRow.values[1] && Number(row.values?.[7]) === Number(newRow.values[7]),
  );
}
