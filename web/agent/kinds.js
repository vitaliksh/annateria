// What kind of file an inbox entry is, for the agent: image, pdf, spreadsheet or other.
const KIND_BY_EXTENSION = { jpg: "image", jpeg: "image", png: "image", webp: "image", heic: "image", heif: "image", pdf: "pdf", xlsx: "spreadsheet", xls: "spreadsheet", csv: "spreadsheet" };

// entry: an entry of inbox/index.json ({ type, storedName, ... }).
export function kindOf(entry) {
  if (entry.type.startsWith("image/")) return "image";
  if (entry.type === "application/pdf") return "pdf";
  return KIND_BY_EXTENSION[entry.storedName.split(".").pop().toLowerCase()] ?? "other";
}
