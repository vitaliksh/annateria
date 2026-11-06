// A PDF above the limit of one request to the model (a scan of many pages), made small enough to send: its pages are drawn as JPEG and put
// into a new PDF, at falling quality; if that is still too much, the pages go into several parts in their order. Only for the request: the
// original is what is filed. A document that crosses two parts may come back as two records; both become rows, and Anna sees them.
import { jpegPagesToPdf } from "../../document-package.js";
import { loadPdfJs } from "../../pdf-import.js";

const LONG_EDGE = 2200; // pixels, as the documents report draws a page
const QUALITIES = [0.85, 0.7, 0.55];
const PAGE_OVERHEAD = 1024; // what the PDF itself takes per page, generously

// The pages of the file as [{ jpeg, width, height, pageWidth, pageHeight }]; the sizes of a page may differ.
async function browserRenderPages(file, quality) {
  const library = await loadPdfJs();
  const pdf = await library.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: LONG_EDGE / Math.max(natural.width, natural.height) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      // "print": the default intent waits for animation frames, and a tab that is not on screen gets none, so the run would stall.
      await page.render({ canvasContext: canvas.getContext("2d"), viewport, intent: "print" }).promise;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      pages.push({
        jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height,
        pageWidth: natural.width, pageHeight: natural.height,
      });
      canvas.width = canvas.height = 0; // a page of this size holds tens of megabytes until it is collected
      page.cleanup?.();
    }
    return pages;
  } finally {
    await pdf.destroy?.();
  }
}

const weight = (page) => page.jpeg.length + PAGE_OVERHEAD;
const totalWeight = (pages) => pages.reduce((total, page) => total + weight(page), 0);

// Resolves with [{ firstPage, bytes }] in the order of the pages, each part within maxBytes, or null when a single page is above it.
export async function shrinkPdf(file, maxBytes, { renderPages = browserRenderPages } = {}) {
  let pages = [];
  for (const quality of QUALITIES) {
    pages = await renderPages(file, quality);
    if (totalWeight(pages) <= maxBytes) break;
  }
  if (pages.some((page) => weight(page) > maxBytes)) return null;
  const groups = [];
  let group = null;
  pages.forEach((page, index) => {
    if (!group || totalWeight(group.pages) + weight(page) > maxBytes) groups.push(group = { firstPage: index + 1, pages: [] });
    group.pages.push(page);
  });
  return groups.map(({ firstPage, pages: part }) => ({
    firstPage,
    bytes: jpegPagesToPdf(part.map((page) => page.jpeg), 0, 0, 0, 0, part),
  }));
}
