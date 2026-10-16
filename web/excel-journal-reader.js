// Reads a Rivhit journal .xlsx into a plain grid for parseJournalGrid; SheetJS is loaded on demand.
const XLSX_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
const DATA_SHEET = "גיליון2";
const MAX_XLSX_BYTES = 5 * 1024 * 1024;

export function validateExcelFile(file) {
  if (!file) throw new Error("לא נבחר קובץ Excel.");
  if (file.size <= 0) throw new Error("קובץ ה‑Excel ריק.");
  if (file.size > MAX_XLSX_BYTES) throw new Error("קובץ ה‑Excel גדול מ‑5MB.");
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("יש לבחור קובץ ‎.xlsx.");
}

const loadXlsx = () => import(XLSX_URL);

function pickSheet(XLSX, workbook) {
  const filled = workbook.SheetNames.filter((name) => workbook.Sheets[name]?.["!ref"]);
  const name = filled.includes(DATA_SHEET) ? DATA_SHEET : filled.length === 1 ? filled[0] : null;
  if (!name) throw new Error("לא נמצא גיליון נתונים בקובץ.");
  const sheet = workbook.Sheets[name];
  // Anchor the range at A1 so grid indexes match the Excel columns used by the parser.
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  sheet["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: range.e });
  return sheet;
}

// Dates stay Excel serial numbers (no cellDates), which parseJournalGrid accepts; empty cells become "".
export async function readJournalGrid(file, { loadLibrary = loadXlsx } = {}) {
  validateExcelFile(file);
  const XLSX = await loadLibrary();
  const bytes = new Uint8Array(await file.arrayBuffer());
  let workbook;
  try {
    // SheetJS parses any bytes as text, so insist on the ZIP signature of a real .xlsx first.
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("not a zip");
    workbook = XLSX.read(bytes, { type: "array" });
  } catch {
    throw new Error("לא ניתן לקרוא את קובץ ה‑Excel.");
  }
  return XLSX.utils.sheet_to_json(pickSheet(XLSX, workbook), { header: 1, raw: true, defval: "", blankrows: true });
}
