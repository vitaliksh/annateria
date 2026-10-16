// Pure report calculations from the app's own declaration rows; formulas are in docs/REPORTS_SPEC.md.
const MONTH_NAMES = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const whole = (value) => Math.round(value);
const sum = (items, field) => round2(items.reduce((total, item) => total + item[field], 0));

export const monthName = (month) => MONTH_NAMES[Number(String(month).slice(5, 7)) - 1] ?? "";

// "2026-07".."2026-08" -> ["2026-07", "2026-08"]
export function monthsInPeriod(from, to) {
  const months = [];
  let [year, month] = from.split("-").map(Number);
  const [lastYear, lastMonth] = to.split("-").map(Number);
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) [year, month] = [year + 1, 1];
  }
  return months;
}

// Reporting period containing `month`: a calendar month, or the odd/even pair (1-2, 3-4, ...).
export function periodContaining(month, kind = "monthly") {
  if (kind !== "bimonthly") return { from: month, to: month };
  const [year, number] = month.split("-").map(Number);
  const first = number % 2 ? number : number - 1;
  const pad = (value) => `${year}-${String(value).padStart(2, "0")}`;
  return { from: pad(first), to: pad(first + 1) };
}

// declarations: [{ month, status, rows }] with rows in the draft-table format. Only active rows count.
// accounts: chart of accounts (code -> { name, type }); names: code -> name for codes outside the chart.
export function reportEntries(declarations, accounts = {}, names = {}) {
  const entries = [];
  for (const declaration of declarations) {
    for (const row of declaration.rows ?? []) {
      if (!row.active) continue;
      const values = row.values ?? [];
      const code = String(values[1] ?? "");
      const account = accounts[code];
      const name = account?.name ?? names[code] ?? code;
      entries.push({
        month: declaration.month,
        status: declaration.status,
        code,
        name,
        type: account?.type ?? (name === "הכנסות" ? "income" : "expense"),
        date: String(values[0] ?? ""),
        details: String(values[3] || values[2] || ""),
        reference: String(values[5] ?? ""),
        gross: round2(Number(values[7]) || 0),
        net: round2(Number(values[8]) || 0),
        vat: round2(Number(values[9]) || 0),
      });
    }
  }
  return entries;
}

export function inPeriod(entries, from, to) {
  const months = new Set(monthsInPeriod(from, to));
  return entries.filter((entry) => months.has(entry.month));
}

const ofType = (entries, ...types) => entries.filter((entry) => types.includes(entry.type));

// Lines are whole shekels and the payable amount is their difference, as on the VAT form.
export function vatReport(entries, { vatRate = 18 } = {}) {
  const turnover = whole(sum(ofType(entries, "income"), "net"));
  const outputVat = whole(sum(ofType(entries, "income"), "vat"));
  // Classes outside the input base (property tax, insurance, clothing) are expenses, but their VAT is not deducted.
  const inputVat = whole(sum(ofType(entries, "expense"), "vat"));
  const equipmentVat = whole(sum(ofType(entries, "equipment"), "vat"));
  return {
    vatRate,
    turnover,
    outputVat,
    inputVat,
    equipmentVat,
    payable: outputVat - inputVat - equipmentVat,
    openCount: entries.filter((entry) => entry.status !== "closed").length,
  };
}

export function advancesReport(entries, { percent, deductions = 0 }) {
  const turnover = whole(sum(ofType(entries, "income"), "net"));
  const advance = whole((turnover * percent) / 100);
  return { turnover, percent, advance, deductions, total: advance - deductions };
}

function byCode(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.code)) groups.set(entry.code, { code: entry.code, name: entry.name, entries: [] });
    groups.get(entry.code).entries.push(entry);
  }
  return [...groups.values()].sort((a, b) => a.code.localeCompare(b.code));
}

// Net amounts without VAT; equipment is not part of the result. Percentages are of total income.
export function profitLoss(entries) {
  const incomeEntries = ofType(entries, "income");
  const expenseEntries = ofType(entries, "expense", "outsideVatBase");
  const incomeTotal = sum(incomeEntries, "net");
  const percent = (amount) => (incomeTotal ? round2((amount / incomeTotal) * 100) : 0);
  const lines = (list) => byCode(list).map((group) => {
    const amount = sum(group.entries, "net");
    return { code: group.code, name: group.name, amount: whole(amount), percent: percent(amount) };
  });
  const expenseTotal = sum(expenseEntries, "net");
  const profit = round2(incomeTotal - expenseTotal);
  return {
    income: lines(incomeEntries),
    incomeTotal: whole(incomeTotal),
    expenses: lines(expenseEntries),
    expenseTotal: whole(expenseTotal),
    expensePercent: percent(expenseTotal),
    profit: whole(profit),
    profitPercent: percent(profit),
  };
}

// Classification ledger: income, expenses ("management and general") and the not-participating equipment.
// Expenses are shown negative, as in Rivhit; amounts keep agorot.
export function classificationLedger(entries) {
  const sign = (entry) => (entry.type === "income" ? 1 : -1);
  const account = (group) => {
    const rows = group.entries
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => a.entry.month.localeCompare(b.entry.month) || a.index - b.index)
      .map(({ entry }) => ({
        month: entry.month,
        monthName: monthName(entry.month),
        date: entry.date,
        details: entry.details,
        reference: entry.reference,
        gross: round2(sign(entry) * entry.gross),
        net: round2(sign(entry) * entry.net),
        vat: round2(sign(entry) * entry.vat),
        status: entry.status,
      }));
    return { code: group.code, name: group.name, rows, gross: sum(rows, "gross"), net: sum(rows, "net"), vat: sum(rows, "vat") };
  };
  const section = (title, list) => {
    const accounts = byCode(list).map(account);
    return { title, accounts, gross: sum(accounts, "gross"), net: sum(accounts, "net"), vat: sum(accounts, "vat") };
  };
  const sections = [
    section("הכנסות", ofType(entries, "income")),
    section("הוצאות הנהלה וכלליות", ofType(entries, "expense", "outsideVatBase")),
    section("לא משתתף", ofType(entries, "equipment")),
  ].filter((item) => item.accounts.length);
  return {
    sections,
    gross: sum(sections, "gross"),
    net: sum(sections, "net"),
    vat: sum(sections, "vat"),
  };
}
