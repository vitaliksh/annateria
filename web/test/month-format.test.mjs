import test from "node:test";
import assert from "node:assert/strict";
import { formatMonth, parseMonthText } from "../month-format.js";

test("месяц: разбор MM/YYYY и близких записей в YYYY-MM", () => {
  for (const text of ["01/2026", "1/2026", " 01.2026 ", "01-2026", "2026-01"]) assert.equal(parseMonthText(text), "2026-01", text);
  assert.equal(parseMonthText("12/2026"), "2026-12");
});

test("месяц: неверные записи дают null", () => {
  for (const text of ["", "13/2026", "00/2026", "2026", "1/26", "January 2026", "2026-13", null, undefined]) {
    assert.equal(parseMonthText(text), null, String(text));
  }
});

test("месяц: показ в виде MM/YYYY, мусор даёт пустую строку", () => {
  assert.equal(formatMonth("2026-01"), "01/2026");
  assert.equal(formatMonth("bad"), "");
  assert.equal(formatMonth(""), "");
  assert.equal(parseMonthText(formatMonth("2027-11")), "2027-11");
});
