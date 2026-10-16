function clean(value) { return String(value ?? "").trim().toLowerCase(); }
function words(value) { return new Set(clean(value).split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3)); }
function overlap(left, right) { const first = words(left), second = words(right); if (!first.size || !second.size) return 0; let shared = 0; for (const word of first) if (second.has(word)) shared += 1; return shared / Math.max(first.size, second.size); }
function field(row, index) { return Array.isArray(row?.values) ? row.values[index] : ""; }

export function relevantHistory(draftRow, history, limit = 8) {
  const supplier = clean(field(draftRow, 3)), supplierId = clean(field(draftRow, 4)), classification = clean(field(draftRow, 1)), description = field(draftRow, 2), purpose = field(draftRow, 2);
  return history.map((record, index) => {
    const sameSupplierId = supplierId && supplierId === clean(field(record, 4)), sameSupplier = supplier && supplier === clean(field(record, 3)), sameClassification = classification && classification === clean(field(record, 1));
    const score = (sameSupplierId ? 100 : 0) + (sameSupplier ? 40 : 0) + (sameClassification ? 15 : 0) + overlap(description, field(record, 2)) * 20 + overlap(purpose, field(record, 2)) * 5;
    return { record, score, index };
  }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score || right.index - left.index).slice(0, Math.max(3, Math.min(8, limit))).map(({ record }) => ({ declarationMonth: record.declarationMonth, supplier: field(record, 3), supplierVatId: field(record, 4), classification: field(record, 1), purpose: field(record, 2), recognizedPercent: field(record, 11), vatRecognizedPercent: field(record, 10), confidence: record.confidence, agentOpinion: record.agentOpinion }));
}
