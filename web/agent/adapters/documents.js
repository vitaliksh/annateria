// Reads what is inside an inbox file without the vision model (backend of read_document): size of a photo, pages and the text
// layer of a PDF, the first rows of a CSV or workbook. pdf.js and SheetJS are loaded on demand, as in the rest of the app.
import { loadPdfJs } from "../../pdf-import.js";
import { kindOf } from "../kinds.js";

const XLSX_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs"; // the same copy that excel-journal-reader.js loads
const SHEET_ROWS = 40;
const MAX_SHEETS = 5;

export class DocumentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DocumentError";
    this.code = code; // page_out_of_range | unreadable
  }
}

async function browserImageSize(file) {
  const bitmap = await createImageBitmap(file);
  try { return { width: bitmap.width, height: bitmap.height }; } finally { bitmap.close?.(); }
}

const lines = (text, count) => text.split(/\r?\n/).filter((line) => line.trim() !== "").slice(0, count).join("\n");

export function createDocumentReader({ loadPdf = loadPdfJs, loadXlsx = () => import(XLSX_URL), imageSize = browserImageSize } = {}) {
  async function pdf(file, { page, maxChars }) {
    const library = await loadPdf();
    const document = await library.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    try {
      const pages = document.numPages;
      if (page !== undefined && (page < 1 || page > pages)) throw new DocumentError("page_out_of_range", `The file has ${pages} pages.`);
      let text = "";
      for (const number of page !== undefined ? [page] : Array.from({ length: pages }, (_, index) => index + 1)) {
        const content = await (await document.getPage(number)).getTextContent();
        const pageText = content.items.map((item) => item.str + (item.hasEOL ? "\n" : " ")).join("").trim();
        if (pageText) text += (page === undefined ? `\n--- page ${number} ---\n` : "") + pageText;
        if (text.length > maxChars) break;
      }
      return { kind: "pdf", pages, ...(text.trim() ? { text: text.trim() } : {}) };
    } finally {
      await document.destroy?.();
    }
  }

  async function spreadsheet(file, entry) {
    if (entry.storedName.toLowerCase().endsWith(".csv")) {
      const text = new TextDecoder().decode(await file.arrayBuffer());
      return { kind: "spreadsheet", sheets: [{ name: "csv", rows: text.split(/\r?\n/).filter((line) => line.trim() !== "").length, text: lines(text, SHEET_ROWS) }] };
    }
    const XLSX = await loadXlsx();
    const bytes = new Uint8Array(await file.arrayBuffer());
    // SheetJS parses any bytes as text, so insist on the signature of a real workbook first: ZIP (.xlsx) or OLE (.xls).
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
    let workbook;
    try {
      if (!isZip && !isOle) throw new Error("not a workbook");
      workbook = XLSX.read(bytes, { type: "array" });
    } catch {
      throw new DocumentError("unreadable", "The workbook could not be read.");
    }
    const sheets = workbook.SheetNames.slice(0, MAX_SHEETS).map((name) => {
      const sheet = workbook.Sheets[name];
      const rows = sheet?.["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]).e.r + 1 : 0;
      return { name, rows, text: sheet ? lines(XLSX.utils.sheet_to_csv(sheet), SHEET_ROWS) : "" };
    });
    return { kind: "spreadsheet", sheets };
  }

  return {
    // file: a File of the inbox, entry: its index entry. Returns { kind, ... } with at most about maxChars of text.
    async inspect(file, entry, { page, maxChars = 6000 } = {}) {
      const kind = kindOf(entry);
      if (kind === "pdf") return pdf(file, { page, maxChars });
      if (kind === "spreadsheet") return spreadsheet(file, entry);
      if (kind === "image") {
        const size = await imageSize(file).catch(() => null);
        return { kind, ...(size ?? {}) };
      }
      return { kind };
    },
  };
}
