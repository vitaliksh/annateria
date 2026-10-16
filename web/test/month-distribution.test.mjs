import test from "node:test";
import assert from "node:assert/strict";
import { deductionStatus, lockedThrough, monthOfDate, monthsBetween, nextMonth, proposeMonth, targetMonths } from "../month-distribution.js";

const today = new Date(2026, 9, 7);

test("reads the month of a journal date in the usual spellings and rejects the rest", () => {
  assert.equal(monthOfDate("26/08/26"), "2026-08");
  assert.equal(monthOfDate("1/9/2026"), "2026-09");
  assert.equal(monthOfDate("30.09.26"), "2026-09");
  assert.equal(monthOfDate("30-09-2026"), "2026-09");
  for (const bad of ["", "2026-09-30", "32/01/26", "10/13/26", "ספטמבר", null, undefined]) assert.equal(monthOfDate(bad), null);
});

test("month arithmetic crosses the year", () => {
  assert.equal(nextMonth("2026-12"), "2027-01");
  assert.equal(monthsBetween("2026-08", "2027-02"), 6);
  assert.equal(monthsBetween("2026-10", "2026-08"), -2);
});

test("the last locked month is the latest one that is not open", () => {
  assert.equal(lockedThrough([]), null);
  assert.equal(lockedThrough([{ month: "2026-08", status: "closed" }, { month: "2026-09", status: "open" }, { month: "2026-02", status: "closed" }]), "2026-08");
  assert.equal(lockedThrough([{ month: "2026-09", status: "open" }]), null);
});

test("a document belongs to the month of its date", () => {
  assert.deepEqual(proposeMonth("23/09/26", { today }), { month: "2026-09", docMonth: "2026-09", reason: "date" });
  assert.deepEqual(proposeMonth("05/10/26", { lockedThrough: "2026-08", today }), { month: "2026-10", docMonth: "2026-10", reason: "date" });
});

test("a document dated in a filed month goes to the first month after the last locked one", () => {
  assert.deepEqual(proposeMonth("26/08/26", { lockedThrough: "2026-08", today }), { month: "2026-09", docMonth: "2026-08", reason: "after-locked" });
  assert.deepEqual(proposeMonth("14/03/26", { lockedThrough: "2026-08", today }), { month: "2026-09", docMonth: "2026-03", reason: "after-locked" });
});

test("a missing, unreadable or implausible date gets no proposal", () => {
  assert.equal(proposeMonth("", { today }).reason, "no-date");
  assert.equal(proposeMonth("אתמול", { today }).month, null);
  assert.deepEqual(proposeMonth("05/05/16", { today }), { month: null, docMonth: "2016-05", reason: "implausible" });
  assert.equal(proposeMonth("01/01/30", { today }).reason, "implausible");
  assert.equal(proposeMonth("15/12/26", { today }).month, "2026-12");
});

test("VAT deduction is flagged at six months and beyond", () => {
  assert.equal(deductionStatus("2026-08", "2027-01"), "ok");
  assert.equal(deductionStatus("2026-08", "2027-02"), "check");
  assert.equal(deductionStatus("2026-08", "2027-03"), "late");
  assert.equal(deductionStatus(null, "2026-09"), "ok");
});

test("the offered months are the open ones and the unfiled months up to the month after today, never a filed month", () => {
  const declarations = [
    { month: "2026-07", status: "closed" },
    { month: "2026-08", status: "closed" },
    { month: "2026-09", status: "open" },
  ];
  assert.deepEqual(targetMonths({ declarations, lockedThrough: "2026-08", current: "2026-09", proposals: ["2026-10", null], today }), ["2026-09", "2026-10", "2026-11"]);
});

test("months before the last locked one stay closed even without a declaration (a client that files two months together)", () => {
  const declarations = [{ month: "2026-04", status: "closed" }, { month: "2026-08", status: "closed" }, { month: "2026-09", status: "open" }];
  const months = targetMonths({ declarations, lockedThrough: "2026-08", current: "2026-09", today });
  assert.equal(months.includes("2026-07"), false);
  assert.equal(months.includes("2026-03"), false);
});

test("without locked months the range starts at the earliest proposal", () => {
  const declarations = [{ month: "2026-09", status: "open" }];
  assert.deepEqual(targetMonths({ declarations, current: "2026-09", proposals: ["2026-08", "2026-09"], today }), ["2026-08", "2026-09", "2026-10", "2026-11"]);
});
