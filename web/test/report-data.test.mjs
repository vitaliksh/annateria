import test from "node:test";
import assert from "node:assert/strict";
import { SEED_CHART_OF_ACCOUNTS, matchClassNames, normaliseChart } from "../chart-of-accounts.js";
import { buildImportedRows } from "../excel-import.js";
import { importRowsIntoDeclaration } from "../excel-import-store.js";
import { parseJournalGrid } from "../excel-journal.js";
import { loadReportDeclarations, normaliseReportSettings, readReportSettings, saveReportSettings } from "../report-data.js";
import { reportEntries, vatReport } from "../reports.js";
import { buildJournalGrid } from "./excel-journal-fixture.mjs";
import { memoryDirectory } from "./memory-directory.mjs";

const accounts = normaliseChart({ accounts: SEED_CHART_OF_ACCOUNTS });
const parsed = parseJournalGrid(buildJournalGrid()).rows;
const rows = () => buildImportedRows(parsed, matchClassNames(parsed.map((r) => r.classificationName), accounts).codes);

test("данные отчётов: настройки по умолчанию, сохранение и нормализация", async () => {
  const client = memoryDirectory("client");
  assert.deepEqual(await readReportSettings(client), { vatPeriod: "monthly", advancePercent: null });
  assert.deepEqual(await saveReportSettings(client, { vatPeriod: "bimonthly", advancePercent: "12" }), { vatPeriod: "bimonthly", advancePercent: 12 });
  assert.deepEqual(await readReportSettings(client), { vatPeriod: "bimonthly", advancePercent: 12 });
  assert.deepEqual(normaliseReportSettings({ vatPeriod: "weekly", advancePercent: 150 }), { vatPeriod: "monthly", advancePercent: null });
  assert.equal(normaliseReportSettings({ advancePercent: "" }).advancePercent, null);
  assert.equal(normaliseReportSettings({ advancePercent: 0 }).advancePercent, 0);
});

test("данные отчётов: все декларации клиента по месяцам, открытые и закрытые", async () => {
  const client = memoryDirectory("client");
  const now = "2026-10-02T10:00:00.000Z";
  await importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-02", rows: rows(), closeNow: true, now });
  await importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-01", rows: rows(), now });
  const declarations = await loadReportDeclarations(client);
  assert.deepEqual(declarations.map((item) => [item.month, item.status, item.rows.length]), [["2026-01", "open", 8], ["2026-02", "closed", 8]]);
  assert.equal(vatReport(reportEntries(declarations, accounts)).turnover, 20000);
});

test("данные отчётов: клиент без деклараций даёт пустой список", async () => {
  assert.deepEqual(await loadReportDeclarations(memoryDirectory("client")), []);
});
