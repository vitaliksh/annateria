import test from "node:test";
import assert from "node:assert/strict";
import { createDeclaration, loadDeclaration, saveDraft } from "../declaration-store.js";
import { buildRowSnapshot } from "../row-builder.js";
import { normalizeRecord } from "../agent/fact-record.js";
import { reviewCounts, savedRowNeedsLook } from "../review-counts.js";
import { loadApp } from "./app-harness.mjs";
import { rawRecord } from "./agent-fixtures.mjs";
import { binaryDirectory } from "./memory-binary-directory.mjs";

const entry = { hash: "f".repeat(64), addedAt: "2026-10-16T08:00:00.000Z" };
const facts = { reasons: [], exclude: null, year: { year: 2026 }, duplicates: { level: null, matches: [] } };
const agentRow = (overrides = {}, extra = {}) => ({
  ...buildRowSnapshot({
    record: normalizeRecord(rawRecord(overrides)), entry, documentId: `agent-${overrides.document_number ?? "x"}`, decision: "expense", account: "202",
    facts, kind: "office", month: "2026-02", reason: "חשבונית", needsReview: false, agent: { run: "r1", version: "v1", fact: "F1.1" }, ...extra,
  }),
  imageFile: "001.jpg",
});
// The rows of a month: ready, to look at, off, left out and off, an Excel row (no original), a photo without marked regions.
const monthRows = () => [
  agentRow({ document_number: "R-1" }),
  agentRow({ document_number: "R-2" }, { needsReview: true }),
  agentRow({ document_number: "R-3" }, { decision: "unclear", account: null, needsReview: true }),
  agentRow({ document_number: "R-4" }, { decision: "unclear", account: null, needsReview: true, agent: { run: "r1", version: "v1", fact: "F1.4", leftOut: true } }),
  { ...agentRow({ document_number: "R-5" }), imageFile: "", agent: undefined, active: true, statusClass: "review" },
  { ...agentRow({ document_number: "R-6" }), agent: undefined, active: true, statusClass: "ready", highlights: [] },
];

test("a saved row is to look at by the toolbar's rule (C7)", () => {
  assert.deepEqual(monthRows().map(savedRowNeedsLook), [false, true, false, true, false, true]);
});

test("the saved count of a month equals what the page counts once the month is drawn", async () => {
  const client = binaryDirectory("Client");
  const created = await createDeclaration(client, { clientId: "c1", month: "2026-02" });
  await saveDraft(created.directory, created.declaration, monthRows());
  const [counted] = await reviewCounts([{ id: "c1", directory: client, declarations: [{ declaration: created.declaration }] }]);
  const { app, document } = await loadApp();
  const loaded = await loadDeclaration(client, "2026-02");
  const config = { clientId: "c1", clientName: "Client", businessActivity: "x", businessKind: "office" };
  await app.activateDeclaration({ workspace: { config, directory: client, parent: {} }, declaration: loaded.declaration, directory: loaded.directory, draft: loaded.draft });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const shown = [...document.querySelectorAll("#filter-menu .menu-panel button")].find((button) => button.dataset.filter === "review").textContent;
  assert.equal(counted.count, 3);
  assert.equal(shown, `לבדיקה · ${counted.count}`);
});

test("only open months that are not archived are read; a table that cannot be read is skipped; months come in order", async () => {
  const read = [];
  const load = async (directory, month) => {
    read.push(`${directory}|${month}`);
    if (month === "2026-04") throw new Error("broken");
    return { draft: { rows: month === "2026-01" ? [] : monthRows() } };
  };
  const declarations = (items) => items.map(([month, status = "open", archived = false]) => ({ declaration: { month, status, archived } }));
  const clients = [
    { id: "b", directory: "B", declarations: declarations([["2026-03"], ["2026-02", "closed"], ["2026-04"]]) },
    { id: "a", directory: "A", declarations: declarations([["2026-01"], ["2026-02"], ["2025-12", "open", true]]) },
  ];
  assert.deepEqual(await reviewCounts(clients, { load }), [{ clientId: "a", month: "2026-02", count: 3 }, { clientId: "b", month: "2026-03", count: 3 }]);
  assert.deepEqual(read.sort(), ["A|2026-01", "A|2026-02", "B|2026-03", "B|2026-04"]);
});
