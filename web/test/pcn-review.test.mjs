import test from "node:test";
import assert from "node:assert/strict";
import { ALLOCATION_THRESHOLDS, allocationThreshold, approvalKey, isApproved, pcnReview, pcnSummary } from "../pcn-review.js";

// Synthetic rows in the draft-table format: values = [date, code, details, supplier, supplierId, reference,
// allocation, gross, net, vat, vat%, expense%].
const row = ({ date = "10/07/26", supplier = "Acme Ltd", supplierId = "515000001", reference = "INV-1001", allocation = "",
  net = 6000, vat = 1080, ...extra } = {}) => ({
  documentId: `doc-${Math.random().toString(36).slice(2)}`,
  values: [date, "801", "x", supplier, supplierId, reference.slice(-4), allocation, net + vat, net, vat, 100, 100],
  rawNet: String(net),
  rawVat: String(vat),
  reference,
  active: true,
  ...extra,
});
const review = (rows, pcnRequired = true) => pcnReview(rows, { pcnRequired });

test("the ceiling follows the invoice date: 20,000 in 2025, 10,000 from 1 Jan 2026, 5,000 from 1 Jun 2026", () => {
  assert.deepEqual(ALLOCATION_THRESHOLDS.map((step) => step.amount), [5000, 10000, 20000]);
  assert.equal(allocationThreshold("31/12/25"), 20000);
  assert.equal(allocationThreshold("01/01/26"), 10000);
  assert.equal(allocationThreshold("31/05/26"), 10000);
  assert.equal(allocationThreshold("01/06/26"), 5000);
  assert.equal(allocationThreshold("2026-10-11"), 5000);
  assert.equal(allocationThreshold("31/12/24"), null, "earlier dates are not covered");
  assert.equal(allocationThreshold(""), 5000, "no readable date: the lowest ceiling, so the row is looked at");
});

test("a client without the PCN duty is never reviewed", () => {
  assert.deepEqual(review([row({ net: 90000 })], false), [{ applies: false }]);
});

test("the ceiling is strict and counts the amount before VAT, not the gross", () => {
  const [at, above, grossAbove] = review([row({ net: 5000, vat: 900 }), row({ net: 5000.01, vat: 900, reference: "B" }), row({ net: 4000, vat: 2000, reference: "C" })]);
  assert.equal(at.over, false);
  assert.equal(above.over, true);
  assert.equal(grossAbove.over, false);
});

test("an invoice with a mixed VAT is judged as a whole, whatever the split", () => {
  const halves = [row({ net: 3000, vat: 540, reference: "MIX-7" }), row({ net: 3000, vat: 0, reference: "MIX-7" })];
  const result = review(halves);
  assert.deepEqual(result.map((item) => [item.invoiceNet, item.over]), [[6000, true], [6000, true]]);
  const other = review([row({ net: 3000, reference: "A-1" }), row({ net: 3000, reference: "A-2" })]);
  assert.deepEqual(other.map((item) => item.over), [false, false], "two invoices are two invoices");
});

test("the old ceiling applies to an old invoice that arrives later in the year", () => {
  const [march, july] = review([row({ date: "10/03/26", net: 7000, reference: "M" }), row({ date: "10/07/26", net: 7000, reference: "J" })]);
  assert.equal(march.over, false);
  assert.equal(march.threshold, 10000);
  assert.equal(july.over, true);
});

test("an allocation number is required above the ceiling when the invoice has VAT", () => {
  const [missing, given, exempt] = review([
    row(),
    row({ allocation: "123456789", reference: "B" }),
    row({ vat: 0, reference: "C" }),
  ]);
  assert.equal(missing.missingAllocation, true);
  assert.equal(given.missingAllocation, false);
  assert.equal(exempt.missingAllocation, false, "no VAT: no number needed, the bookkeeper still looks at it");
  assert.equal(exempt.pending, true);
});

test("a number on any record of a split invoice covers all of them; a number that is not nine digits only warns", () => {
  const split = review([row({ reference: "S-1", net: 3000, allocation: "123456789" }), row({ reference: "S-1", net: 3000, vat: 0 })]);
  assert.deepEqual(split.map((item) => item.missingAllocation), [false, false]);
  const [short] = review([row({ allocation: "12345" })]);
  assert.equal(short.allocationWarning, true);
  assert.equal(short.missingAllocation, false);
});

test("approval is the bookkeeper's tick on exactly this document; an edit makes it lapse", () => {
  const checked = row({ allocation: "123456789" });
  assert.equal(review([checked])[0].blocked, true);
  checked.pcnApproved = approvalKey(checked);
  assert.equal(isApproved(checked), true);
  assert.deepEqual(review([checked])[0], { ...review([checked])[0], approved: true, pending: false, blocked: false });
  checked.rawNet = "6100";
  assert.equal(isApproved(checked), false, "a changed amount lapses the approval");
  checked.rawNet = "6000";
  checked.values[6] = "987654321";
  assert.equal(isApproved(checked), false, "a changed allocation number lapses it too");
});

test("approval without the number still blocks when the invoice has VAT", () => {
  const checked = row();
  checked.pcnApproved = approvalKey(checked);
  const [result] = review([checked]);
  assert.deepEqual([result.pending, result.missingAllocation, result.blocked], [false, true, true]);
});

test("recognition percentages do not touch the approval", () => {
  const checked = row({ allocation: "123456789" });
  checked.pcnApproved = approvalKey(checked);
  checked.values[8] = 3000;
  checked.values[9] = 540;
  assert.equal(isApproved(checked), true);
});

test("Excel and ledger rows, income reports and inactive rows are outside the rule", () => {
  const rows = [
    row({ documentId: "import-3-abc" }),
    row({ documentKind: "income_report", reference: "R" }),
    row({ active: false, reference: "I" }),
    row({ reference: "OK" }),
  ];
  assert.deepEqual(review(rows).map((item) => item.applies), [false, false, false, true]);
});

test("rows without a reference are separate invoices", () => {
  const result = review([row({ reference: "", net: 3000 }), row({ reference: "", net: 3000 })]);
  assert.deepEqual(result.map((item) => item.over), [false, false]);
});

test("the summary counts what waits for the bookkeeper and what lacks a number", () => {
  const approved = row({ reference: "A", allocation: "123456789" });
  approved.pcnApproved = approvalKey(approved);
  const result = review([approved, row({ reference: "B" }), row({ reference: "C", allocation: "123456789" }), row({ reference: "D", net: 100 })]);
  assert.deepEqual(pcnSummary(result), { pending: 2, missingAllocation: 1, blocked: 2 });
});
