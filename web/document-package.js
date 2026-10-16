const textEncoder = new TextEncoder();

export const PACKAGE_SCHEMA_VERSION = 1;

export function packageDateParts(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return { monthName: `${year}-${month}`, dayName: `${year}-${month}-${day}` };
}

export async function createPackageDirectory(clientDirectory, date = new Date()) {
  const { monthName, dayName } = packageDateParts(date);
  const monthDirectory = await clientDirectory.getDirectoryHandle(monthName, { create: true });
  for (let sequence = 1; sequence <= 999; sequence += 1) {
    const name = `${dayName}_${String(sequence).padStart(3, "0")}`;
    try {
      await monthDirectory.getDirectoryHandle(name);
    } catch (error) {
      if (error.name !== "NotFoundError") throw error;
      return { directory: await monthDirectory.getDirectoryHandle(name, { create: true }), name };
    }
  }
  throw new Error("לא ניתן ליצור חבילה נוספת לתאריך זה.");
}

export async function writeFile(directory, name, data) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try { await writable.write(data); } finally { await writable.close(); }
}

export function makeSourceText(rows) {
  const headers = ["תאריך", "קוד מיון", "פרטים", "ספק", "ע.מ./ת.ז", "אסמכתא", "מספר הקצאה", "כולל מע״מ", "ללא מע״מ", "מע״מ", "% מוכר מע״מ", "% מוכר כהוצאה"];
  const clean = (value) => String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
  return [headers, ...rows.map((row) => row.values.map(clean))].map((line) => line.join("\t")).join("\r\n") + "\r\n";
}

export function makePackageManifest({ client, createdAt, rows }) {
  return {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    createdAt: createdAt.toISOString(),
    client: { clientId: client.clientId, clientName: client.clientName, businessActivity: client.businessActivity, businessKind: client.businessKind },
    rows: rows.map((row) => ({ ...row, image: { file: `images/${row.imageFile}`, type: row.imageType } }))
  };
}

function bytes(...parts) {
  const length = parts.reduce((total, part) => total + part.length, 0), output = new Uint8Array(length); let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

// A deliberately small PDF writer: every page is a JPEG canvas, which lets the
// browser render Hebrew and other Unicode text with its installed fonts.
export function jpegPagesToPdf(jpegPages, width, height, pageWidth = width, pageHeight = height) {
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const pageIds = [], imageIds = [], contentIds = [];
  const catalogId = add(null), pagesId = add(null);
  for (const jpeg of jpegPages) {
    imageIds.push(add(bytes(textEncoder.encode(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, textEncoder.encode("\nendstream"))));
    const content = textEncoder.encode(`q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`);
    contentIds.push(add(bytes(textEncoder.encode(`<< /Length ${content.length} >>\nstream\n`), content, textEncoder.encode("endstream"))));
    pageIds.push(add(null));
  }
  objects[catalogId - 1] = textEncoder.encode(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  objects[pagesId - 1] = textEncoder.encode(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")} ] >>`);
  pageIds.forEach((id, index) => { objects[id - 1] = textEncoder.encode(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 ${imageIds[index]} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`); });
  const header = textEncoder.encode("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n"), chunks = [header], offsets = [0]; let offset = header.length;
  objects.forEach((body, index) => { const prefix = textEncoder.encode(`${index + 1} 0 obj\n`), suffix = textEncoder.encode("\nendobj\n"); offsets.push(offset); chunks.push(prefix, body, suffix); offset += prefix.length + body.length + suffix.length; });
  const startXref = offset, xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.slice(1).map((item) => `${String(item).padStart(10, "0")} 00000 n \n`), `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${startXref}\n%%EOF`].join("");
  return bytes(...chunks, textEncoder.encode(xref));
}
