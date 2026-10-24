// Rivhit-style A4 pages for the four reports. layoutReport is pure (it returns draw operations per page, so it can be
// tested without a browser); renderReportPdf draws the operations on canvases and wraps the pages into a PDF.
import { jpegPagesToPdf } from "./document-package.js";
import { formatAmount, formatVatId, periodWords } from "./reports-view.js";

export const PAGE_WIDTH = 1240, PAGE_HEIGHT = 1754;
const RENDER_SCALE = 2, RIGHT = 1170, LEFT = 70, BODY_TOP = 300, BODY_BOTTOM = 1690;
const FOOTER_TEXT = "דוח עזר לרואה החשבון בלבד, אינו ייעוץ מס.";

const text = (x, y, value, options = {}) => ({ type: "text", x, y, text: String(value), size: 21, bold: false, align: "right", underline: false, ...options });
const line = (x1, x2, y, width = 2) => ({ type: "line", x1, x2, y, width });
const rect = (x, y, width, height, options = {}) => ({ type: "rect", x, y, width, height, ...options });
const doubleLine = (x1, x2, y) => [line(x1, x2, y, 2), line(x1, x2, y + 6, 2)];
const money = (value) => formatAmount(value, 2);
const pad = (value) => String(value).padStart(2, "0");

export function formatStamp(date) {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${String(date.getFullYear()).slice(2)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Cursor over a list of pages; `onNewPage` redraws the headings that Rivhit repeats on every continuation page.
function pageBuilder() {
  const pages = [[]];
  const builder = {
    y: BODY_TOP,
    add: (...ops) => pages.at(-1).push(...ops),
    ensure(height, onNewPage) {
      if (builder.y + height <= BODY_BOTTOM) return;
      pages.push([]);
      builder.y = BODY_TOP;
      onNewPage?.();
    },
    pages,
  };
  return builder;
}

const centred = (y, value, options) => text(PAGE_WIDTH / 2, y, value, { align: "center", ...options });

// Boxed "form" lines: label on the right, amount on the left; the last line is the emphasised result.
function formBox(builder, rows) {
  const [x, width, rowHeight] = [170, 900, 70];
  builder.add(rect(x, builder.y, width, rowHeight * rows.length));
  rows.forEach(([label, value], index) => {
    const y = builder.y + index * rowHeight;
    const last = index === rows.length - 1;
    if (index) builder.add(line(x, x + width, y, 1));
    builder.add(text(x + width - 24, y + 45, label, { size: 24, bold: last }));
    builder.add(text(x + 24, y + 47, value, { size: 30, bold: true, align: "left", color: "#1d3fb8" }));
  });
  builder.y += rowHeight * rows.length + 50;
}

// Colours of the periodic VAT slip as Rivhit prints it: the brown-red ink of the paper form, its yellow fields, the
// blue figures.
const SLIP = { ink: "#8a2c1c", field: "#fff27a", paper: "#fffdf3", blank: "#fff", figure: "#1d3fb8" };

// The periodic VAT slip, drawn by the app in the places of the paper form (never Rivhit's picture of it); the figures
// are the lines of reports.js. The exempt and zero-rate box stays empty: the app does not tell those sales apart.
function vatSlip(builder, report, { clientName, address, vatId, from, to }) {
  const [frameTop, frameBottom] = [310, 905];
  const label = (x, y, value, options = {}) => builder.add(text(x, y, value, { size: 15, color: SLIP.ink, ...options }));
  const rule = (x1, x2, y) => builder.add({ ...line(x1, x2, y, 1), color: SLIP.ink });
  // A box of the form: yellow when it carries a figure of the return, white otherwise; the value sits on its right.
  const box = (x1, x2, y, height, value = "", { fill = SLIP.field, size = 30, lineWidth = 1.5 } = {}) => {
    builder.add(rect(x1, y, x2 - x1, height, { fill, color: SLIP.ink, lineWidth }));
    if (value === "") return;
    const options = { size, bold: true, color: SLIP.figure, maxWidth: x2 - x1 - 30 };
    builder.add(text(x2 - 15, y + height / 2 + size * 0.36, value, options));
  };
  const frame = { fill: SLIP.paper, color: SLIP.ink, lineWidth: 2.5 };
  builder.add(rect(LEFT, frameTop, RIGHT - LEFT, frameBottom - frameTop, frame));
  label(RIGHT - 20, 352, "מדינת ישראל אגף המכס ומס ערך מוסף", { size: 25, bold: true });
  label(560, 352, "דו״ח תקופתי", { size: 23, bold: true, align: "center" });
  label(LEFT + 20, 352, "הודעת זיכוי – לתשלום", { size: 21, bold: true, underline: true, align: "left" });
  rule(LEFT, RIGHT, 368);
  // Who and when.
  label(1150, 392, "שם העוסק");
  box(760, 1150, 398, 42, clientName, { fill: SLIP.blank, size: 24 });
  label(740, 392, "מען");
  box(380, 740, 398, 42, address ?? "", { fill: SLIP.blank, size: 22 });
  label(360, 392, "ס. ישוב");
  box(230, 360, 398, 42, "", { fill: SLIP.blank });
  label(210, 392, "מיקוד");
  box(90, 210, 398, 42, "", { fill: SLIP.blank });
  box(760, 1150, 458, 46, periodWords(from, to), { size: 26 });
  label(1150, 527, "התקופה שלגביה חלה חובת הדיווח");
  label(740, 474, "יש להגיש הדו״ח עד");
  box(380, 590, 458, 46, "", { fill: SLIP.blank });
  box(90, 360, 458, 46, formatVatId(vatId), { size: 26 });
  label(360, 527, "מספר תיק העוסק");
  rule(LEFT, RIGHT, 545);
  // The return: sales and their tax, the input tax, the result. A zero leaves its box empty, as Rivhit does.
  const figure = (value) => (value ? formatAmount(value) : "");
  label(1150, 572, "המס על העסקאות");
  box(860, 1150, 580, 50, figure(report.outputVat));
  label(790, 572, "עסקאות חייבות (ללא מע״מ)");
  box(480, 790, 580, 50, figure(report.turnover));
  rule(790, 840, 605);
  builder.add(text(836, 612, "►", { size: 20, color: SLIP.ink, align: "left" }));
  label(420, 572, "עסקאות פטורות או בשיעור אפס");
  box(90, 420, 580, 50, "", { fill: SLIP.blank });
  label(1150, 662, "מס תשומות על ציוד ונכסים קבועים");
  box(860, 1150, 670, 46, figure(report.equipmentVat));
  label(1150, 742, "המס על תשומות אחרות");
  box(860, 1150, 750, 46, figure(report.inputVat));
  box(860, 1150, 812, 58, formatAmount(Math.abs(report.payable)), { size: 36, lineWidth: 3.5 });
  const result = report.payable >= 0 ? "הסכום לתשלום בשקלים חדשים" : "הסכום להחזר בשקלים חדשים";
  label(1150, 893, result, { size: 17, bold: true });
  // The rest of the paper form, empty as in Rivhit.
  box(130, 380, 660, 50, "", { fill: SLIP.blank, lineWidth: 2.5 });
  label(255, 694, "בשקלים שלמים", { size: 24, bold: true, align: "center" });
  label(790, 694, "הצהרת העוסק וחתימתו", { size: 19, bold: true });
  label(790, 762, "שם החותם");
  rule(480, 705, 764);
  label(790, 818, "חתימת העוסק או בא כוחו");
  rule(480, 620, 820);
  label(790, 868, "תאריך");
  rule(480, 735, 870);
  box(90, 380, 740, 145, "", { fill: SLIP.blank });
  label(235, 775, "חותמת הבנק", { size: 19, bold: true, align: "center" });
  builder.y = frameBottom;
}

function layoutVat(report, info) {
  const builder = pageBuilder();
  if (report.openCount) builder.add(text(RIGHT, 285, `קיימות ${report.openCount} תנועות לא מעודכנות`, { bold: true, underline: true }));
  builder.add(text(700, 285, "שיעור מע״מ עסקאות =", { size: 23, bold: true }));
  builder.add(text(482, 285, `${report.vatRate.toFixed(4)}%`, { size: 23, bold: true, color: SLIP.figure }));
  vatSlip(builder, report, info);
  builder.add(centred(builder.y + 55, FOOTER_TEXT, { bold: true, underline: true }));
  return { title: "דוח מס ערך מוסף", subtitle: "", pages: builder.pages };
}

function layoutAdvances(report, { from, to }) {
  const builder = pageBuilder();
  builder.add(centred(320, `אחוז מקדמות מהמחזור = ${report.percent}%`, { size: 25, bold: true }));
  builder.y = 370;
  formBox(builder, [
    ["מחזור עסקאות (ללא מע״מ)", formatAmount(report.turnover)],
    [`מקדמה (${report.percent}% מהמחזור)`, formatAmount(report.advance)],
    ["ניכויים", formatAmount(report.deductions)],
    ["סה״כ לתשלום", formatAmount(report.total)],
  ]);
  builder.add(centred(builder.y + 20, FOOTER_TEXT, { bold: true, underline: true }));
  return { title: "דוח מקדמות ע״פ מחזור", subtitle: from === to ? `תקופה: ${from}` : `לתקופה: ${from} – ${to}`, pages: builder.pages };
}

function layoutProfitLoss(report, { from, to }) {
  const builder = pageBuilder();
  const [nameX, amountX, percentX, rowHeight] = [1065, 680, 525, 38];
  builder.add(text(amountX, BODY_TOP, "שקלים חדשים", { bold: true, underline: true }));
  builder.add(text(percentX, BODY_TOP, "% מהמכירות", { bold: true, underline: true }));
  builder.y = BODY_TOP + 55;
  const pct = (value) => `${value.toFixed(2)}%`;
  const group = (title) => {
    builder.ensure(rowHeight * 3);
    builder.add(text(nameX, builder.y, title, { bold: true, underline: true }));
    builder.y += rowHeight + 10;
  };
  const row = (name, amount, percent) => {
    builder.ensure(rowHeight);
    builder.add(text(nameX, builder.y, name), text(amountX, builder.y, formatAmount(amount)), text(percentX, builder.y, pct(percent)));
    builder.y += rowHeight;
  };
  const total = (label, amount, percent, double = false) => {
    builder.ensure(rowHeight * 2);
    builder.add(line(amountX - 110, amountX, builder.y - 26, 1), line(percentX - 110, percentX, builder.y - 26, 1));
    builder.add(text(nameX, builder.y + 8, label, { bold: true, underline: true }));
    builder.add(text(amountX, builder.y + 8, formatAmount(amount)), text(percentX, builder.y + 8, pct(percent)));
    if (double) builder.add(...doubleLine(amountX - 110, amountX, builder.y + 22), ...doubleLine(percentX - 110, percentX, builder.y + 22));
    builder.y += rowHeight + 36;
  };
  group("הכנסות");
  for (const item of report.income) row(item.name, item.amount, item.percent);
  total("סה״כ הכנסות:", report.incomeTotal, report.incomeTotal ? 100 : 0);
  group("הוצאות הנהלה וכלליות");
  for (const item of report.expenses) row(item.name, -item.amount, item.percent);
  total("סה״כ הוצאות הנהלה וכלליות:", -report.expenseTotal, report.expensePercent);
  total("רווח לתקופה:", report.profit, report.profitPercent, true);
  return { title: "דוח רווח והפסד", subtitle: `לתקופה ${from} – ${to}`, note: "ללא מס ערך מוסף", pages: builder.pages };
}

const LEDGER_COLUMNS = { month: 1170, date: 1060, details: 950, reference: 640, gross: 525, net: 405, vat: 285, status: 180 };

function layoutLedger(ledger, { from, to }, statusLabel = (status) => (status === "closed" ? "" : "טיוטא")) {
  const builder = pageBuilder();
  const rowHeight = 30;
  const columnHeads = [["month", "חודש"], ["date", "תאריך"], ["details", "פרטים"], ["reference", "אסמכתא"], ["gross", "כולל מע״מ"], ["net", "ללא מע״מ"], ["vat", "מע״מ"]];
  let sectionTitle = "";
  let account = null;
  const drawSection = () => {
    builder.add(text(PAGE_WIDTH / 2 - 330, builder.y, sectionTitle, { size: 27, bold: true, underline: true, align: "center" }));
    builder.y += 60;
  };
  const drawAccount = () => {
    builder.add(text(RIGHT, builder.y, `קוד מס': ${account.code}`, { size: 28, bold: true, underline: true }));
    builder.add(text(RIGHT, builder.y + 42, account.name, { size: 28, bold: true, underline: true }));
    builder.y += 100;
    for (const [column, head] of columnHeads) builder.add(text(LEDGER_COLUMNS[column], builder.y, head, { size: 18, bold: true }));
    builder.add(line(LEFT + 80, RIGHT, builder.y + 10, 2));
    builder.y += 44;
  };
  const continuation = () => {
    drawSection();
    drawAccount();
  };
  const totals = (label, gross, net, vat, labelX, bold = true) => {
    builder.add(text(labelX, builder.y, label, { size: 17, bold }));
    for (const [column, value] of [["gross", gross], ["net", net], ["vat", vat]]) builder.add(text(LEDGER_COLUMNS[column], builder.y, money(value), { size: 17, bold: true }));
    builder.add(...doubleLine(LEDGER_COLUMNS.gross - 118, LEDGER_COLUMNS.gross, builder.y + 12), ...doubleLine(LEDGER_COLUMNS.net - 118, LEDGER_COLUMNS.net, builder.y + 12), ...doubleLine(LEDGER_COLUMNS.vat - 118, LEDGER_COLUMNS.vat, builder.y + 12));
  };
  for (const section of ledger.sections) {
    sectionTitle = section.title;
    builder.ensure(300);
    drawSection();
    for (const current of section.accounts) {
      account = current;
      builder.ensure(260, drawSection);
      drawAccount();
      for (const item of account.rows) {
        builder.ensure(rowHeight + 10, continuation);
        const cells = [["month", item.monthName], ["date", item.date], ["details", item.details], ["reference", item.reference], ["gross", money(item.gross)], ["net", money(item.net)], ["vat", money(item.vat)]];
        for (const [column, value] of cells) {
          const max = column === "details" ? 300 : column === "reference" ? 100 : undefined;
          builder.add(text(LEDGER_COLUMNS[column], builder.y, value, { size: 18, maxWidth: max }));
        }
        const status = statusLabel(item.status);
        if (status) builder.add(text(LEDGER_COLUMNS.status, builder.y, status, { size: 17, bold: true }));
        builder.y += rowHeight;
      }
      builder.add(line(LEFT + 80, RIGHT, builder.y - 20, 1));
      builder.y += 18;
      builder.ensure(70, continuation);
      totals(`סה״כ ${account.name}:`, account.gross, account.net, account.vat, LEDGER_COLUMNS.details);
      builder.y += 60;
    }
    builder.ensure(70, drawSection);
    totals(`סה״כ ${section.title}:`, section.gross, section.net, section.vat, LEDGER_COLUMNS.details);
    builder.y += 70;
  }
  builder.ensure(70);
  totals("סה״כ לדוח:", ledger.gross, ledger.net, ledger.vat, LEDGER_COLUMNS.details);
  return { title: "כרטסת קודי מיון", subtitle: `לתקופה: ${from} – ${to}`, pages: builder.pages };
}

const LAYOUTS = { vat: layoutVat, advances: layoutAdvances, profitLoss: layoutProfitLoss, ledger: layoutLedger };

// kind: "vat" | "advances" | "profitLoss" | "ledger"; data: the matching result of reports.js;
// info: { clientName, from, to, vatId?, address? } with months as MM/YYYY. Returns one operation list per page.
// The top line is Rivhit's: the name on the right, the VAT dealer number in the middle, the address on the left.
export function layoutReport(kind, data, info, now = new Date()) {
  const { title, subtitle, note, pages } = LAYOUTS[kind](data, info);
  const stamp = formatStamp(now);
  const business = [
    ...(info.vatId ? [centred(62, `עוסק מורשה: ${formatVatId(info.vatId)}`, { size: 21, bold: true })] : []),
    ...(info.address ? [text(LEFT, 62, info.address, { size: 21, bold: true, align: "left", maxWidth: 380 })] : []),
  ];
  return pages.map((body, index) => [
    text(RIGHT, 62, info.clientName, { size: 23, bold: true, maxWidth: 380 }),
    ...business,
    line(LEFT, RIGHT, 90, 1),
    text(LEFT, 130, `תאריך - ${stamp}`, { size: 17, align: "left" }),
    text(LEFT, 158, `דף ${index + 1} מתוך ${pages.length}`, { size: 17, align: "left" }),
    ...(note ? [text(LEFT, 190, note, { size: 17, align: "left", underline: true })] : []),
    centred(150, title, { size: 42, bold: true, underline: true }),
    centred(215, subtitle, { size: 22, bold: true, underline: true }),
    line(LEFT, RIGHT, 245, 1),
    ...body,
  ]);
}

const HEBREW = /[֐-׿]/;

function drawPage(operations) {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_WIDTH * RENDER_SCALE;
  canvas.height = PAGE_HEIGHT * RENDER_SCALE;
  const context = canvas.getContext("2d");
  context.scale(RENDER_SCALE, RENDER_SCALE);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  context.textBaseline = "alphabetic";
  for (const op of operations) {
    context.fillStyle = context.strokeStyle = op.color ?? "#000";
    if (op.type === "line") {
      context.lineWidth = op.width;
      context.beginPath();
      context.moveTo(op.x1, op.y);
      context.lineTo(op.x2, op.y);
      context.stroke();
    } else if (op.type === "rect") {
      if (op.fill) {
        context.fillStyle = op.fill;
        context.fillRect(op.x, op.y, op.width, op.height);
      }
      context.lineWidth = op.lineWidth ?? 2;
      context.strokeRect(op.x, op.y, op.width, op.height);
    } else {
      context.font = `${op.bold ? "bold " : ""}${op.size}px Arial`;
      context.direction = HEBREW.test(op.text) ? "rtl" : "ltr";
      context.textAlign = op.align;
      if (op.maxWidth) context.fillText(op.text, op.x, op.y, op.maxWidth);
      else context.fillText(op.text, op.x, op.y);
      if (op.underline) {
        const width = Math.min(context.measureText(op.text).width, op.maxWidth ?? Infinity);
        const start = op.align === "right" ? op.x - width : op.align === "center" ? op.x - width / 2 : op.x;
        context.lineWidth = Math.max(1.5, op.size / 14);
        context.beginPath();
        context.moveTo(start, op.y + 5);
        context.lineTo(start + width, op.y + 5);
        context.stroke();
      }
    }
  }
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("לא ניתן ליצור תמונת PDF."))), "image/jpeg", 0.92));
}

// Resolves to { pdf: Blob, images: Blob[] }; the images are the same pages as JPEG, for the on-screen viewer.
export async function renderReportPdf(pages) {
  const images = [];
  for (const operations of pages) images.push(await drawPage(operations));
  const jpegs = await Promise.all(images.map(async (image) => new Uint8Array(await image.arrayBuffer())));
  const pdf = new Blob([jpegPagesToPdf(jpegs, PAGE_WIDTH * RENDER_SCALE, PAGE_HEIGHT * RENDER_SCALE, PAGE_WIDTH, PAGE_HEIGHT)], { type: "application/pdf" });
  return { pdf, images };
}
