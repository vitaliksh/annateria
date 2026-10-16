import test from "node:test";
import assert from "node:assert/strict";
import { SEED_CHART_OF_ACCOUNTS, matchClassNames, normaliseChart } from "../chart-of-accounts.js";
import { buildImportedRows } from "../excel-import.js";
import { parseJournalGrid } from "../excel-journal.js";
import { loadApp } from "./app-harness.mjs";
import { buildJournalGrid } from "./excel-journal-fixture.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));
const accounts = normaliseChart({ accounts: SEED_CHART_OF_ACCOUNTS });
const parsed = parseJournalGrid(buildJournalGrid()).rows;
const imported = () => buildImportedRows(parsed, matchClassNames(parsed.map((r) => r.classificationName), accounts).codes);

// Data root whose common/ folder holds only the chart of accounts (other mapping files are absent).
function rootWithChart(chart) {
  const notFound = () => Object.assign(new Error("missing"), { name: "NotFoundError" });
  const common = {
    getFileHandle: async (name) => {
      if (name !== "chart-of-accounts.json" || !chart) throw notFound();
      return { getFile: async () => ({ text: async () => JSON.stringify({ schemaVersion: 1, accounts: chart }) }) };
    },
  };
  return { getDirectoryHandle: async () => common };
}

test("импортированные строки без изображения восстанавливаются, суммы не меняются бизнес-правилами", async () => {
  const { app, rows } = await loadApp();
  for (const saved of imported()) app.restoreRow(saved, null);
  app.applyBusinessRules();
  const snapshots = rows().map((row) => plain(app.rowSnapshot(row)));
  assert.deepEqual(snapshots.map((row) => row.values), imported().map((row) => row.values));
  assert.equal(rows()[0].cells[13].textContent, "—");
});

test("коды плана счетов показываются названиями после загрузки корня", async () => {
  const { app, rows } = await loadApp();
  await app.loadCustomMapping(rootWithChart(SEED_CHART_OF_ACCOUNTS));
  app.restoreRow(imported()[0], null);
  const select = rows()[0].cells[1].querySelector("select");
  assert.equal(select.value, "203");
  assert.equal(select.selectedOptions[0].textContent, "אחזקה");
  assert.equal(app.nextFreeClassificationCode(), "901");
});

test("корень без плана счетов не меняет список кодов", async () => {
  const { app } = await loadApp();
  await app.loadCustomMapping(rootWithChart(null));
  assert.equal(app.nextFreeClassificationCode(), "889");
});

test("errors go to the status bar and no longer touch the sidebar summary", async () => {
  const { app, document } = await loadApp();
  const summary = document.querySelector("#workspace-summary");
  const before = summary.textContent;
  app.showError("something failed");
  assert.equal(document.querySelector("#status").textContent, "something failed");
  assert.equal(summary.textContent, before);
});
