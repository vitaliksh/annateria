import test from "node:test";
import assert from "node:assert/strict";
import { buildPcn874, pcn874FileName } from "../pcn874.js";

const accounts = {
  160: { name: "הכנסות", type: "income" },
  202: { name: "משרדיות", type: "expense" },
  205: { name: "ארנונה", type: "outsideVatBase" },
  900: { name: "רכישת ציוד", type: "equipment" },
};
// A saved row: [date, code, purpose, supplier, other side's number, document number, allocation, gross, net, vat, %, %].
const row = ({ date, code, party = "", reference = "", allocation = "", net, vat, rawNet = net }) => ({
  active: true,
  values: [date, code, "", "", party, reference, allocation, String(net + vat), String(net), String(vat), "", ""],
  rawNet: String(rawNet),
  rawVat: String(vat),
});
const september = () => [
  row({ date: "02/09/26", code: "202", party: "000000018", reference: "3412", net: 4759.32, vat: 856.68 }),
  // A car: two thirds of the VAT are recognised, the net of the line stays 100 %.
  row({ date: "01/09/26", code: "202", party: "18", reference: "INV-2372", allocation: "274028901", net: 5333.33, vat: 960,
    rawNet: 8000 }),
  row({ date: "05/09/26", code: "205", party: "000000018", reference: "55", net: 1000, vat: 180 }),
  row({ date: "06/09/26", code: "202", party: "000000018", reference: "56", net: 40, vat: 0 }),
  row({ date: "07/09/26", code: "900", party: "000000018", reference: "57", net: 1000, vat: 180 }),
  row({ date: "24/09/26", code: "160", party: "000000026", reference: "4089", net: 20000, vat: 3600 }),
  row({ date: "03/09/26", code: "160", reference: "4087", net: 1000, vat: 180 }),
  row({ date: "01/09/26", code: "160", reference: "11375", net: 21674.29, vat: 0 }),
];
const october = () => [
  row({ date: "15/10/26", code: "202", party: "000000019", reference: "77", net: -100, vat: -18 }),
  row({ date: "08/10/26", code: "160", reference: "4090", net: 1000, vat: 180 }),
];
const declarations = (status = "closed") => [
  { month: "2026-09", status, rows: september() },
  { month: "2026-10", status, rows: october() },
];
const created = new Date(2026, 9, 24, 11, 0, 0);
const options = { vatId: "123456782", from: "2026-09", to: "2026-10", accounts, created };

test("the PCN874 file of a two-month period, byte for byte", () => {
  const result = buildPcn874({ ...options, declarations: declarations() });
  assert.deepEqual(result.problems, []);
  assert.equal(result.text, [
    "O123456782202610120261024+00000022000+000003960+00000000000+000000000000000003+00000021674+000001799+000000180000000004+00000001981",
    "S000000026202609240000000004089000003600+0000020000000000000",
    "T000000018202609020000000003412000000857+0000004759000000000",
    "T000000018202609010000000002372000000960+0000008000274028901",
    "T000000018202609070000000000057000000180+0000001000000000000",
    "T000000019202610150000000000077000000018-0000000100000000000",
    "L000000000202609010000000011375000000000+0000021674000000000",
    "L000000000202610310000000004090000000360+0000002000000000000",
    "X123456782",
    "",
  ].join("\r\n"));
  assert.ok(result.lines.every((line) => line.length === 60) && result.header.length === 131);
  // The totals of the opening record come from the VAT report (rounded sums), not from adding up the rounded lines.
  const { taxableSales, exemptSales, inputVat } = result.report;
  assert.deepEqual([taxableSales, exemptSales, inputVat], [22000, 21674, 1799]);
  assert.deepEqual(result.warnings, [{ code: "bad_check_digit", month: "2026-10", position: 1 }]);
});

test("the PCN874 file: one month, the opening record names it; an inactive row is left out", () => {
  const rows = september();
  rows[0].active = false;
  const result = buildPcn874({ ...options, from: "2026-09", to: "2026-09", declarations: declarations() });
  assert.equal(result.header.slice(10, 16), "202609");
  assert.equal(result.lines.filter((line) => line.startsWith("T")).length, 3);
  const without = buildPcn874({ ...options, to: "2026-09", declarations: [{ month: "2026-09", status: "closed", rows }] });
  assert.equal(without.lines.filter((line) => line.startsWith("T")).length, 2);
});

test("the PCN874 file is refused while a month is open, a number is missing or a PCN row is not approved", () => {
  const rows = september();
  rows[0].values[4] = "";
  rows[1].values[0] = "";
  rows[5].values[5] = "";
  const result = buildPcn874({ ...options, vatId: "", declarations: [{ month: "2026-09", status: "open", rows }],
    pcnRequired: true });
  assert.deepEqual(result.problems, [
    { code: "no_vat_id" },
    { code: "month_open", month: "2026-09" },
    // The lock button's rule: the car purchase and the two sales over the ceiling, none approved.
    { code: "pcn_blocked", month: "2026-09", count: 3 },
    { code: "no_reference", month: "2026-09", position: 6 },
    { code: "no_supplier", month: "2026-09", position: 1 },
    { code: "bad_date", month: "2026-09", position: 2 },
  ]);
  const huge = september();
  huge[5] = row({ date: "24/09/26", code: "160", party: "000000026", reference: "1", net: 99999999999, vat: 1 });
  const tooLong = buildPcn874({ ...options, declarations: [{ month: "2026-09", status: "closed", rows: huge }] });
  assert.ok(tooLong.problems.some((problem) => problem.code === "too_long"));
});

test("Rivhit's name of the file", () => {
  assert.equal(pcn874FileName("032138083", "2026-10"), "PCN874_32138083_202610.txt");
  assert.equal(pcn874FileName("51678675-3", "2026-09"), "PCN874_516786753_202609.txt");
});
