// "צילום חדש" on a row (the owner, 9 November 2026): a new photo of the same document becomes the original of the row (the old one
// stays in the images of the month), only this document is read again, and the row is filled from it at once, with what it cannot read
// left empty. Pure but for the file it writes; the page fills the row.
import { nextImageNumber } from "./inbox-store.js";
import { displayDate, unreadableParts } from "./row-builder.js";

const money = (value) => (value === "" || value === null || value === undefined || !Number.isFinite(Number(value)) ? "" : Number(value).toFixed(2));

// The values a row shows for a document, in the draft-table format: source amounts, not the recognised ones.
export function rowFacts(snapshot) {
  const values = snapshot.values ?? [];
  // Amounts a bad photo did not show are empty, whatever the stored zero says.
  const blank = (snapshot.unreadable ?? []).includes("amounts");
  const net = blank || snapshot.rawNet === "" ? "" : Number(snapshot.rawNet) || 0;
  const vat = blank || snapshot.rawVat === "" ? "" : Number(snapshot.rawVat) || 0;
  return {
    date: String(values[0] ?? ""),
    supplier: String(values[3] ?? ""),
    supplierId: String(values[4] ?? ""),
    reference: String(snapshot.reference || values[5] || ""),
    gross: net === "" || vat === "" ? "" : money(net + vat),
    vat: vat === "" ? "" : money(vat),
  };
}

// What the new reading says, with what it could not read left empty (never a guess, as for any row).
export function recordFacts(record) {
  const unreadable = unreadableParts(record);
  const blank = unreadable.includes("amounts");
  return {
    date: unreadable.includes("date") ? "" : displayDate(record.date),
    supplier: record.supplier_name ?? "",
    supplierId: record.supplier_vat_id ?? "",
    reference: record.document_number ?? "",
    gross: blank ? "" : money(record.total),
    vat: blank ? "" : money(record.vat),
    net: blank ? "" : money(record.net),
    unreadable,
  };
}

// Of several documents read in the new photo, the one closest to the row: the same number, else the nearest total.
export function pickRecord(records, current) {
  if (!records.length) return null;
  const tail = (value) => String(value ?? "").replace(/\D/g, "").slice(-4);
  const same = records.find((record) => tail(record.document_number) && tail(record.document_number) === tail(current.reference));
  if (same) return same;
  const total = Number(current.gross);
  return [...records].sort((a, b) => Math.abs((Number(a.total) || 0) - total) - Math.abs((Number(b.total) || 0) - total))[0];
}

// Writes the new photo as the next original of the month (001.jpg, 002.pdf, ...); the old original is not touched.
export async function saveRetakeImage(declarationDirectory, file) {
  const images = await declarationDirectory.getDirectoryHandle("images", { create: true });
  const imageIndex = await nextImageNumber(images);
  const extension = /^[a-z0-9]{1,5}$/.test(String(file.name).split(".").pop().toLowerCase()) ? String(file.name).split(".").pop().toLowerCase() : "jpg";
  const imageFile = `${String(imageIndex).padStart(3, "0")}.${extension}`;
  const writable = await (await images.getFileHandle(imageFile, { create: true })).createWritable();
  try {
    await writable.write(file);
  } finally {
    await writable.close();
  }
  return { imageFile, imageIndex };
}
