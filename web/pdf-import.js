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
