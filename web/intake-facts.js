// Facts about a recognised document that the intake rules of the bookkeeper (Anna) need, computed from code and local
// data only, without any AI: in which declaration month the row belongs, whether its year is accepted, whether the
// same document was already entered, and whether the VAT deduction window is at risk. Pure; no DOM, no file access.
//
// Rules (docs/HANDOFF.md, "Two-agent redesign"):
// 1. A document of any month of the declaration's year is accepted (an invoice for March that arrives in October).
// 2. Every document is searched for among the rows of all declarations from the month of its date onwards, locked
//    months included.
// 3. Only the year of the declaration month the row goes to is accepted ("previous-year" otherwise).
// 4. A document for a period (annual insurance) is judged by the end of the period and goes to the month of receipt.
import { deductionStatus, monthOfDate, monthsBetween, nextMonth, proposeMonth } from "./month-distribution.js";

const pad = (number) => String(number).padStart(2, "0");
const monthKey = (year, month) => (month >= 1 && month <= 12 ? `${year}-${pad(month)}` : null);

// "YYYY-MM-DD", "YYYY-MM" (the period fields) or "DD/MM/YY" (as the journal shows dates). Unreadable gives null.
export function monthOfAnyDate(text) {
  const iso = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(String(text ?? "").trim());
  return iso ? monthKey(iso[1], Number(iso[2])) : monthOfDate(text);
}

// The whole date as "YYYY-MM-DD" from the same spellings, or null.
export function dateKey(text) {
  const value = String(text ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const journal = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(value);
  const year = iso ? iso[1] : journal && (journal[3].length === 2 ? `20${journal[3]}` : journal[3]);
  const month = Number(iso ? iso[2] : journal?.[2]);
  const day = Number(iso ? iso[3] : journal?.[1]);
  return year && month >= 1 && month <= 12 && day >= 1 && day <= 31 ? `${year}-${pad(month)}-${pad(day)}` : null;
}

const journalDate = (text) => {
  const key = dateKey(text);
  return key ? `${key.slice(8)}/${key.slice(5, 7)}/${key.slice(0, 4)}` : "";
};

const receiptMonth = (receivedAt, today) => {
  const moment = receivedAt ? new Date(receivedAt) : today;
  const date = Number.isNaN(moment.getTime()) ? today : moment;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
};

// A period counts only when both ends are known and it spans at least three months: monthly and bimonthly bills
// (telephone, electricity) are judged by their date like any other document, an annual insurance by its period.
const MIN_PERIOD_MONTHS = 3;
function periodMonths(periodFrom, periodTo) {
  const from = monthOfAnyDate(periodFrom);
  const to = monthOfAnyDate(periodTo);
  return from && to && monthsBetween(from, to) >= MIN_PERIOD_MONTHS ? { from, to } : null;
}

export const isPeriodDocument = (periodFrom, periodTo) => Boolean(periodMonths(periodFrom, periodTo));

// Which declaration month the document belongs to. A document for a period goes to the month of receipt, any other to
// the month of its date; neither goes into a filed month, so both move to the first month after the last locked one.
// reason: "date", "after-locked", "period-received", "no-date", "implausible" (month is null for the last two).
export function intakeMonth({ date, periodFrom, periodTo, receivedAt, lockedThrough = null, today = new Date() }) {
  const docMonth = monthOfAnyDate(date);
  if (periodMonths(periodFrom, periodTo)) {
    const received = receiptMonth(receivedAt, today);
    const floor = lockedThrough ? nextMonth(lockedThrough) : null;
    const filed = floor && received < floor;
    return { month: filed ? floor : received, docMonth, reason: filed ? "after-locked" : "period-received" };
  }
  return proposeMonth(journalDate(date), { lockedThrough, today });
}

// status: "ok", "previous-year" (refused), "future-year" (to look at), "no-date". basis: "date" or "period".
export function yearGate({ docMonth, periodFrom, periodTo, targetMonth }) {
  const allowedYear = Number(targetMonth.slice(0, 4));
  const period = periodMonths(periodFrom, periodTo);
  if (period) {
    const start = Number(period.from.slice(0, 4));
    const end = Number(period.to.slice(0, 4));
    const status = end < allowedYear ? "previous-year" : start > allowedYear ? "future-year" : "ok";
    return { status, basis: "period", year: end, allowedYear };
  }
  if (!docMonth) return { status: "no-date", basis: "date", year: null, allowedYear };
  const year = Number(docMonth.slice(0, 4));
  const status = year < allowedYear ? "previous-year" : year > allowedYear ? "future-year" : "ok";
  return { status, basis: "date", year, allowedYear };
}

// --- duplicates ---------------------------------------------------------------------------------------------------

// Column positions of a saved row (draft-table format): see rowSnapshot in app.js.
const DATE = 0;
const SUPPLIER = 3;
const SUPPLIER_ID = 4;
const REFERENCE = 5;
const GROSS = 7;

const normalReference = (value) => String(value ?? "").replace(/[^\p{L}\p{N}]/gu, "").toUpperCase().replace(/^0+/, "");
const supplierDigits = (value) => String(value ?? "").replace(/\D/g, "").replace(/^0+/, "");
const NAME_STOP = new Set(["בעמ", "בע", "מ", "ltd", "inc", "llc", "חברת", "חברה", "ושות", "the"]);
const nameTokens = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/["'״׳”“]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => (token.length > 3 && token.startsWith("ה") ? token.slice(1) : token))
    .filter((token) => token.length >= 2 && !NAME_STOP.has(token));

// A row as the duplicate search sees it. `row` is in the draft-table format. The table shows only the last four digits of
// a reference; a row that kept the full printed one (`row.reference`) is compared in full, so that the yearly letters of
// one insurer (same last digits, same amount) are not taken for one document. The amounts are the source amounts when the
// row has them (the table amounts depend on the recognition percentages).
export function entryFromRow(row, { month, status = "open", position = 0 }) {
  const values = row.values ?? [];
  const full = String(row.reference ?? "").trim();
  const reference = normalReference(full || values[REFERENCE]);
  const source = Math.abs((Number(row.rawNet) || 0) + (Number(row.rawVat) || 0));
  return {
    month,
    status,
    position,
    documentId: String(row.documentId ?? ""),
    date: dateKey(values[DATE]),
    supplier: nameTokens(values[SUPPLIER] || values[2]),
    supplierId: supplierDigits(values[SUPPLIER_ID]),
    reference,
    fullReference: Boolean(full),
    referenceTail: reference.replace(/\D/g, "").slice(-4),
    gross: source > 0 ? source : Math.abs(Number(values[GROSS]) || 0),
  };
}

const sameSupplier = (left, right) =>
  (left.supplierId && right.supplierId && left.supplierId === right.supplierId) ||
  left.supplier.some((token) => token.length >= 3 && right.supplier.includes(token));
// Two full references must be equal; when one side is only the last four digits, those digits decide.
const sameReference = (left, right) =>
  Boolean(left.reference) &&
  (left.reference === right.reference ||
    (!(left.fullReference && right.fullReference) && Boolean(left.referenceTail) && left.referenceTail === right.referenceTail));
const differentSupplierIds = (left, right) =>
  left.supplierId && right.supplierId && left.supplierId !== right.supplierId;

const LEVEL_ORDER = { strong: 3, likely: 2, possible: 1 };

// How alike two documents are. strong: same reference and amount from the same supplier. likely: same reference
// (three or more characters), amount and date but no supplier evidence (rows of the bookkeeper's journals carry only a
// short supplier name). possible: no reference on one side, same supplier, amount and date. Otherwise null.
function similarity(candidate, entry) {
  if (!candidate.gross || Math.abs(candidate.gross - entry.gross) >= 0.005) return null;
  if (differentSupplierIds(candidate, entry)) return null;
  const sameDate = Boolean(candidate.date) && candidate.date === entry.date;
  if (sameReference(candidate, entry)) {
    if (sameSupplier(candidate, entry)) return "strong";
    return sameDate && candidate.reference.length >= 3 ? "likely" : null;
  }
  return (!candidate.reference || !entry.reference) && sameDate && sameSupplier(candidate, entry) ? "possible" : null;
}

// entries: entryFromRow results of every active row to search. A row never matches itself or another record of the
// same document (the two halves of a mixed-VAT invoice share a reference but not an amount), and inside its own
// declaration only the rows above it count, so of two copies of one document the later one is the duplicate.
export function findDuplicates(entries, candidate, { fromMonth = null } = {}) {
  const matches = [];
  for (const entry of entries) {
    if (fromMonth && entry.month < fromMonth) continue;
    if (entry.documentId && entry.documentId === candidate.documentId) continue;
    if (entry.month === candidate.month && entry.position >= candidate.position) continue;
    const level = similarity(candidate, entry);
    if (!level) continue;
    const { month, status, documentId, position } = entry;
    matches.push({ level, month, status, documentId, position });
  }
  matches.sort((a, b) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level] || a.month.localeCompare(b.month));
  return { level: matches[0]?.level ?? null, matches: matches.slice(0, 5) };
}

// --- everything about one row ---------------------------------------------------------------------------------------

// candidate: { row (draft-table format), month (the declaration it sits in), position, periodFrom, periodTo }.
// context: { entries, lockedThrough, today }.
// exclude is what the code itself applies: "previous-year" or "duplicate" (strong or likely); a possible duplicate, a
// document of a future year, a missing date and a late VAT deduction only warn.
export function intakeFacts(candidate, { entries = [], lockedThrough = null, today = new Date() } = {}) {
  const values = candidate.row.values ?? [];
  const { periodFrom = "", periodTo = "" } = candidate;
  const { receivedAt } = candidate.row;
  const where = intakeMonth({ date: values[DATE], periodFrom, periodTo, receivedAt, lockedThrough, today });
  const targetMonth = where.month ?? candidate.month;
  const year = yearGate({ docMonth: where.docMonth, periodFrom, periodTo, targetMonth });
  const own = entryFromRow(candidate.row, { month: candidate.month, position: candidate.position });
  // The search starts at the earliest of the document month, the target month and the month the row sits in now:
  // a copy in the open table is a duplicate even when the document belongs to a later month.
  const first = [where.docMonth, targetMonth, candidate.month].filter(Boolean).sort()[0];
  const fromMonth = where.docMonth ? first : `${targetMonth.slice(0, 4)}-01`;
  const duplicates = findDuplicates(entries, own, { fromMonth });
  const duplicate = ["strong", "likely"].includes(duplicates.level);
  const exclude = year.status === "previous-year" ? "previous-year" : duplicate ? "duplicate" : null;
  const period = year.basis === "period";
  return {
    targetMonth,
    docMonth: where.docMonth,
    monthReason: where.reason,
    year,
    duplicates,
    deduction: period || !where.docMonth ? "ok" : deductionStatus(where.docMonth, targetMonth),
    moves: targetMonth !== candidate.month,
    exclude,
  };
}
