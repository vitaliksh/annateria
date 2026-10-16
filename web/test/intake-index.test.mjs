import test from "node:test";
import assert from "node:assert/strict";
import { createDeclaration, finalizeDeclaration, saveDraft } from "../declaration-store.js";
import { intakeFacts } from "../intake-facts.js";
import { loadIntakeContext } from "../intake-index.js";
import { binaryDirectory } from "./memory-binary-directory.mjs";

const today = new Date(2026, 8, 15);
const NOW = "2026-09-15T10:00:00.000Z";
const row = (id, date, gross, extra = {}) => ({
  documentId: id,
  receivedAt: NOW,
  values: [date, "204", "חשמל", "חברת החשמל לישראל בע״מ", "520000472", "5501", "", gross.toFixed(2), "100.00", "18.00", "100", "100"],
  active: true,
  ...extra,
});

async function setup() {
  const directory = binaryDirectory("client");
  const february = await createDeclaration(directory, { clientId: "c1", month: "2026-02" });
  const rows = [row("feb-1", "12/02/26", 118), row("feb-2", "13/02/26", 50, { active: false })];
  await saveDraft(february.directory, february.declaration, rows, NOW);
  await finalizeDeclaration({ clientDirectory: directory, declarationDirectory: february.directory, declaration: february.declaration, finalExport: "excel-import", rows });
  const september = await createDeclaration(directory, { clientId: "c1", month: "2026-09" });
  await saveDraft(september.directory, september.declaration, [row("sep-1", "20/09/26", 70)], NOW);
  return directory;
}

test("the context holds the active rows of locked and open months and the last locked month", async () => {
  const context = await loadIntakeContext(await setup());
  assert.equal(context.lockedThrough, "2026-02");
  assert.deepEqual(context.declarations.map((item) => [item.month, item.status]).sort(), [["2026-02", "closed"], ["2026-09", "open"]]);
  const found = context.entries.map((entry) => [entry.month, entry.status, entry.documentId, entry.position]).sort();
  assert.deepEqual(found, [["2026-02", "closed", "feb-1", 0], ["2026-09", "open", "sep-1", 0]]);
});

test("months supplied by the caller are not read from disk", async () => {
  const context = await loadIntakeContext(await setup(), { skipMonths: ["2026-09"] });
  assert.deepEqual(context.entries.map((entry) => entry.documentId), ["feb-1"]);
  assert.equal(context.declarations.length, 2);
});

test("September: an invoice for February that was already filed is found in the locked month", async () => {
  const context = await loadIntakeContext(await setup());
  const facts = intakeFacts({ row: row("new", "12/02/26", 118), month: "2026-09", position: 1 }, { ...context, today });
  assert.deepEqual([facts.exclude, facts.duplicates.level, facts.duplicates.matches[0].month, facts.duplicates.matches[0].status], ["duplicate", "strong", "2026-02", "closed"]);
  const other = intakeFacts({ row: row("new", "12/02/26", 120), month: "2026-09", position: 1 }, { ...context, today });
  assert.equal(other.exclude, null);
});
