import test from "node:test";
import assert from "node:assert/strict";
import { saveClientChart } from "../chart-of-accounts.js";
import { createDeclaration, finalizeDeclaration, loadDeclaration, saveDraft } from "../declaration-store.js";
import { backupTable } from "../table-backup.js";
import { binaryDirectory, listPaths } from "./memory-binary-directory.mjs";

const NOW = "2026-10-10T10:00:00.000Z";

// A table row in the draft-table format: date, code, details, supplier, supplier ID, reference, allocation, gross, net, VAT.
const snapshot = (id, date, gross, extra = {}) => ({
  documentId: id,
  receivedAt: NOW,
  active: true,
  values: [date, "", "חשמל", "חברת החשמל לישראל בע״מ", "520000472", "5501", "", gross.toFixed(2), (gross / 1.18).toFixed(2), "0", "100", "100"],
  rawNet: Number((gross / 1.18).toFixed(2)),
  rawVat: Number((gross - gross / 1.18).toFixed(2)),
  ...extra,
});

async function setup({ chart = true, rows = [snapshot("a", "12/09/26", 118)] } = {}) {
  const directory = binaryDirectory("client");
  const client = { directory, config: { clientId: "c1", businessActivity: "pilates", businessKind: "home" } };
  const february = await createDeclaration(directory, { clientId: "c1", month: "2026-02" });
  const filed = [snapshot("feb", "12/02/26", 90, { reference: "9001" })];
  await saveDraft(february.directory, february.declaration, filed, NOW);
  await finalizeDeclaration({ clientDirectory: directory, declarationDirectory: february.directory, declaration: february.declaration, finalExport: "excel-import", rows: filed, now: NOW });
  // August is filed too, so a document of an earlier month moves to September.
  const august = await createDeclaration(directory, { clientId: "c1", month: "2026-08" });
  await saveDraft(august.directory, august.declaration, [], NOW);
  await finalizeDeclaration({ clientDirectory: directory, declarationDirectory: august.directory, declaration: august.declaration, finalExport: "excel-import", rows: [], now: NOW });
  const september = await createDeclaration(directory, { clientId: "c1", month: "2026-09" });
  await saveDraft(september.directory, september.declaration, rows, NOW);
  if (chart) await saveClientChart(directory, { 204: { name: "חשמל", type: "expense" }, 206: { name: "ביטוח עסק", type: "outsideVatBase" } });
  return { directory, client };
}

test("the table is copied before the agent changes it", async () => {
  const { client, directory } = await setup();
  await backupTable(client, "2026-09", "2026-10-10T11:12:13.000Z");
  const copies = (await listPaths(directory)).filter((path) => path.includes("before-agent"));
  assert.equal(copies.length, 1);
  assert.match(copies[0], /declarations\/2026-09\/draft-table\.before-agent-2026-10-10T11-12-13-000Z\.json$/);
  const saved = (await loadDeclaration(directory, "2026-09")).draft.rows;
  assert.equal(saved.length, 1);
});
