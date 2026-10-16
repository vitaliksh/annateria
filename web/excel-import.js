// Converts parsed journal rows (excel-journal.js) into draft-table rows in the saved-snapshot format of app.js.
// Imported amounts are source values recognised at 100 % / 100 %: the business rules must not reduce VAT twice.
export const IMPORT_FINAL_EXPORT = "excel-import";
const round2 = (value) => Math.round(value * 100) / 100;

function displayDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1].slice(-2)}` : String(iso ?? "");
}

// Transaction reference as the app shows it: the last four digits.
function displayedReference(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? digits.slice(-4) : "";
}

function importedRow(row, code, index, { now, makeId }) {
  // The file signs VAT opposite to net for expenses; the app keeps VAT with the sign of net.
  const vat = row.kind === "credit" ? -Math.abs(row.vat) : Math.abs(row.vat);
  const net = row.net;
  const gross = round2(net + vat);
  return {
    documentId: `import-${index + 1}-${makeId()}`,
    imageIndex: 0,
    imageFile: "",
    receivedAt: now,
    values: [
      displayDate(row.date),
      code,
      row.details,
      row.details,
      "",
      displayedReference(row.reference1),
      "",
      gross.toFixed(2),
      net.toFixed(2),
      vat.toFixed(2),
      "100",
      "100",
    ],
    rawNet: net.toFixed(2),
    rawVat: vat.toFixed(2),
    vatPercent: net ? String(round2((Math.abs(vat) / Math.abs(net)) * 100)) : "0",
    form6111Code: "",
    highlights: [],
    active: true,
    agentOpinion: "יובא מקובץ Excel",
    confidence: "",
    statusText: "יובא מ-Excel",
    statusClass: "ready",
  };
}

// `codes` maps classification name -> chart code (matchClassNames). Every name must be mapped first.
export function buildImportedRows(rows, codes, { now = new Date().toISOString(), makeId = () => crypto.randomUUID() } = {}) {
  const missing = [...new Set(rows.map((row) => row.classificationName).filter((name) => !codes[name]))];
  if (missing.length) throw new Error(`חסר קוד מיון עבור: ${missing.join(", ")}`);
  return rows.map((row, index) => importedRow(row, codes[row.classificationName], index, { now, makeId }));
}

// Reference 2 has no place in the app model; tell the user instead of dropping it silently.
export function importWarnings(rows) {
  const warnings = [];
  const withReference2 = rows.filter((row) => row.reference2).length;
  if (withReference2) warnings.push({ code: "reference2-dropped", message: `${withReference2} rows have reference 2, not imported`, count: withReference2 });
  return warnings;
}
