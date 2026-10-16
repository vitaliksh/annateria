// Review rules for a client that must produce a detailed PCN874 report (Anna's review of 11 October 2026): an invoice
// above the allocation-number ceiling has to be checked by the bookkeeper (the row is marked until she approves it) and,
// when it carries VAT, has to have an allocation number from the Tax Authority. Pure; no DOM, no file access.
//
// Rows are in the draft-table format (see rowSnapshot in app.js). Excel and ledger rows (`import-…`, already filed in
// the old system) and income reports are outside the rule, and so is a row that is not active.
import { dateKey, entryFromRow } from "./intake-facts.js";

// Ceiling for the amount of an invoice before VAT above which the buyer needs an allocation number to deduct the VAT,
// by the invoice date. Source: gov.il, "בקשה למספר הקצאה לחשבונית מס" (read 11 October 2026): 20,000 in 2025, 10,000
// from 1 January 2026, 5,000 from 1 June 2026. Dates before 2025 are not covered here: no rule.
export const ALLOCATION_THRESHOLDS = [
  { from: "2026-06-01", amount: 5000 },
  { from: "2026-01-01", amount: 10000 },
  { from: "2025-01-01", amount: 20000 },
];

// A document without a readable date gets the newest (lowest) ceiling, so that it is looked at rather than missed.
export function allocationThreshold(date) {
  const key = dateKey(date);
  if (!key) return ALLOCATION_THRESHOLDS[0].amount;
  return ALLOCATION_THRESHOLDS.find((step) => key >= step.from)?.amount ?? null;
}

// Positions of a saved row's values (rowSnapshot in app.js).
const DATE = 0;
const SUPPLIER_ID = 4;
const REFERENCE = 5;
const ALLOCATION = 6;
const NET = 8;
const VAT = 9;

const amount = (value) => Math.abs(Number(String(value ?? "").replace(/,/g, "")) || 0);
const digits = (value) => String(value ?? "").replace(/\D/g, "");
const money = (value) => Math.round(value * 100) / 100;

const isReviewable = (row) =>
  row.active !== false && row.documentKind !== "income_report" && !String(row.documentId ?? "").startsWith("import-");

// Source amounts: they change only when the amount itself is edited, not with the recognition percentages.
const netOf = (row) => amount(row.rawNet) || amount(row.values?.[NET]);
const vatOf = (row) => amount(row.rawVat) || amount(row.values?.[VAT]);

// What the bookkeeper approved: the document as it was when she ticked the box. Any change of date, amounts,
// supplier, reference or allocation number makes the stored key differ, so the approval lapses by itself.
export function approvalKey(row) {
  const values = row.values ?? [];
  return [
    dateKey(values[DATE]) ?? "",
    netOf(row).toFixed(2),
    vatOf(row).toFixed(2),
    digits(values[ALLOCATION]),
    digits(values[SUPPLIER_ID]),
    String(row.reference || values[REFERENCE] || "").trim(),
  ].join("|");
}

export const isApproved = (row) => Boolean(row.pcnApproved) && row.pcnApproved === approvalKey(row);

const NOT_APPLICABLE = Object.freeze({ applies: false });

// One result per row. over: the invoice is above the ceiling; pending: over and not approved; missingAllocation: over,
// has VAT and no allocation number on any record of the invoice; blocked: over and (not approved or no number).
// An invoice with a mixed VAT is several rows with one supplier and reference: they are one invoice for the ceiling.
export function pcnReview(rows, { pcnRequired = false } = {}) {
  if (!pcnRequired) return rows.map(() => NOT_APPLICABLE);
  const entries = rows.map((row) => (isReviewable(row) ? entryFromRow(row, { month: "" }) : null));
  const groups = new Map();
  entries.forEach((entry, index) => {
    if (!entry) return;
    const key = entry.reference ? `${entry.supplierId || entry.supplier.join(" ")}|${entry.reference}` : `row:${index}`;
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  const groupOf = new Map();
  for (const members of groups.values()) members.forEach((index) => groupOf.set(index, members));

  return rows.map((row, index) => {
    const members = groupOf.get(index);
    if (!members) return NOT_APPLICABLE;
    const invoiceNet = money(members.reduce((sum, member) => sum + netOf(rows[member]), 0));
    const invoiceVat = members.reduce((sum, member) => sum + vatOf(rows[member]), 0);
    const threshold = allocationThreshold(rows[members[0]].values?.[DATE]);
    const over = threshold !== null && invoiceNet > threshold;
    const allocation = members.map((member) => String(rows[member].values?.[ALLOCATION] ?? "").trim()).find(Boolean) ?? "";
    const missingAllocation = over && invoiceVat > 0 && !allocation;
    const approved = isApproved(row);
    return {
      applies: true,
      threshold,
      invoiceNet,
      over,
      allocation,
      allocationWarning: Boolean(allocation) && digits(allocation).length !== 9,
      missingAllocation,
      approved,
      pending: over && !approved,
      blocked: over && (!approved || missingAllocation),
    };
  });
}

// Counts for the plate above the journal and for the lock check.
export function pcnSummary(reviews) {
  const count = (field) => reviews.filter((review) => review[field]).length;
  return { pending: count("pending"), missingAllocation: count("missingAllocation"), blocked: count("blocked") };
}
