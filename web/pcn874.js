// The PCN874 file of a period: the detailed VAT report of a client with the PCN duty, in the fixed layout of the Tax
// Authority (docs/PCN874_SPEC.md). Pure; no DOM, no file access. The app writes the file; it never sends it.
import { dateKey } from "./intake-facts.js";
import { lockProblems } from "./lock-check.js";
import { monthsInPeriod, reportEntries, vatReport } from "./reports.js";
import { taxIdProblem } from "./workspace-core.js";

// Positions of a saved row's values (rowSnapshot in app.js).
const DATE = 0;
const PARTY = 4;
const REFERENCE = 5;
const ALLOCATION = 6;

const digits = (value) => String(value ?? "").replace(/\D/g, "");
const lastNine = (value) => digits(value).slice(-9);
const yyyymmdd = (text) => dateKey(text)?.replaceAll("-", "") ?? "";

// "2026-10" -> "20261031"
function lastDayOf(month) {
  const [year, number] = month.split("-").map(Number);
  return `${month.replace("-", "")}${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, "0")}`;
}

// The fields of one record are written by `field`; a value that does not fit its width is reported, not cut.
function writer(problems) {
  const number = (value, width, what) => {
    const text = String(Math.round(Math.abs(Number(value) || 0)));
    if (text.length > width) problems.push({ code: "too_long", what });
    return text.padStart(width, "0").slice(-width);
  };
  const sign = (value) => (Math.round(Number(value) || 0) < 0 ? "-" : "+");
  return { number, signed: (value, width, what) => sign(value) + number(value, width, what) };
}

// One file line of a row or of an aggregated group of rows.
function documentLine(kind, { party = "", date, reference, vat, net, allocation = "" }, field) {
  const credit = net < 0 || vat < 0;
  return [
    kind,
    digits(party).padStart(9, "0").slice(-9),
    date,
    "0000",
    lastNine(reference).padStart(9, "0"),
    field.number(vat, 9, "vat"),
    credit ? "-" : "+",
    field.number(net, 10, "net"),
    lastNine(allocation).padStart(9, "0"),
  ].join("");
}

// The rows of the period with what the file needs: the kind from the chart (as the reports), the recognised VAT, the net at
// 100 %. declarations: [{ month, status, rows }] in the draft-table format.
function fileRows(declarations, accounts, names) {
  return declarations.flatMap((declaration) => declaration.rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.active)
    .map(({ row, index }) => {
      const [entry] = reportEntries([{ ...declaration, rows: [row] }], accounts, names);
      const values = row.values ?? [];
      const net = Number(row.rawNet) || entry.net;
      return {
        month: declaration.month, position: index, type: entry.type, vat: entry.vat,
        net: entry.net < 0 && net > 0 ? -net : net,
        party: values[PARTY], date: values[DATE], reference: row.reference || values[REFERENCE],
        allocation: values[ALLOCATION],
      };
    }));
}

// The aggregated L line of sales rows without a customer number (Anna, 24 October 2026): a single row keeps its date and
// number; several rows get the last day of the period and the number of the last document.
function aggregate(rows, to) {
  if (rows.length === 1) {
    const [only] = rows;
    return { date: yyyymmdd(only.date), reference: only.reference, vat: only.vat, net: only.net };
  }
  const ordered = [...rows].sort((a, b) => (dateKey(a.date) ?? "").localeCompare(dateKey(b.date) ?? ""));
  const total = (key) => Math.round(rows.reduce((sum, row) => sum + row[key], 0) * 100) / 100;
  return { date: lastDayOf(to), reference: ordered.at(-1).reference, vat: total("vat"), net: total("net") };
}

// { text, lines, header, problems, warnings }. problems: refusals ([{ code, month?, position?, count? }]): the file must not be
// written while there is one. warnings: shown only. from, to: "yyyy-mm"; created: the creation date of the file.
export function buildPcn874({
  vatId, from, to, declarations, accounts = {}, names = {}, pcnRequired = false, created = new Date(),
}) {
  const problems = [];
  const warnings = [];
  const field = writer(problems);
  const months = new Set(monthsInPeriod(from, to));
  const inPeriod = declarations.filter((declaration) => months.has(declaration.month));
  if (digits(vatId).length !== 9) problems.push({ code: "no_vat_id" });
  for (const declaration of inPeriod) {
    if (declaration.status !== "closed") problems.push({ code: "month_open", month: declaration.month });
    const blocked = lockProblems(declaration.rows, { pcnRequired }).find((problem) => problem.code === "pcn_blocked");
    if (blocked) problems.push({ code: "pcn_blocked", month: declaration.month, count: blocked.count });
  }

  const rows = fileRows(inPeriod, accounts, names);
  const where = (row) => ({ month: row.month, position: row.position + 1 });
  const checked = (row, kind) => {
    const date = yyyymmdd(row.date);
    if (!date) problems.push({ code: "bad_date", ...where(row) });
    if (!digits(row.reference)) problems.push({ code: "no_reference", ...where(row) });
    if (kind === "T" && !digits(row.party)) problems.push({ code: "no_supplier", ...where(row) });
    if (digits(row.party) && taxIdProblem(digits(row.party).padStart(9, "0"), { checkDigit: true })) {
      warnings.push({ code: "bad_check_digit", ...where(row) });
    }
    return { ...row, date };
  };
  const sales = rows.filter((row) => row.type === "income");
  const identified = sales.filter((row) => digits(row.party)).map((row) => documentLine("S", checked(row, "S"), field));
  const inputs = rows.filter((row) => ["expense", "equipment"].includes(row.type) && row.vat)
    .map((row) => documentLine("T", checked(row, "T"), field));
  const unidentified = sales.filter((row) => !digits(row.party));
  const groups = [unidentified.filter((row) => row.vat), unidentified.filter((row) => !row.vat)]
    .filter((group) => group.length);
  for (const row of unidentified) checked(row, "L");
  const aggregated = groups.map((group) => documentLine("L", aggregate(group, to), field))
    .sort((a, b) => a.slice(10, 18).localeCompare(b.slice(10, 18)));

  const report = vatReport(inPeriod.flatMap((declaration) => reportEntries([declaration], accounts, names)));
  const salesLines = [...identified, ...aggregated];
  const header = [
    "O",
    digits(vatId).padStart(9, "0").slice(-9),
    to.replace("-", ""),
    "1",
    [created.getFullYear(), created.getMonth() + 1, created.getDate()]
      .map((part) => String(part).padStart(2, "0")).join(""),
    field.signed(report.taxableSales, 11, "taxableSales"),
    field.signed(report.outputVat, 9, "outputVat"),
    `+${"0".repeat(11)}`,
    `+${"0".repeat(9)}`,
    field.number(salesLines.length, 9, "salesCount"),
    field.signed(report.exemptSales, 11, "exemptSales"),
    field.signed(report.inputVat, 9, "inputVat"),
    field.signed(report.equipmentVat, 9, "equipmentVat"),
    field.number(inputs.length, 9, "inputCount"),
    field.signed(report.payable, 11, "payable"),
  ].join("");
  const lines = [...identified, ...inputs, ...aggregated];
  const closing = `X${digits(vatId).padStart(9, "0").slice(-9)}`;
  const text = [header, ...lines, closing].map((line) => `${line}\r\n`).join("");
  return { text, header, lines, closing, report, problems, warnings };
}

// Rivhit's name of the file: PCN874_<dealer>_<yyyymm>.txt (the dealer number without the zeros in front, as in its files).
export function pcn874FileName(vatId, to) {
  return `PCN874_${digits(vatId).replace(/^0+/, "")}_${to.replace("-", "")}.txt`;
}
