// Months are stored as YYYY-MM and shown and typed as MM/YYYY, the Israeli order.
export const MONTH_FORMAT_ERROR = "יש להזין חודש בפורמט MM/YYYY.";

// "1/2026", "01.2026", "01-2026" and the stored "2026-01" give "2026-01"; anything else gives null.
export function parseMonthText(text) {
  const value = String(text ?? "").trim();
  const shown = /^(\d{1,2})[/.-](\d{4})$/.exec(value);
  const stored = /^(\d{4})-(\d{2})$/.exec(value);
  const [year, month] = shown ? [shown[2], Number(shown[1])] : stored ? [stored[1], Number(stored[2])] : [];
  return year && month >= 1 && month <= 12 ? `${year}-${String(month).padStart(2, "0")}` : null;
}

export function formatMonth(iso) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(iso ?? ""));
  return match ? `${match[2]}/${match[1]}` : "";
}
