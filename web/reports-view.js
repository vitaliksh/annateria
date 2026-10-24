// Renders report data (reports.js) as RTL HTML tables; the print stylesheet turns them into a PDF via the browser.
import { monthName } from "./reports.js";

export function formatAmount(value, decimals = 0) {
  const text = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return value < 0 && Number(text.replace(/,/g, "")) !== 0 ? `(${text})` : text;
}

// A nine-digit VAT dealer number as Rivhit prints it ("01471572-6"); anything else as typed.
export function formatVatId(value) {
  const text = String(value ?? "").trim();
  return /^\d{9}$/.test(text) ? `${text.slice(0, 8)}-${text.slice(8)}` : text;
}

// "07/2026".."08/2026" -> "יולי – אוגוסט 2026"; one month -> "יולי 2026"; a period across a year names both years.
export function periodWords(from, to) {
  const [[fromMonth, fromYear], [toMonth, toYear]] = [from.split("/"), to.split("/")];
  const name = (month, year) => monthName(`${year}-${month}`);
  if (from === to) return `${name(fromMonth, fromYear)} ${fromYear}`;
  if (fromYear === toYear) return `${name(fromMonth, fromYear)} – ${name(toMonth, toYear)} ${toYear}`;
  return `${name(fromMonth, fromYear)} ${fromYear} – ${name(toMonth, toYear)} ${toYear}`;
}

// The business line of a report header: "עוסק מורשה: …" and the address, each only when the client card has it.
export function businessLine({ vatId, address } = {}) {
  return [vatId ? `עוסק מורשה: ${formatVatId(vatId)}` : "", String(address ?? "").trim()].filter(Boolean).join(" · ");
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

function header(title, { clientName, from, to, vatId, address }, note) {
  const box = el("header", undefined, "report-header");
  box.append(el("h2", title), el("p", clientName, "report-client"));
  const business = businessLine({ vatId, address });
  if (business) box.append(el("p", business, "report-business"));
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

// The lines of the periodic VAT slip in the order of the PDF page (reports-pdf.js); the exempt line is empty when there
// are no such sales.
export function renderVatReport(report, context) {
  const payable = report.payable >= 0 ? "הסכום לתשלום בשקלים חדשים" : "הסכום להחזר בשקלים חדשים";
  const rows = [
    row(["עסקאות חייבות (ללא מע״מ)", formatAmount(report.taxableSales)]),
    row(["המס על העסקאות", formatAmount(report.outputVat)]),
    row(["עסקאות פטורות או בשיעור אפס", report.exemptSales ? formatAmount(report.exemptSales) : ""]),
    row(["מס תשומות על ציוד ונכסים קבועים", formatAmount(report.equipmentVat)]),
    row(["המס על תשומות אחרות", formatAmount(report.inputVat)]),
    row([{ text: payable, className: "total" }, { text: formatAmount(Math.abs(report.payable)), className: "total" }]),
  ];
  const note = `שיעור מע״מ עסקאות = ${report.vatRate.toFixed(4)}%`;
  const children = [header("דוח מס ערך מוסף", context, note), table(["סעיף", "סכום בש״ח"], rows)];
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

const monthText = (month) => `${month.slice(5)}/${month.slice(0, 4)}`;
const rowPlace = ({ month, position }) => `${monthText(month)}, שורה ${position}`;

// The text of a refusal or warning of buildPcn874 (pcn874.js).
export function pcnProblemText(problem) {
  const texts = {
    no_vat_id: () => "בכרטיס הלקוח אין מספר עוסק מורשה בן 9 ספרות.",
    month_open: () => `ההצהרה של ${monthText(problem.month)} אינה נעולה.`,
    pcn_blocked: () => {
      const rows = problem.count === 1 ? "יש שורה אחת" : `יש ${problem.count} שורות`;
      return `ב־${monthText(problem.month)} ${rows} מעל סף מספר ההקצאה שלא אושרו או שחסר להן מספר הקצאה.`;
    },
    no_supplier: () => `${rowPlace(problem)}: חסר מספר העוסק של הספק.`,
    bad_date: () => `${rowPlace(problem)}: אין תאריך תקין.`,
    no_reference: () => `${rowPlace(problem)}: חסר מספר מסמך.`,
    too_long: () => "סכום ארוך מהשדה שלו בקובץ.",
    bad_check_digit: () => `${rowPlace(problem)}: ספרת הביקורת של מספר העוסק אינה תקינה (הקובץ ייכתב בכל זאת).`,
  };
  return (texts[problem.code] ?? (() => problem.code))();
}

const PCN_KINDS = { S: "מכירה ללקוח מזוהה", L: "מכירות מרוכזות", T: "תשומה מספק" };

// The PCN874 file before it is saved: what stops it, the totals of its opening record and its lines.
export function renderPcn874Report(result, context) {
  const children = [header("קובץ PCN874", context, "דיווח מפורט למע״מ: קובץ להעלאה באתר רשות המסים")];
  const list = (items, className) => {
    const node = el("ul", undefined, className);
    node.append(...items.map((item) => el("li", pcnProblemText(item))));
    return node;
  };
  if (result.problems.length) {
    children.push(el("p", "לא ניתן לשמור את הקובץ עד שיתוקנו:", "report-warning"), list(result.problems, "problem-list"));
  }
  if (result.warnings.length) children.push(el("p", "לתשומת לב:", "report-note"), list(result.warnings, "problem-list"));
  const { report } = result;
  const count = (kinds) => result.lines.filter((line) => kinds.includes(line[0])).length;
  const payable = report.payable >= 0 ? "הסכום לתשלום" : "הסכום להחזר";
  children.push(table(["רשומת פתיחה", "סכום בש״ח"], [
    row(["עסקאות חייבות (ללא מע״מ)", formatAmount(report.taxableSales)]),
    row(["המס על העסקאות", formatAmount(report.outputVat)]),
    row(["עסקאות פטורות או בשיעור אפס", formatAmount(report.exemptSales)]),
    row(["מס תשומות על ציוד ונכסים קבועים", formatAmount(report.equipmentVat)]),
    row(["המס על תשומות אחרות", formatAmount(report.inputVat)]),
    row([{ text: payable, className: "total" }, { text: formatAmount(Math.abs(report.payable)), className: "total" }]),
    row(["רשומות עסקאות", String(count("SL"))]),
    row(["רשומות תשומות", String(count("T"))]),
  ]));
  const date = (text) => `${text.slice(6, 8)}/${text.slice(4, 6)}/${text.slice(0, 4)}`;
  const lines = result.lines.map((line) => {
    const sign = line[40] === "-" ? -1 : 1;
    return row([
      PCN_KINDS[line[0]] ?? line[0], line.slice(1, 10), date(line.slice(10, 18)), String(Number(line.slice(22, 31))),
      formatAmount(sign * Number(line.slice(31, 40))), formatAmount(sign * Number(line.slice(41, 51))),
      Number(line.slice(51)) ? line.slice(51) : "",
    ]);
  });
  const heads = ["סוג", "מספר עוסק", "תאריך", "מספר מסמך", "מע״מ", "ללא מע״מ", "מספר הקצאה"];
  children.push(table(heads, lines, "report-table ledger"));
  return sheet(...children, footer());
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
