import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { chartForClient, readChartOfAccounts, readClientChart, saveClientChart } from "../chart-of-accounts.js";
import { loadDeclaration } from "../declaration-store.js";
import { commitImport, prepareImport, recheckImport } from "../excel-import-flow.js";
import { buildJournalGrid, OTHER_CLIENT, SAMPLE_ROWS } from "./excel-journal-fixture.mjs";
import { memoryDirectory } from "./memory-directory.mjs";

const loadLibrary = async () => XLSX;
const now = "2026-10-02T10:00:00.000Z";

function xlsxFile(grid) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(grid), "גיליון2");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return { name: "journal.xlsx", size: bytes.byteLength, arrayBuffer: async () => bytes };
}

function setup() {
  const dataRoot = memoryDirectory("root");
  const client = { directory: memoryDirectory("client"), config: { clientId: "c1" } };
  return { dataRoot, client };
}

test("мастер импорта: подготовка даёт строки, итоги, месяц и предложение начального плана", async () => {
  const { dataRoot } = setup();
  const prepared = await prepareImport(xlsxFile(buildJournalGrid({ month: 8 })), { dataRoot, loadLibrary });
  assert.deepEqual(prepared.errors, []);
  assert.equal(prepared.rows.length, SAMPLE_ROWS.length);
  assert.equal(prepared.suggestedMonth, "2026-08");
  assert.equal(prepared.chartIsNew, true);
  assert.deepEqual(prepared.unknown, []);
  assert.deepEqual(prepared.totals, { net: 13520.5, vat: 1280.31, gross: 15840.19 });
});

test("мастер импорта: неизвестное имя класса требует счёта, импорт без него отвергается", async () => {
  const { dataRoot, client } = setup();
  const rows = SAMPLE_ROWS.map((row, i) => (i === 0 ? { ...row, cls: "ספרים" } : row));
  const prepared = await prepareImport(xlsxFile(buildJournalGrid({ rows })), { dataRoot, loadLibrary });
  assert.deepEqual(prepared.unknown, ["ספרים"]);
  const options = { month: "2026-01", closeNow: false, dataRoot, client, now };
  await assert.rejects(commitImport(prepared, options), /חסר קוד מיון/);
  assert.equal(await readChartOfAccounts(dataRoot), null);
  const result = await commitImport(prepared, { ...options, newAccounts: [{ name: "ספרים", code: "240", type: "expense" }] });
  assert.equal(result.rowCount, SAMPLE_ROWS.length);
  assert.equal((await readChartOfAccounts(dataRoot))[240].name, "ספרים");
  assert.equal((await loadDeclaration(client.directory, "2026-01")).draft.rows[0].values[1], "240");
});

test("мастер импорта: файл с ошибками не импортируется, ничего не записывается", async () => {
  const { dataRoot, client } = setup();
  const prepared = await prepareImport(xlsxFile(buildJournalGrid({ footer: { totalVat: "1.00" } })), { dataRoot, loadLibrary });
  assert.ok(prepared.errors.length);
  await assert.rejects(commitImport(prepared, { month: "2026-01", dataRoot, client, now }), /שגיאות/);
  assert.equal(await readChartOfAccounts(dataRoot), null);
  assert.equal(client.directory.children.size, 0);
});

test("мастер импорта: существующий план корня используется вместо начального, закрытие сразу", async () => {
  const { dataRoot, client } = setup();
  const first = await prepareImport(xlsxFile(buildJournalGrid()), { dataRoot, loadLibrary });
  await commitImport(first, { month: "2026-01", closeNow: true, dataRoot, client, now });
  const second = await prepareImport(xlsxFile(buildJournalGrid()), { dataRoot, loadLibrary });
  assert.equal(second.chartIsNew, false);
  const loaded = await loadDeclaration(client.directory, "2026-01");
  assert.equal(loaded.declaration.status, "closed");
});

test("мастер импорта: зарезервированный код нового счёта отвергается", async () => {
  const { dataRoot, client } = setup();
  const rows = SAMPLE_ROWS.map((row, i) => (i === 0 ? { ...row, cls: "ספרים" } : row));
  const prepared = await prepareImport(xlsxFile(buildJournalGrid({ rows })), { dataRoot, loadLibrary });
  const newAccounts = [{ name: "ספרים", code: "812", type: "expense" }];
  await assert.rejects(
    commitImport(prepared, { newAccounts, month: "2026-01", dataRoot, client, reserved: { 812: "x" }, now }),
    /אינם תקינים/,
  );
});

test("мастер импорта: типы клиента исправляют сверку итогов и сохраняются только для этого клиента", async () => {
  const { dataRoot, client } = setup();
  const file = () => xlsxFile(buildJournalGrid(OTHER_CLIENT));
  const prepared = await prepareImport(file(), { dataRoot, loadLibrary, clientId: "c1" });
  assert.deepEqual(prepared.unknown, ["ביגוד", "הכנסה חייבת"]);
  assert.equal(prepared.types["רכב רשוי וביטוח"], "expense");
  assert.ok(prepared.errors.some((error) => error.code === "footer-mismatch"));
  assert.deepEqual(prepared.suggested, { "ביגוד": "outsideVatBase", "הכנסה חייבת": "income", "רכב רשוי וביטוח": "outsideVatBase" });
  const newAccounts = [
    { name: "ביגוד", code: "240", type: "outsideVatBase" },
    { name: "הכנסה חייבת", code: "161", type: "income" },
  ];
  const typeChanges = [{ name: "רכב רשוי וביטוח", type: "outsideVatBase" }];
  const types = { ...prepared.types, "ביגוד": "outsideVatBase", "הכנסה חייבת": "income", "רכב רשוי וביטוח": "outsideVatBase" };
  assert.deepEqual(recheckImport(prepared, types), []);
  const options = { month: "2026-01", closeNow: false, dataRoot, client, now };
  await assert.rejects(commitImport(prepared, { ...options, newAccounts }), /שגיאות/);
  const result = await commitImport(prepared, { ...options, newAccounts, typeChanges });
  assert.equal(result.rowCount, OTHER_CLIENT.rows.length);
  const chart = await readChartOfAccounts(dataRoot);
  assert.deepEqual(chart[217], { name: "רכב רשוי וביטוח", type: "expense", clientTypes: { c1: "outsideVatBase" } });
  assert.equal(chartForClient(chart, "c2")[217].type, "expense");
  const again = await prepareImport(file(), { dataRoot, loadLibrary, clientId: "c1" });
  assert.deepEqual([again.unknown, again.errors, again.suggested], [[], [], {}]);
  const other = await prepareImport(file(), { dataRoot, loadLibrary, clientId: "c2" });
  assert.ok(other.errors.some((error) => error.key === "inputsGross"));
});

test("мастер импорта: у клиента свой план — импорт идёт по нему, новые классы и типы пишутся ему, общий план не трогают", async () => {
  const { dataRoot, client } = setup();
  await saveClientChart(client.directory, {
    110: { name: "הכנסות", type: "income" },
    301: { name: "אחזקה", type: "expense" },
    302: { name: "חשמל", type: "expense" },
    303: { name: "חניה פנגו", type: "expense" },
    304: { name: "טלפון סלולרי", type: "expense" },
    305: { name: "ארנונה", type: "outsideVatBase" },
    900: { name: "רכישת ציוד/רכוש קבוע", type: "equipment" },
  });
  const rows = SAMPLE_ROWS.map((row, i) => (i === 0 ? { ...row, cls: "ספרים" } : row));
  // This client's Rivhit keeps electricity outside the input base, so the footer of the file says so.
  const grid = buildJournalGrid({ rows, outside: ["ביטוח עסק", "ארנונה", "חשמל"] });
  const prepared = await prepareImport(xlsxFile(grid), { dataRoot, loadLibrary, clientId: "c1", clientDirectory: client.directory });
  assert.equal(prepared.chartScope, "client");
  assert.equal(prepared.suggested["חשמל"], "outsideVatBase");
  assert.deepEqual(prepared.unknown, ["ספרים"]);
  const result = await commitImport(prepared, { month: "2026-01", dataRoot, client, newAccounts: [{ name: "ספרים", code: "240", type: "expense" }], typeChanges: [{ name: "חשמל", type: "outsideVatBase" }], now });
  assert.equal(result.chart[240].name, "ספרים");
  assert.equal(await readChartOfAccounts(dataRoot), null, "the shared chart is untouched");
  const saved = await readClientChart(client.directory);
  assert.deepEqual([saved[240].type, saved[302].type, saved[302].clientTypes], ["expense", "outsideVatBase", undefined]);
  const codes = (await loadDeclaration(client.directory, "2026-01")).draft.rows.map((row) => row.values[1]);
  assert.deepEqual([codes[0], codes[1], codes.at(-1)], ["240", "302", "110"]);
});
