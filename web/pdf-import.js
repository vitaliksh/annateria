const PDF_JS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDF_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
const MAX_PDF_BYTES = 50 * 1024 * 1024;

export function validatePdfFile(file) {
  if (!file) throw new Error("לא נבחר קובץ PDF.");
  if (file.size <= 0) throw new Error("קובץ ה‑PDF ריק.");
  if (file.size > MAX_PDF_BYTES) throw new Error("קובץ ה‑PDF גדול מ‑50MB.");
  if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) throw new Error("יש לבחור קובץ PDF.");
}

export function pdfSourceFileName(now = new Date(), random = crypto.randomUUID()) {
  return `source-${now.toISOString().replace(/[:.]/g, "-")}-${random}.pdf`;
}

export async function loadPdfJs() {
  const pdfjs = await import(PDF_JS_URL);
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
  return pdfjs;
}

async function canvasJpeg(canvas) {
  for (const quality of [0.94, 0.85, 0.75, 0.65]) { const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality)); if (blob && blob.size <= 11 * 1024 * 1024) return blob; }
  throw new Error("עמוד ה‑PDF גדול מדי לעיבוד. יש להקטין או לפצל את הקובץ.");
}

// One page at a time keeps the existing image-only Gemini route and 12 MB limit.
export async function renderPdfPages(file, { onPage, shouldStop = () => false } = {}) {
  validatePdfFile(file);
  const pdfjs = await loadPdfJs(), document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (shouldStop()) break;
      const page = await document.getPage(pageNumber), base = page.getViewport({ scale: 1 });
      // About 215 dpi for an A4 page (it was 144): small print of receipts and invoices stays legible for the eye and for OCR.
      const scale = Math.min(3, 3000 / Math.max(base.width, base.height)), viewport = page.getViewport({ scale });
      const canvas = window.document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false }); context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport, background: "white" }).promise;
      const image = await canvasJpeg(canvas); canvas.width = 1; canvas.height = 1;
      await onPage?.({ pageNumber, pageCount: document.numPages, image });
    }
  } finally { await document.destroy(); }
}
