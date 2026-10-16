import test from "node:test";
import assert from "node:assert/strict";
import { dateKey, entryFromRow, findDuplicates, intakeFacts, intakeMonth, monthOfAnyDate, yearGate } from "../intake-facts.js";

const today = new Date(2026, 8, 15);
const NOW = "2026-09-15T10:00:00.000Z";

// A saved row: date, code, details, supplier, supplier ID, reference, allocation, gross, net, VAT, VAT %, expense %.
const row = (id, date, gross, { supplier = "חברת החשמל לישראל בע״מ", supplierId = "520000472", reference = "5501" } = {}) => ({
  documentId: id,
  receivedAt: NOW,
  values: [date, "204", "חשמל", supplier, supplierId, reference, "", gross.toFixed(2), (gross / 1.18).toFixed(2), "0", "100", "100"],
  active: true,
});
const entry = (id, date, gross, month, extra = {}, status = "open", position = 0) =>
  entryFromRow(row(id, date, gross, extra), { month, status, position });
const candidate = (id, date, gross, month, extra = {}, position = 5) =>
  entryFromRow(row(id, date, gross, extra), { month, position });

test("dates are read in the journal and in the ISO spellings", () => {
  assert.equal(monthOfAnyDate("2026-03-14"), "2026-03");
  assert.equal(monthOfAnyDate("2026-03"), "2026-03");
  assert.equal(monthOfAnyDate("14/03/26"), "2026-03");
  assert.equal(monthOfAnyDate("2026-13"), null);
  assert.equal(monthOfAnyDate("soon"), null);
  assert.equal(dateKey("14/3/26"), "2026-03-14");
  assert.equal(dateKey("2026-03-14"), "2026-03-14");
  assert.equal(dateKey("31/13/26"), null);
  assert.equal(dateKey(""), null);
});

test("a document goes to the month of its date, a period document to the month of receipt, none into a filed month", () => {
  assert.equal(intakeMonth({ date: "14/03/26", today }).month, "2026-03");
  const filed = intakeMonth({ date: "14/03/26", lockedThrough: "2026-08", today });
  assert.deepEqual([filed.month, filed.docMonth, filed.reason], ["2026-09", "2026-03", "after-locked"]);
  const period = intakeMonth({ date: "01/07/25", periodFrom: "2025-07-01", periodTo: "2026-06-30", receivedAt: NOW, today });
  assert.deepEqual([period.month, period.reason], ["2026-09", "period-received"]);
  const periodFiled = intakeMonth({ date: "01/07/25", periodFrom: "2025-07", periodTo: "2026-06", receivedAt: "2026-07-02T10:00:00.000Z", lockedThrough: "2026-08", today });
  assert.deepEqual([periodFiled.month, periodFiled.reason], ["2026-09", "after-locked"]);
  assert.equal(intakeMonth({ date: "", today }).reason, "no-date");
});

test("only the year of the declaration month is accepted; a period is judged by its end", () => {
  const gate = (extra) => yearGate({ targetMonth: "2026-10", ...extra }).status;
  assert.equal(gate({ docMonth: "2026-03" }), "ok");
  assert.equal(gate({ docMonth: "2025-12" }), "previous-year");
  assert.equal(gate({ docMonth: "2027-01" }), "future-year");
  assert.equal(gate({ docMonth: null }), "no-date");
  assert.equal(gate({ docMonth: "2025-07", periodFrom: "2024-07-01", periodTo: "2025-06-30" }), "previous-year");
  assert.equal(gate({ docMonth: "2025-07", periodFrom: "2025-07-01", periodTo: "2026-06-30" }), "ok");
  assert.equal(gate({ docMonth: "2026-10", periodFrom: "2027-01-01", periodTo: "2027-12-31" }), "future-year");
  assert.deepEqual(yearGate({ docMonth: "2025-07", periodFrom: "2025-07", periodTo: "2026-06", targetMonth: "2026-10" }), { status: "ok", basis: "period", year: 2026, allowedYear: 2026 });
});

test("a short period (a monthly or bimonthly bill) or a half-known one is ignored: the document goes by its date", () => {
  const monthly = { date: "30/09/26", periodFrom: "2026-09-01", periodTo: "2026-09-30", receivedAt: "2026-10-04T10:00:00.000Z", today: new Date(2026, 9, 7) };
  assert.deepEqual([intakeMonth(monthly).month, intakeMonth(monthly).reason], ["2026-09", "date"]);
  assert.equal(yearGate({ docMonth: "2025-12", periodFrom: "2025-11-25", periodTo: "2026-01-25", targetMonth: "2026-01" }).basis, "date");
  assert.equal(yearGate({ docMonth: "2026-03", periodTo: "2026-06-30", targetMonth: "2026-10" }).basis, "date");
  const quarterAndMore = yearGate({ docMonth: "2026-01", periodFrom: "2026-01-01", periodTo: "2026-06-30", targetMonth: "2026-10" });
  assert.equal(quarterAndMore.basis, "period");
});

test("the same reference, amount and supplier is a strong duplicate, also in a locked month", () => {
  const entries = [entry("old", "12/02/26", 118, "2026-02", {}, "closed")];
  const found = findDuplicates(entries, candidate("new", "12/02/26", 118, "2026-09"), { fromMonth: "2026-02" });
  assert.equal(found.level, "strong");
  assert.deepEqual(found.matches.map((match) => [match.month, match.status, match.documentId]), [["2026-02", "closed", "old"]]);
});

test("a row typed from the journals (short supplier name, no supplier ID) is a likely duplicate by reference, amount and date", () => {
  const entries = [entry("import-1", "12/02/26", 118, "2026-02", { supplier: "חח״י", supplierId: "0" }, "closed")];
  assert.equal(findDuplicates(entries, candidate("new", "12/02/26", 118, "2026-09")).level, "likely");
  assert.equal(findDuplicates(entries, candidate("new", "13/02/26", 118, "2026-09")).level, null);
  const shortReference = [entry("import-2", "12/02/26", 118, "2026-02", { supplier: "אחר", supplierId: "0", reference: "7" }, "closed")];
  assert.equal(findDuplicates(shortReference, candidate("new", "12/02/26", 118, "2026-09", { reference: "7" })).level, null);
});

test("no reference: only the same supplier, date and amount is possible; different supplier IDs never match", () => {
  const entries = [entry("old", "12/02/26", 118, "2026-02", { reference: "" })];
  assert.equal(findDuplicates(entries, candidate("new", "12/02/26", 118, "2026-09", { reference: "" })).level, "possible");
  assert.equal(findDuplicates(entries, candidate("new", "12/02/26", 118, "2026-09", { reference: "", supplierId: "510000001" })).level, null);
  assert.equal(findDuplicates([entry("old", "12/02/26", 118, "2026-02")], candidate("new", "12/02/26", 118, "2026-09", { supplierId: "510000001" })).level, null);
});

test("a different amount, another reference or an earlier month than the window is not a duplicate", () => {
  const entries = [entry("old", "12/02/26", 118, "2026-02")];
  assert.equal(findDuplicates(entries, candidate("new", "12/02/26", 120, "2026-09")).level, null);
  assert.equal(findDuplicates(entries, candidate("new", "12/02/26", 118, "2026-09", { reference: "5502" })).level, null);
  assert.equal(findDuplicates(entries, candidate("new", "12/02/26", 118, "2026-09"), { fromMonth: "2026-03" }).level, null);
});

test("a credit note and an invoice of the same size are compared by amount without the sign", () => {
  const entries = [entry("old", "12/02/26", -118, "2026-02")];
  assert.equal(findDuplicates(entries, candidate("new", "12/02/26", 118, "2026-09")).level, "strong");
});

test("the two halves of a mixed-VAT invoice are not duplicates of each other", () => {
  const entries = [entry("doc", "12/02/26", 50, "2026-09", {}, "open", 0), entry("doc", "12/02/26", 118, "2026-09", {}, "open", 1)];
  assert.equal(findDuplicates(entries, candidate("doc", "12/02/26", 118, "2026-09", {}, 1)).level, null);
  // The same invoice read again as another document matches its own half, not the other one.
  const again = findDuplicates(entries, candidate("again", "12/02/26", 118, "2026-09", {}, 2));
  assert.deepEqual(again.matches.map((match) => match.position), [1]);
});

test("inside one declaration only the rows above count: the later copy is the duplicate", () => {
  const entries = [entry("a", "12/02/26", 118, "2026-09", {}, "open", 0), entry("b", "12/02/26", 118, "2026-09", {}, "open", 1)];
  assert.equal(findDuplicates(entries, candidate("a", "12/02/26", 118, "2026-09", {}, 0)).level, null);
  assert.equal(findDuplicates(entries, candidate("b", "12/02/26", 118, "2026-09", {}, 1)).level, "strong");
});

test("September: an invoice for February is refused as a duplicate of one filed in February", () => {
  const entries = [entry("feb", "12/02/26", 118, "2026-02", {}, "closed")];
  const facts = intakeFacts({ row: row("new", "12/02/26", 118), month: "2026-09", position: 3 }, { entries, lockedThrough: "2026-08", today });
  assert.equal(facts.targetMonth, "2026-09");
  assert.equal(facts.monthReason, "after-locked");
  assert.equal(facts.duplicates.level, "strong");
  assert.equal(facts.exclude, "duplicate");
  assert.equal(facts.deduction, "late");
});

test("October: an invoice for March is accepted into March when it is open, and a duplicate is found in the months from March on", () => {
  const entries = [entry("jun", "12/03/26", 118, "2026-06", {}, "closed")];
  const open = intakeFacts({ row: row("new", "12/03/26", 118), month: "2026-10", position: 0 }, { entries, today: new Date(2026, 9, 7) });
  assert.equal(open.targetMonth, "2026-03");
  assert.equal(open.moves, true);
  assert.equal(open.year.status, "ok");
  assert.equal(open.exclude, "duplicate");
  const fresh = intakeFacts({ row: row("new", "12/03/26", 90), month: "2026-10", position: 0 }, { entries, today: new Date(2026, 9, 7) });
  assert.equal(fresh.exclude, null);
  assert.equal(fresh.deduction, "ok");
});

test("a copy in the open table is found although the document is dated in a later month", () => {
  const entries = [entry("a", "01/10/26", 76.7, "2026-09", {}, "open", 0)];
  const facts = intakeFacts({ row: row("b", "01/10/26", 76.7), month: "2026-09", position: 1 }, { entries, today: new Date(2026, 9, 10) });
  assert.deepEqual([facts.targetMonth, facts.duplicates.level, facts.exclude], ["2026-10", "strong", "duplicate"]);
});

test("a document of the previous year is excluded, also after the filed months push it forward", () => {
  const facts = intakeFacts({ row: row("old", "20/12/25", 118), month: "2026-09", position: 0 }, { lockedThrough: "2026-08", today });
  assert.deepEqual([facts.targetMonth, facts.year.status, facts.exclude], ["2026-09", "previous-year", "previous-year"]);
  const implausible = intakeFacts({ row: row("older", "20/12/16", 118), month: "2026-09", position: 0 }, { today });
  assert.deepEqual([implausible.monthReason, implausible.exclude], ["implausible", "previous-year"]);
});

test("insurance: the period 24-25 is refused in 2026, the period 25-26 is accepted but still checked for duplicates", () => {
  const old = intakeFacts({ row: row("ins", "01/07/24", 5000), month: "2026-09", position: 0, periodFrom: "2024-07-01", periodTo: "2025-06-30" }, { today });
  assert.equal(old.exclude, "previous-year");
  const entries = [entry("ins0", "01/07/25", 5000, "2026-03", {}, "closed")];
  const current = { row: row("ins", "01/07/25", 5000), month: "2026-09", position: 0, periodFrom: "2025-07-01", periodTo: "2026-06-30" };
  const accepted = intakeFacts(current, { today });
  assert.deepEqual([accepted.targetMonth, accepted.monthReason, accepted.year.basis, accepted.exclude, accepted.deduction], ["2026-09", "period-received", "period", null, "ok"]);
  assert.equal(intakeFacts(current, { entries, today }).exclude, "duplicate");
});

test("warnings do not exclude: a possible duplicate, a future year, a missing date and a late VAT deduction", () => {
  const entries = [entry("old", "12/02/26", 118, "2026-02", { reference: "" })];
  const possible = intakeFacts({ row: row("new", "12/02/26", 118, { reference: "" }), month: "2026-09", position: 0 }, { entries, today });
  assert.deepEqual([possible.duplicates.level, possible.exclude], ["possible", null]);
  const next = intakeFacts({ row: row("x", "05/01/27", 118), month: "2026-12", position: 0 }, { today: new Date(2026, 11, 20) });
  assert.deepEqual([next.targetMonth, next.year.status], ["2027-01", "ok"]);
  const far = intakeFacts({ row: row("x", "05/01/29", 118), month: "2026-09", position: 0 }, { today });
  assert.deepEqual([far.year.status, far.exclude], ["future-year", null]);
  const noDate = intakeFacts({ row: row("x", "", 118), month: "2026-09", position: 0 }, { today });
  assert.deepEqual([noDate.year.status, noDate.exclude, noDate.targetMonth], ["no-date", null, "2026-09"]);
  const late = intakeFacts({ row: row("x", "02/02/26", 118), month: "2026-09", position: 0 }, { lockedThrough: "2026-08", today });
  assert.deepEqual([late.deduction, late.exclude], ["late", null]);
});

test("yearly letters of one insurer are different documents when their full references differ, a truncated row is matched by its last digits", () => {
  const letter = (id, reference, extra = {}) => ({ ...row(id, "07/09/26", 941, { reference: "7507" }), reference, ...extra });
  const last = entryFromRow(letter("old", "25/001/673/1017507"), { month: "2026-08", status: "closed" });
  const next = entryFromRow(letter("new", "26/001/673/1017507"), { month: "2026-09", position: 1 });
  assert.equal(findDuplicates([last], next).level, null);
  const again = entryFromRow(letter("again", "26/001/673/1017507"), { month: "2026-09", position: 2 });
  assert.equal(findDuplicates([next], again).level, "strong");
  const truncated = entry("saved", "07/09/26", 941, "2026-08", { reference: "7507" }, "closed");
  assert.equal(findDuplicates([truncated], next).level, "strong");
});

test("the source amounts of a row, not the recognised table amounts, are compared", () => {
  const home = (id, shown) => ({ ...row(id, "26/08/26", shown), rawNet: 1047.55, rawVat: 188.56 });
  const saved = entryFromRow(home("a", 309.03), { month: "2026-08", status: "closed" });
  const fresh = entryFromRow({ ...home("b", 1236.11) }, { month: "2026-09", position: 1 });
  assert.equal(saved.gross, 1236.11);
  assert.equal(findDuplicates([saved], fresh).level, "strong");
});
