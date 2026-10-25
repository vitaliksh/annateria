// The documents report ("PDF מסכם"): one page per active row of the period, the original of the row above the fields the
// table holds for it. For a PDF original the page is the one the agent read the row from. Ported from ocr
// (telegram-web/pdf-report.js, buildPdfReport); removed here on 17 October 2026 as unused, brought back on 25 October 2026 at
// the owner's request as a kind of the reports page.
import { getDeclarationDirectory, readSourceImage } from "./declaration-store.js";
import { jpegPagesToPdf } from "./document-package.js";
import { loadPdfJs } from "./pdf-import.js";

const PAGE_WIDTH = 1240, PAGE_HEIGHT = 1754, RENDER_SCALE = 2, MARGIN = 70;
// [label, index in row.values], two per line: right column first.
export const DOCUMENT_FIELDS = [
  ["תאריך", 0], ["ספק", 3], ["מס׳ מסמך", 5], ["כולל מע״מ", 7], ["מע״מ", 9], ["פרטים", 2],
  ["קוד מיון", 1], ["ע.מ./ת.ז", 4], ["מספר הקצאה", 6], ["ללא מע״מ", 8], ["% מוכר מע״מ", 10], ["% מוכר כהוצאה", 11],
];

// The active rows of the declarations whose month is in [fromIso, toIso], month by month in table order:
// [{ month, position, row }] where position is the number of the row in its table (1-based).
export function documentReportItems(declarations, fromIso, toIso) {
  return declarations
    .filter((declaration) => declaration.month >= fromIso && declaration.month <= toIso)
    .sort((a, b) => a.month.localeCompare(b.month))
    .flatMap((declaration) => declaration.rows.map((row, index) => ({ month: declaration.month, position: index + 1, row })))
    .filter((item) => item.row.active);
}

// [[label, text]] of a row in the order of DOCUMENT_FIELDS. The table shows the last four digits of a reference; the report
// shows the full one. accounts: { code: { name } } adds the name of the account to its code.
export function documentFieldValues(row, accounts = {}) {
  return DOCUMENT_FIELDS.map(([label, index]) => {
    let value = String(row.values?.[index] ?? "").trim();
    if (index === 5 && row.reference) value = String(row.reference);
    if (index === 1 && value && accounts[value]?.name) value = `${value} · ${accounts[value].name}`;
    return [label, value || "—"];
  });
}

// The original of a row as a Blob, or null when the row has none or its file is gone.
export async function readRowOriginal(clientDirectory, month, row) {
  if (!row.imageFile) return null;
  try {
    return await readSourceImage(await getDeclarationDirectory(clientDirectory, month), row.imageFile);
  } catch (error) {
    if (error.name === "NotFoundError") return null;
    throw error;
  }
}

const isPdf = (blob, name) => blob.type === "application/pdf" || /\.pdf$/i.test(name || "");

// Draws originals: a photo as it is, a PDF page through pdf.js. A PDF is opened once for all its rows.
function createOriginalDrawer(loadPdf = loadPdfJs) {
  const pdfs = new Map();
  return async (blob, name, page) => {
    if (!isPdf(blob, name)) return createImageBitmap(blob);
    if (!pdfs.has(name)) {
      const pdfjs = await loadPdf();
      pdfs.set(name, pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise);
    }
    const pdf = await pdfs.get(name);
    const pdfPage = await pdf.getPage(Math.min(Math.max(1, Number(page) || 1), pdf.numPages));
    const viewport = pdfPage.getViewport({ scale: 1 });
    const scaled = pdfPage.getViewport({ scale: Math.min(3, 2200 / viewport.width) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(scaled.width);
    canvas.height = Math.round(scaled.height);
    await pdfPage.render({ canvasContext: canvas.getContext("2d"), viewport: scaled }).promise;
    return canvas;
  };
}

function makeCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_WIDTH * RENDER_SCALE;
  canvas.height = PAGE_HEIGHT * RENDER_SCALE;
  const context = canvas.getContext("2d");
  context.scale(RENDER_SCALE, RENDER_SCALE);
  context.fillStyle = "white";
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  return { canvas, context };
}

const canvasJpeg = (canvas) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("לא ניתן ליצור תמונת PDF."))), "image/jpeg", 0.92);
});

function drawText(context, text, x, y, font = "18px Arial", color = "#172033", align = "right") {
  context.fillStyle = color;
  context.font = font;
  context.direction = "rtl";
  context.textAlign = align;
  context.textBaseline = "middle";
  context.fillText(text, x, y);
}

function fitText(context, text, width) {
  const value = String(text ?? "—");
  if (context.measureText(value).width <= width) return value;
  let end = value.length;
  while (end && context.measureText(`${value.slice(0, end)}…`).width > width) end -= 1;
  return `${value.slice(0, end)}…`;
}

function drawField(context, label, value, x, y, width) {
  context.direction = "rtl";
  context.textAlign = "right";
  context.textBaseline = "middle";
  context.font = "bold 16px Arial";
  context.fillStyle = "#365466";
  context.fillText(`${label}:`, x + width, y);
  const labelWidth = context.measureText(`${label}:`).width + 12;
  context.font = "16px Arial";
  context.fillStyle = "#172033";
  context.fillText(fitText(context, value, width - labelWidth), x + width - labelWidth, y);
}

// The original fitted into the box; returns where it was drawn (for the marks of old ocr rows).
function drawContained(context, image, x, y, width, height) {
  const scale = Math.min(width / image.width, height / image.height);
  const box = { width: image.width * scale, height: image.height * scale };
  Object.assign(box, { x: x + (width - box.width) / 2, y: y + (height - box.height) / 2 });
  context.drawImage(image, box.x, box.y, box.width, box.height);
  return box;
}

// Rows recognised in ocr carry the boxes Gemini returned (0..1000): yellow for the document, green for amounts.
function drawHighlights(context, regions, box) {
  for (const region of regions || []) {
    const [top, left, bottom, right] = region.box_2d || [];
    if (![top, left, bottom, right].every(Number.isFinite) || top >= bottom || left >= right) continue;
    const amount = ["total_amount", "vat_amount"].includes(region.field);
    context.fillStyle = amount ? "rgba(64, 185, 90, 0.42)" : "rgba(255, 232, 77, 0.48)";
    context.fillRect(box.x + (left / 1000) * box.width, box.y + (top / 1000) * box.height,
      ((right - left) / 1000) * box.width, ((bottom - top) / 1000) * box.height);
  }
}

// items: documentReportItems(); readOriginal(item) -> Blob | null. Resolves with { pdf, images } like renderReportPdf.
export async function renderDocumentReport({ clientName, items, readOriginal, accounts = {}, now = new Date(), loadPdf }) {
  if (!items.length) throw new Error("אין מסמכים פעילים בתקופה שנבחרה.");
  const drawOriginal = createOriginalDrawer(loadPdf);
  const stamp = new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(now);
  const images = [];
  for (const [index, { month, position, row }] of items.entries()) {
    const { canvas, context } = makeCanvas();
    const [year, monthNumber] = month.split("-");
    drawText(context, "PDF מסכם", PAGE_WIDTH - MARGIN, 68, "bold 29px Arial");
    drawText(context, `לקוח: ${clientName} · חודש ${monthNumber}/${year} · שורה ${position} · דף ${index + 1}/${items.length}`,
      PAGE_WIDTH - MARGIN, 104, "17px Arial", "#365466");
    const frame = { x: MARGIN, y: 140, width: PAGE_WIDTH - MARGIN * 2, height: 1130 };
    context.fillStyle = "#f4f7fa";
    context.fillRect(frame.x, frame.y, frame.width, frame.height);
    context.strokeStyle = "#9aa8b2";
    context.lineWidth = 2;
    context.strokeRect(frame.x, frame.y, frame.width, frame.height);
    const blob = await readOriginal({ month, position, row });
    let problem = blob ? "" : "לשורה זו אין מקור.";
    if (blob) {
      try {
        const image = await drawOriginal(blob, `${month}/${row.imageFile}`, row.agent?.page);
        const box = drawContained(context, image, frame.x, frame.y, frame.width, frame.height);
        image.close?.();
        drawHighlights(context, row.highlights, box);
      } catch {
        problem = `לא ניתן להציג את המקור (${row.imageFile}).`;
      }
    }
    if (problem) drawText(context, problem, PAGE_WIDTH / 2, frame.y + frame.height / 2, "22px Arial", "#8a3b12", "center");
    context.strokeStyle = "#ccd7de";
    context.beginPath();
    context.moveTo(MARGIN, 1300);
    context.lineTo(PAGE_WIDTH - MARGIN, 1300);
    context.stroke();
    drawText(context, "פענוח", PAGE_WIDTH - MARGIN, 1334, "bold 21px Arial");
    const fields = documentFieldValues(row, accounts);
    const half = PAGE_WIDTH / 2 - MARGIN - 12;
    for (let at = 0, y = 1370; at < fields.length; at += 2, y += 45) {
      drawField(context, ...fields[at], PAGE_WIDTH / 2 + 12, y, half);
      if (fields[at + 1]) drawField(context, ...fields[at + 1], MARGIN, y, half);
    }
    drawText(context, `נוצר: ${stamp}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 38, "14px Arial", "#526074");
    images.push(await canvasJpeg(canvas));
  }
  const jpegs = await Promise.all(images.map(async (image) => new Uint8Array(await image.arrayBuffer())));
  const pdf = jpegPagesToPdf(jpegs, PAGE_WIDTH * RENDER_SCALE, PAGE_HEIGHT * RENDER_SCALE, PAGE_WIDTH, PAGE_HEIGHT);
  return { pdf: new Blob([pdf], { type: "application/pdf" }), images };
}
