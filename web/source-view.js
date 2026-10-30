// The original of an imported row: the Excel journal kept in clients/<client>/imports/ after the wizard wrote its rows. A row keeps
// the SHA-256 of that file (sourceHash), so a renamed copy ("8 (2) (2).xlsx") is still found. The browser cannot show a spreadsheet,
// so it is drawn as a plain table (text only, never HTML from the file). SheetJS is loaded on demand, the same copy as the wizard's.
import { sha256Hex } from "./inbox-store.js";

const XLSX_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";

// Resolves with the File in imports/ whose bytes have this hash, or null.
export async function findImportFile(clientDirectory, hash) {
  let imports;
  try {
    imports = await clientDirectory.getDirectoryHandle("imports");
  } catch (error) {
    if (error.name === "NotFoundError") return null;
    throw error;
  }
  for await (const [, handle] of imports.entries()) {
    if (handle.kind !== "file") continue;
    const file = await handle.getFile();
    if ((await sha256Hex(new Uint8Array(await file.arrayBuffer()))) === hash) return file;
  }
  return null;
}

// Every sheet that holds something, as rows of the texts Excel shows; empty rows are left out.
export async function sheetTexts(file, { loadLibrary = () => import(XLSX_URL) } = {}) {
  const XLSX = await loadLibrary();
  const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
  return workbook.SheetNames.filter((name) => workbook.Sheets[name]?.["!ref"]).map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: false, defval: "" })
      .map((cells) => cells.map((cell) => String(cell ?? "")))
      .filter((cells) => cells.some((cell) => cell.trim())),
  }));
}

// Draws the sheets into the document of a window, right to left.
export function renderSheets(doc, title, sheets) {
  doc.title = title;
  doc.documentElement.dir = "rtl";
  doc.body.style.cssText = "margin:0;padding:12px;font:13px Arial;background:#fff;color:#111";
  const heading = doc.createElement("h1");
  heading.style.cssText = "font-size:16px;margin:0 0 10px";
  heading.textContent = title;
  doc.body.replaceChildren(heading);
  for (const sheet of sheets) {
    const table = doc.createElement("table");
    table.style.cssText = "border-collapse:collapse;margin-bottom:16px";
    const width = Math.max(0, ...sheet.rows.map((cells) => cells.length));
    for (const cells of sheet.rows) {
      const tr = doc.createElement("tr");
      for (let index = 0; index < width; index += 1) {
        const td = doc.createElement("td");
        td.style.cssText = "border:1px solid #ccc;padding:2px 6px;white-space:nowrap";
        td.textContent = cells[index] ?? "";
        tr.append(td);
      }
      table.append(tr);
    }
    if (sheets.length > 1) {
      const name = doc.createElement("h2");
      name.style.cssText = "font-size:14px;margin:8px 0 4px";
      name.textContent = sheet.name;
      doc.body.append(name);
    }
    doc.body.append(table);
  }
}

// A line instead of the table (loading, not found, unreadable).
export function renderNote(doc, title, text) {
  doc.title = title;
  doc.documentElement.dir = "rtl";
  doc.body.style.cssText = "margin:0;display:grid;place-items:center;height:100vh;font:20px Arial;background:#fff;color:#333";
  const line = doc.createElement("p");
  line.textContent = text;
  doc.body.replaceChildren(line);
}
