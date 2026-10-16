// Declaration summary shown at the bottom of the journal. The figures come from the same functions as the VAT report
// (reports.js), so they agree with the report for the month.
import { reportEntries, vatReport } from "./reports.js";

const whole = (value) => Math.round(value);
const sum = (entries, field) => entries.reduce((total, entry) => total + entry[field], 0);

// rows: draft-table rows (rowSnapshot); only active rows count, as in the reports.
export function summarise(rows, { chart = {}, names = {} } = {}) {
  const entries = reportEntries([{ month: "", status: "open", rows }], chart, names);
  const vat = vatReport(entries);
  const expenseEntries = entries.filter((entry) => entry.type === "expense" || entry.type === "outsideVatBase");
  return {
    rows: rows.length,
    turnover: vat.turnover,
    expenses: whole(sum(expenseEntries, "net")),
    outputVat: vat.outputVat,
    inputVat: vat.inputVat,
    equipmentVat: vat.equipmentVat,
    payable: vat.payable,
    hasIncome: entries.some((entry) => entry.type === "income"),
  };
}

export const formatShekels = (value) => `${Math.abs(Math.round(value)).toLocaleString("en-US")} ₪`;

// Labelled figures for the bar. review and excluded are counted from the rendered rows by the toolbar.
export function summaryItems(summary, { review = 0, excluded = 0 } = {}) {
  if (!summary.rows) return [];
  const items = [
    { label: "מחזור", value: formatShekels(summary.turnover) },
    { label: "הוצאות", value: formatShekels(summary.expenses) },
    { label: "מע״מ עסקאות", value: formatShekels(summary.outputVat) },
    { label: "מע״מ תשומות", value: formatShekels(summary.inputVat) },
  ];
  if (summary.equipmentVat) items.push({ label: "מע״מ ציוד", value: formatShekels(summary.equipmentVat) });
  items.push({ label: summary.payable < 0 ? "להחזר" : "לתשלום", value: formatShekels(summary.payable), tone: "total" });
  if (review) items.push({ label: "לבדיקה", value: String(review), tone: "warning" });
  if (excluded) items.push({ label: "מחוץ לדוחות", value: String(excluded), tone: "muted" });
  return items;
}
