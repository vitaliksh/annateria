// Which declaration month a document belongs to. The VAT on a purchase can only be deducted from the month of the
// document onwards, and a month that is already filed (locked in the app) cannot take new rows: the proposal is the
// month of the document date, but never earlier than the first month after the last locked one.

const monthIndex = (month) => {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month ?? ""));
  return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : null;
};
const monthFromIndex = (index) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;

export const nextMonth = (month) => monthFromIndex(monthIndex(month) + 1);
export const monthsBetween = (from, to) => monthIndex(to) - monthIndex(from);

// "DD/MM/YY" (as the journal shows it) or "DD/MM/YYYY"; "." and "-" also separate. Anything else gives null.
export function monthOfDate(text) {
  const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(String(text ?? "").trim());
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 31 || Number(match[2]) < 1 || Number(match[2]) > 12) return null;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, "0")}`;
}

const todayMonth = (today) => `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

// declarations: [{ month, status }]. The last month that is not open; months before it count as filed as well.
export function lockedThrough(declarations) {
  const locked = declarations.filter((declaration) => declaration.status !== "open").map((declaration) => declaration.month).sort();
  return locked.at(-1) ?? null;
}

// A date far in the past or future is more likely a misread than a document of that month.
const PLAUSIBLE_PAST = 24;
const PLAUSIBLE_FUTURE = 2;

// reason: "date" (the document's own month), "after-locked" (moved forward past filed months), "no-date", "implausible".
export function proposeMonth(dateText, { lockedThrough: locked = null, today = new Date() } = {}) {
  const docMonth = monthOfDate(dateText);
  if (!docMonth) return { month: null, docMonth: null, reason: "no-date" };
  const distance = monthsBetween(todayMonth(today), docMonth);
  if (distance < -PLAUSIBLE_PAST || distance > PLAUSIBLE_FUTURE) return { month: null, docMonth, reason: "implausible" };
  const floor = locked ? nextMonth(locked) : null;
  if (floor && docMonth < floor) return { month: floor, docMonth, reason: "after-locked" };
  return { month: docMonth, docMonth, reason: "date" };
}

// Input VAT is deducted within six months of the document date (confirm the exact rule with the bookkeeper).
export function deductionStatus(docMonth, month) {
  if (!docMonth || !month) return "ok";
  const late = monthsBetween(docMonth, month);
  return late > 6 ? "late" : late === 6 ? "check" : "ok";
}

// Months a row can be moved to: open declarations, and the months from the first unfiled one to the month after the
// latest proposal or today. Filed months and months before the last locked one are never offered.
export function targetMonths({ declarations, lockedThrough: locked = null, current, proposals = [], today = new Date() }) {
  const filed = (month) => declarations.some((declaration) => declaration.month === month && declaration.status !== "open") || Boolean(locked && month <= locked);
  const months = new Set(declarations.filter((declaration) => declaration.status === "open").map((declaration) => declaration.month));
  const last = [todayMonth(today), current, ...proposals].filter(Boolean).sort().at(-1);
  const first = locked ? nextMonth(locked) : [current, ...proposals].filter(Boolean).sort()[0];
  for (let month = first; month <= nextMonth(last); month = nextMonth(month)) months.add(month);
  months.add(current);
  return [...months].filter((month) => month === current || !filed(month)).sort();
}
