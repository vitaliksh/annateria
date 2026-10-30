import test from "node:test";
import assert from "node:assert/strict";
import { SEED_CHART_OF_ACCOUNTS, matchClassNames, normaliseChart } from "../chart-of-accounts.js";
import { buildImportedRows, importWarnings } from "../excel-import.js";
import { parseJournalGrid } from "../excel-journal.js";
import { recognisedAmounts } from "../row-calculations.js";
import { buildJournalGrid } from "./excel-journal-fixture.mjs";

const accounts = normaliseChart({ accounts: SEED_CHART_OF_ACCOUNTS });
const parsed = parseJournalGrid(buildJournalGrid()).rows;
const options = { now: "2026-10-02T10:00:00.000Z", makeId: () => "id" };
const build = (rows = parsed) => buildImportedRows(rows, matchClassNames(rows.map((r) => r.classificationName), accounts).codes, options);

test("импорт Excel: расход переносится как исходные суммы с признанием 100/100", () => {
  const [row] = build();
  assert.deepEqual(row.values, ["01/01/26", "203", "Shop A", "Shop A", "", "1001", "", "118.00", "100.00", "18.00", "100", "100"]);
  assert.deepEqual([row.rawNet, row.rawVat, row.vatPercent, row.imageFile, row.active], ["100.00", "18.00", "18", "", true]);
  assert.equal(row.documentId, "import-1-id");
});

test("импорт Excel: уже сниженный НДС (66.67 %) не снижается второй раз", () => {
  const row = build()[3];
  assert.equal(row.vatPercent, "11.33");
  assert.deepEqual(recognisedAmounts(row.rawNet, row.rawVat, 100, 100), { gross: "100.20", net: "90.00", vat: "10.20" });
});

test("импорт Excel: кредит-нота получает отрицательные нетто, НДС и брутто", () => {
  const row = build()[5];
  assert.deepEqual([row.values[7], row.values[8], row.values[9]], ["-23.60", "-20.00", "-3.60"]);
  assert.deepEqual(recognisedAmounts(row.rawNet, row.rawVat, 100, 100), { gross: "-23.60", net: "-20.00", vat: "-3.60" });
});

test("импорт Excel: доход и пустая ссылка 1", () => {
  const rows = build();
  assert.equal(rows[7].values[1], "160");
  assert.equal(rows[1].values[5], "");
  assert.equal(rows[2].vatPercent, "0");
});

test("импорт Excel: без кода для имени класса строки не создаются", () => {
  assert.throws(() => buildImportedRows(parsed, { אחזקה: "203" }, options), /חסר קוד מיון/);
});

test("импорт Excel: ссылка 2 не теряется молча", () => {
  assert.deepEqual(importWarnings(parsed), []);
  assert.deepEqual(importWarnings([{ reference2: "9" }, { reference2: "" }]).map((w) => w.code), ["reference2-dropped"]);
});

test("every imported row keeps the hash of its file when one is given, and is booked", () => {
  const parsedRows = [{ kind: "expense", net: 100, vat: -18, gross: 118, date: "2026-01-01", details: "Shop A", classificationName: "x", reference1: "1001" }];
  const [withSource] = buildImportedRows(parsedRows, { x: "203" }, { now: "2026-10-30T00:00:00.000Z", makeId: () => "id", sourceHash: "a".repeat(64) });
  assert.deepEqual([withSource.sourceHash, withSource.booked], ["a".repeat(64), true]);
  const [without] = buildImportedRows(parsedRows, { x: "203" }, { now: "2026-10-30T00:00:00.000Z", makeId: () => "id" });
  assert.equal("sourceHash" in without, false);
});

test("a credit note of income keeps VAT with the sign of its net, as the file does (Anna's journal 8/2026, invoice 140)", () => {
  const credit = { kind: "income", net: -403.63, vat: -72.65, gross: -476.28, date: "2026-07-09", details: "הכנסות", classificationName: "הכנסות", reference1: "140" };
  const sale = { ...credit, net: 24517.95, vat: 4413.23, gross: 28931.18, reference1: "139" };
  const [creditRow, saleRow] = buildImportedRows([credit, sale], { "הכנסות": "160" }, { now: "2026-10-30T00:00:00.000Z", makeId: () => "id" });
  assert.deepEqual(creditRow.values.slice(7, 10), ["-476.28", "-403.63", "-72.65"]);
  assert.equal(creditRow.rawVat, "-72.65");
  assert.deepEqual(saleRow.values.slice(7, 10), ["28931.18", "24517.95", "4413.23"]);
});
