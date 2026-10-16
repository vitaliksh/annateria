// The fact record that extraction returns (docs/AGENT_TOOLS.md, section 4): one schema for the model's answer and for its
// validation, and the cleaning that the code applies afterwards. After normalizeRecord() a record is frozen for the run.
import { dateKey } from "../intake-facts.js";
import { taxIdProblem } from "../workspace-core.js";

export const KINDS = ["expense_invoice", "payment_confirmation", "income_report", "other"];
// Issues the model may report; the code adds amounts_mismatch, bad_vat_id, no_date and foreign_currency itself.
export const MODEL_ISSUES = ["blurred", "date_unclear", "amount_unclear", "cropped", "handwritten", "other_language"];
export const CODE_ISSUES = ["amounts_mismatch", "bad_vat_id", "no_date", "foreign_currency"];

const text = { type: "string", nullable: true };
export const RECORD_SCHEMA = {
  type: "object",
  required: ["kind", "page", "date", "period_from", "period_to", "document_title", "supplier_name", "supplier_vat_id", "buyer_name", "buyer_vat_id", "document_number", "allocation_number", "currency", "net", "vat", "total", "vat_percent", "purpose", "confidence", "issues"],
  properties: {
    kind: { type: "string", enum: KINDS },
    page: { type: "integer", nullable: true, description: "1-based page of a PDF; null for a photo." },
    date: { type: "string", nullable: true, description: "Date printed on the document, YYYY-MM-DD." },
    period_from: { type: "string", nullable: true, description: "First day of the period the document states, YYYY-MM-DD." },
    period_to: { type: "string", nullable: true, description: "Last day of the period, YYYY-MM-DD." },
    document_title: text,
    supplier_name: text,
    supplier_vat_id: text,
    buyer_name: text,
    buyer_vat_id: text,
    document_number: text,
    allocation_number: text,
    currency: { type: "string", description: "ISO code, ILS for shekels." },
    net: { type: "number" },
    vat: { type: "number" },
    total: { type: "number" },
    vat_percent: { type: "number" },
    purpose: text,
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    issues: { type: "array", items: { type: "string", enum: MODEL_ISSUES } },
  },
};

const CONTROL = /[\u0000-\u001f\u007f]/g;
const FREE_TEXT = 120;
// Free text from a document reaches the orchestrator as data: no control characters, one line, cut short.
export const cleanText = (value, max = FREE_TEXT) => {
  const cleaned = String(value ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return cleaned || null;
};
const digits = (value) => String(value ?? "").replace(/\D/g, "").slice(0, 20) || null;
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const isoDate = (value) => (value ? dateKey(value) : null);

// raw: an object that already passed validate(RECORD_SCHEMA). Returns the frozen record of section 4.
export function normalizeRecord(raw, { isImage = false } = {}) {
  const issues = new Set(raw.issues.filter((issue) => MODEL_ISSUES.includes(issue)));
  const date = isoDate(raw.date);
  const net = money(raw.net), vat = money(raw.vat), total = money(raw.total);
  const supplierVatId = digits(raw.supplier_vat_id);
  const currency = /^[A-Za-z]{3}$/.test(String(raw.currency).trim()) ? String(raw.currency).trim().toUpperCase() : "ILS";
  if (!date) issues.add("no_date");
  if (Math.abs(net + vat - total) > 0.011) issues.add("amounts_mismatch");
  if (supplierVatId && taxIdProblem(supplierVatId, { checkDigit: true })) issues.add("bad_vat_id");
  if (currency !== "ILS") issues.add("foreign_currency");
  return Object.freeze({
    kind: raw.kind,
    page: isImage || !Number.isInteger(raw.page) || raw.page < 1 ? null : raw.page,
    date,
    period_from: isoDate(raw.period_from),
    period_to: isoDate(raw.period_to),
    document_title: cleanText(raw.document_title),
    supplier_name: cleanText(raw.supplier_name),
    supplier_vat_id: supplierVatId,
    buyer_name: cleanText(raw.buyer_name),
    buyer_vat_id: digits(raw.buyer_vat_id),
    document_number: cleanText(raw.document_number, 60),
    allocation_number: digits(raw.allocation_number),
    currency,
    net, vat, total,
    vat_percent: Math.round((Number(raw.vat_percent) || 0) * 100) / 100,
    purpose: cleanText(raw.purpose),
    confidence: Math.max(0, Math.min(100, Math.round(raw.confidence))),
    issues: Object.freeze([...issues].sort()),
  });
}
