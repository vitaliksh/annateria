// Renders report data (reports.js) as RTL HTML tables; the print stylesheet turns them into a PDF via the browser.
export function formatAmount(value, decimals = 0) {
  const text = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return value < 0 && Number(text.replace(/,/g, "")) !== 0 ? `(${text})` : text;
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function row(cells, className) {
  const tr = el("tr", undefined, className);
  for (const cell of cells) {
    const td = el(typeof cell === "object" && cell.head ? "th" : "td", typeof cell === "object" ? cell.text : cell);
    if (typeof cell === "object" && cell.className) td.className = cell.className;
    tr.append(td);
  }
  return tr;
}

function table(headers, rows, className = "report-table") {
  const node = el("table", undefined, className);
  const head = el("thead");
  head.append(row(headers.map((text) => ({ head: true, text }))));
  const body = el("tbody");
  body.append(...rows);
  node.append(head, body);
  return node;
}

function header(title, { clientName, from, to }, note) {
  const box = el("header", undefined, "report-header");
  box.append(el("h2", title), el("p", clientName, "report-client"));
  box.append(el("p", from === to ? `תקופה: ${from}` : `לתקופה: ${from} – ${to}`, "report-period"));
  if (note) box.append(el("p", note, "report-note"));
  return box;
}

const footer = () => el("p", "דוח עזר לרואה החשבון בלבד, אינו ייעוץ מס.", "report-footer");
const sheet = (...children) => {
  const node = el("article", undefined, "report-sheet");
  node.dir = "rtl";
  node.append(...children);
  return node;
};

export function renderVatReport(report, context) {
  const payable = report.payable >= 0 ? "סה״כ מע״מ לתשלום" : "סה״כ מע״מ להחזר";
  const rows = [
    row(["מחזור עסקאות", formatAmount(report.turnover)]),
    row([`מע״מ עסקאות (${report.vatRate}%)`, formatAmount(report.outputVat)]),
    row(["מע״מ תשומות", formatAmount(report.inputVat)]),
    row(["מע״מ תשומות ציוד", formatAmount(report.equipmentVat)]),
    row([{ text: payable, className: "total" }, { text: formatAmount(Math.abs(report.payable)), className: "total" }]),
  ];
  const children = [header("דוח מס ערך מוסף", context), table(["סעיף", "סכום בש״ח"], rows)];
  if (report.openCount) children.unshift(el("p", `קיימות ${report.openCount} תנועות לא מעודכנות`, "report-warning"));
  return sheet(...children, footer());
}

export function renderAdvancesReport(report, context) {
  const rows = [
    row(["מחזור", formatAmount(report.turnover)]),
    row(["אחוז מקדמות מהמחזור", `${report.percent}%`]),
    row(["מקדמה", formatAmount(report.advance)]),
    row(["ניכויים", formatAmount(report.deductions)]),
    row([{ text: "סה״כ לתשלום", className: "total" }, { text: formatAmount(report.total), className: "total" }]),
  ];
  return sheet(header("דוח מקדמות ע״פ מחזור", context), table(["סעיף", "סכום בש״ח"], rows), footer());
}

export function renderProfitLossReport(report, context) {
  const line = (item, sign) => row([item.name, formatAmount(sign * item.amount), `${item.percent.toFixed(2)}%`]);
  const total = (label, amount, percent) => row([
    { text: label, className: "total" },
    { text: formatAmount(amount), className: "total" },
    { text: `${percent.toFixed(2)}%`, className: "total" },
  ]);
  const group = (title) => row([{ text: title, className: "group", head: true }, "", ""]);
  const rows = [
    group("הכנסות"),
    ...report.income.map((item) => line(item, 1)),
    total("סה״כ הכנסות", report.incomeTotal, report.incomeTotal ? 100 : 0),
    group("הוצאות הנהלה וכלליות"),
    ...report.expenses.map((item) => line(item, -1)),
    total("סה״כ הוצאות הנהלה וכלליות", -report.expenseTotal, report.expensePercent),
    total("רווח לתקופה", report.profit, report.profitPercent),
  ];
  const content = table(["", "שקלים חדשים", "% מהמכירות"], rows);
  return sheet(header("דוח רווח והפסד", context, "ללא מס ערך מוסף"), content, footer());
}

export function renderLedgerReport(ledger, context, statusLabel = (status) => (status === "closed" ? "" : "טיוטא")) {
  const money = (value) => formatAmount(value, 2);
  const children = [header("כרטסת קודי מיון", context)];
  for (const section of ledger.sections) {
    children.push(el("h3", section.title, "report-section"));
    for (const account of section.accounts) {
      children.push(el("h4", `קוד ${account.code} · ${account.name}`, "report-account"));
      const rows = account.rows.map((item) => row([
        item.monthName, item.date, item.details, item.reference, money(item.gross), money(item.net), money(item.vat),
        statusLabel(item.status),
      ]));
      rows.push(row([{ text: `סה״כ ${account.name}`, className: "total" }, "", "", "", money(account.gross), money(account.net), money(account.vat), ""], "subtotal"));
      children.push(table(["חודש", "תאריך", "פרטים", "אסמכתא", "כולל מע״מ", "ללא מע״מ", "מע״מ", "סטטוס"], rows, "report-table ledger"));
    }
    children.push(el("p", `סה״כ ${section.title}: ${money(section.gross)} · ${money(section.net)} · ${money(section.vat)}`, "report-total"));
  }
  children.push(el("p", `סה״כ לדוח: ${money(ledger.gross)} · ${money(ledger.net)} · ${money(ledger.vat)}`, "report-total grand"));
  return sheet(...children, footer());
}
