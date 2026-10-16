// Synthetic grids in the layout of docs/EXCEL_IMPORT_SPEC.md. No real client data.
const COLS = { status: 0, vat: 1, net: 3, gross: 4, ref2: 5, ref1: 6, details: 8, counter: 9, cls: 11, line: 12, date: 13 };
const WIDTH = 14;
const EQUIPMENT = "רכישת ציוד/רכוש קבוע";
const OUTSIDE_VAT_BASE = ["ביטוח עסק", "ארנונה"];

export const SAMPLE_ROWS = [
  { kind: "expense", net: 100, vat: 18, cls: "אחזקה", ref1: "1001", details: "Shop A", date: 46023 },
  { kind: "expense", net: 1250.5, vat: 225.09, cls: "חשמל", ref1: "", details: "Utility B", date: 46000 },
  { kind: "expense", net: 100, vat: 0, cls: "חניה פנגו", ref1: "2002", details: "Parking C", date: 46040 },
  { kind: "expense", net: 90, vat: 10.2, cls: "טלפון סלולרי", ref1: "3003", details: "Mobile D", date: 46030 },
  { kind: "expense", net: 500, vat: 0, cls: "ארנונה", ref1: "4004", details: "Council E", date: 46031 },
  { kind: "credit", net: 20, vat: 3.6, cls: "אחזקה", ref1: "1001", details: "Shop A", date: 46032 },
  { kind: "expense", net: 1500, vat: 270, cls: EQUIPMENT, ref1: "5005", details: "Gear F", date: 46033 },
  { kind: "income", net: 10000, vat: 1800, cls: "הכנסות", ref1: "6006", details: "Customer G", date: 46034 },
];

const round2 = (n) => Math.round(n * 100) / 100;

// A client whose Rivhit names income differently and keeps clothing (with VAT) and car licence outside the input base.
export const OTHER_CLIENT = {
  rows: [
    { kind: "expense", net: 100, vat: 18, cls: "אחזקה", ref1: "1001", details: "Shop A", date: 46023 },
    { kind: "expense", net: 101.61, vat: 18.29, cls: "ביגוד", ref1: "496", details: "Sport B", date: 46042 },
    { kind: "expense", net: 2267, vat: 0, cls: "רכב רשוי וביטוח", ref1: "", details: "Licence C", date: 46023 },
    { kind: "income", net: 1000, vat: 180, cls: "הכנסה חייבת", ref1: "", details: "Income D", date: 46052 },
  ],
  income: ["הכנסה חייבת"],
  outside: ["ביגוד", "רכב רשוי וביטוח"],
};

export function formatMoney(value) {
  const text = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value < 0 ? `(${text})` : text;
}

function signedRow(row) {
  const vat = round2(row.vat);
  const net = round2(row.net);
  const gross = round2(net + vat);
  if (row.kind === "income") return { vat, net, gross };
  if (row.kind === "credit") return { vat, net: -net, gross: -gross };
  return { vat: -vat, net, gross };
}

function put(cells, col, text) {
  cells[col] = text;
}

// Returns a 0-based grid with empty cells as "". `footer` overrides computed footer cells by key.
// `income` and `outside` are the class names Rivhit treats as outputs and as outside the VAT input base.
export function buildJournalGrid({
  month = 1,
  year = 2026,
  rows = SAMPLE_ROWS,
  status = "טיוטא",
  footer = {},
  income = ["הכנסות"],
  outside = OUTSIDE_VAT_BASE,
} = {}) {
  const grid = [];
  const line = () => Array(WIDTH).fill("");
  const at = (rowNumber) => (grid[rowNumber - 1] ??= line());
  put(at(3), 2, "תאריך - 02/10/26 13:01:57");
  put(at(3), 10, "ספר תקבולים תשלומים-יומן קליטה");
  put(at(4), 2, "1 דף 1 מתוך");
  put(at(5), 10, `לחודש ${month}/${year}`);
  put(at(9), COLS.ref2, "אסמכ'‏ 2");
  put(at(9), COLS.ref1, "אסמכ'‏ 1");
  const labels = { status: "סטטוס", vat: 'מע"מ', net: 'ללא מע"מ', gross: 'כולל מע"מ', details: "פרטים", counter: "חשבון נגדי", cls: "קוד מיון", line: "שורה", date: "תאריך" };
  for (const [key, text] of Object.entries(labels)) put(at(10), COLS[key], text);

  const sums = { vat: 0, net: 0, gross: 0 };
  const groups = { equipment: { gross: 0, vat: 0 }, inputs: { gross: 0, vat: 0 }, outputs: { gross: 0, vat: 0 } };
  let rowNumber = 11;
  rows.forEach((row, index) => {
    const s = signedRow(row);
    const cells = at(rowNumber);
    put(cells, COLS.status, status);
    put(cells, COLS.vat, formatMoney(s.vat));
    put(cells, COLS.net, formatMoney(s.net));
    put(cells, COLS.gross, formatMoney(s.gross));
    put(cells, COLS.ref2, row.ref2 ?? "");
    put(cells, COLS.ref1, row.ref1 ?? "");
    put(cells, COLS.details, row.details);
    put(cells, COLS.counter, "כרטיס כללי 0");
    put(cells, COLS.cls, row.cls);
    put(cells, COLS.line, String(row.line ?? (index + 1) * 2 + 1));
    put(cells, COLS.date, row.date);
    for (const key of ["vat", "net", "gross"]) sums[key] = round2(sums[key] + s[key]);
    const group =
      income.includes(row.cls) ? groups.outputs : row.cls === EQUIPMENT ? groups.equipment : outside.includes(row.cls) ? null : groups.inputs;
    if (group) {
      group.gross = round2(group.gross + s.gross);
      group.vat = round2(group.vat + (income.includes(row.cls) ? s.vat : -s.vat));
    }
    at(rowNumber + 1); // empty spacer row
    rowNumber += 2;
  });

  const last = rowNumber - 2;
  put(at(last + 1), 1, footer.totalVat ?? formatMoney(sums.vat));
  put(at(last + 1), 4, ':סה"כ מע"מ לחודש');
  put(at(last + 3), 8, footer.arithmeticNet ?? `סיכום אריטמטי ללא מע''מ לביקורת : ${formatMoney(sums.net)}`);
  put(at(last + 3), 12, footer.arithmeticGross ?? `סיכום אריטמטי כולל מע''מ לביקורת : ${formatMoney(sums.gross)}`);
  put(at(last + 4), 3, `ת.ציוד כולל   :  ${formatMoney(groups.equipment.gross)}`);
  put(at(last + 4), 8, `תשומות כולל   :  ${formatMoney(groups.inputs.gross)}`);
  put(at(last + 4), 12, `עסקאות כולל   :  ${formatMoney(groups.outputs.gross)}`);
  put(at(last + 5), 3, `מע"מ ת.ציוד  :  ${formatMoney(groups.equipment.vat)}`);
  put(at(last + 5), 8, `מע"מ תשומות  :  ${formatMoney(groups.inputs.vat)}`);
  put(at(last + 5), 12, `מע"מ עסקאות  :  ${formatMoney(groups.outputs.vat)}`);
  for (let i = 0; i < grid.length; i += 1) grid[i] ??= line();
  return grid;
}
