import test from "node:test";
import assert from "node:assert/strict";
import { saveClientChart } from "../chart-of-accounts.js";
import { createDeclaration, finalizeDeclaration, loadDeclaration, saveDraft } from "../declaration-store.js";
import { BATCH_SIZE, agentRow, backupTable, buildPlan, excludeText, recheckIntake, runBookkeeper } from "../bookkeeper-flow.js";
import { binaryDirectory, listPaths } from "./memory-binary-directory.mjs";

const today = new Date(2026, 9, 10);
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

const answer = (results) => async (body) => ({ results: body.rows.map((row, index) => ({ n: row.n, decision: "expense", rivhit_code: "204", needs_review: false, reason: "חשמל", ...(results[index] ?? {}) })) });

test("the request carries the client, its own chart, the rows with source amounts and the software facts", async () => {
  const { client } = await setup();
  const bodies = [];
  const snapshots = [snapshot("a", "12/09/26", 118, { documentKind: "expense_invoice", documentTitle: "חשבון", periodFrom: "2026-07-01", periodTo: "2026-08-31" })];
  const plans = await runBookkeeper({ client, month: "2026-09", snapshots, waiting: [0], call: async (body) => (bodies.push(body), answer([])(body)), today });
  assert.equal(bodies.length, 1);
  const [body] = bodies;
  assert.deepEqual(body.client, { activity: "pilates", kind: "home" });
  assert.equal(body.declarationMonth, "2026-09");
  assert.deepEqual(body.chart, [{ code: "204", name: "חשמל", type: "expense" }, { code: "206", name: "ביטוח עסק", type: "outsideVatBase" }]);
  assert.deepEqual(body.rows[0], {
    n: 1, document_kind: "expense_invoice", document_title: "חשבון", date: "12/09/26", supplier_name: "חברת החשמל לישראל בע״מ",
    supplier_vat_id: "520000472", reference: "5501", purpose: "חשמל", total: 118, net: 100, vat: 18, period_from: "2026-07-01",
    period_to: "2026-08-31", ocr_code: "", facts: { year: "ok", duplicate: null, exclude: null, deduction: "ok" },
  });
  assert.equal(plans.length, 1);
});

test("a client without its own chart sends an empty chart", async () => {
  const { client } = await setup({ chart: false });
  let sent;
  await runBookkeeper({ client, month: "2026-09", snapshots: [snapshot("a", "12/09/26", 118)], waiting: [0], call: async (body) => ((sent = body), answer([])(body)), today });
  assert.deepEqual(sent.chart, []);
});

test("plans: what the code excluded, what the agent decided and how each row is described", async () => {
  const { client } = await setup();
  const snapshots = [
    snapshot("ok", "12/09/26", 118, { reference: "100" }),
    snapshot("dup", "12/02/26", 90, { reference: "9001" }),
    snapshot("tax", "14/09/26", 500, { reference: "200" }),
    snapshot("nocode", "14/09/26", 77, { reference: "300" }),
    snapshot("old", "20/12/25", 60, { reference: "400" }),
    snapshot("review", "15/09/26", 33, { reference: "500" }),
    snapshot("late", "02/01/26", 44, { reference: "600" }),
  ];
  const plans = await runBookkeeper({
    client, month: "2026-09", snapshots, waiting: snapshots.map((_, index) => index), today,
    call: answer([{}, {}, { decision: "not_expense", rivhit_code: null, reason: "תשלום מס" }, { rivhit_code: null }, {}, { needs_review: true }, {}]),
  });
  const view = plans.map((plan) => [plan.include, plan.exclude, plan.statusText, plan.rivhitCode]);
  assert.deepEqual(view, [
    [true, "", null, "204"],
    [false, "duplicate", "כפילות — המסמך כבר הוזן ב‑02/2026 (הצהרה נעולה)", "204"],
    [false, "", "לא הוצאה — נדרש אישור", null],
    [false, "", "נדרש קוד מיון", null],
    [false, "previous-year", "מסמך משנה קודמת (2025) — לבדוק את התאריך; אפשר לכלול ידנית", "204"],
    [true, "", "נדרש עיון", "204"],
    [true, "", null, "204"],
  ]);
  assert.equal(plans[1].wouldInclude, true);
  assert.equal(plans[6].facts.deduction, "late");
  assert.match(plans[6].reason, /חלפו יותר מ‑6 חודשים/);
  assert.equal(plans[0].review, false);
  assert.equal(plans[2].review, true);
});

test("a copy in the same table is a duplicate of the row above it", async () => {
  const { client } = await setup();
  const snapshots = [snapshot("a", "12/09/26", 118), snapshot("b", "12/09/26", 118)];
  const plans = await runBookkeeper({ client, month: "2026-09", snapshots, waiting: [0, 1], call: answer([]), today });
  assert.deepEqual(plans.map((plan) => plan.exclude), ["", "duplicate"]);
  assert.equal(plans[1].statusText, "כפילות של שורה 1 בהצהרה זו");
});

test("many rows go in batches; a failing batch rejects after the earlier ones were handed over", async () => {
  const rows = Array.from({ length: BATCH_SIZE + 5 }, (_, index) => snapshot(`r${index}`, "12/09/26", 100 + index, { reference: String(1000 + index) }));
  const { client } = await setup({ rows });
  const sizes = [];
  const applied = [];
  await runBookkeeper({ client, month: "2026-09", snapshots: rows, waiting: rows.map((_, index) => index), call: async (body) => (sizes.push(body.rows.length), answer([])(body)), onBatch: (batch) => applied.push(batch.length), today });
  assert.deepEqual(sizes, [BATCH_SIZE, 5]);
  assert.deepEqual(applied, [BATCH_SIZE, 5]);
  let calls = 0;
  const handed = [];
  await assert.rejects(
    runBookkeeper({ client, month: "2026-09", snapshots: rows, waiting: rows.map((_, index) => index), today, onBatch: (batch) => handed.push(batch.length), call: async (body) => { if (++calls === 2) throw new Error("boom"); return answer([])(body); } }),
    /boom/,
  );
  assert.deepEqual(handed, [BATCH_SIZE]);
});

test("a missing answer for a row is unclear and needs a look", () => {
  const facts = { year: { status: "ok", year: 2026 }, duplicates: { level: null, matches: [] }, exclude: null, deduction: "ok" };
  const plan = buildPlan(3, facts, undefined, "2026-09");
  assert.deepEqual([plan.decision, plan.include, plan.statusText, plan.review], ["unclear", false, "נדרש עיון", true]);
  assert.equal(excludeText({ ...facts, exclude: "duplicate" }, "2026-09"), "כפילות — המסמך כבר הוזן");
});

test("a table without source amounts uses the amounts shown", () => {
  const facts = { year: { status: "ok" }, duplicates: { level: null, matches: [] }, exclude: null, deduction: "ok" };
  const row = agentRow({ documentId: "x", values: ["01/09/26", "", "", "ספק", "", "7", "", "118.00", "100.00", "18.00"] }, 4, facts);
  assert.deepEqual([row.n, row.total, row.net, row.vat], [4, 118, 100, 18]);
});

test("the table is copied before the agent changes it", async () => {
  const { client, directory } = await setup();
  await backupTable(client, "2026-09", "2026-10-10T11:12:13.000Z");
  const copies = (await listPaths(directory)).filter((path) => path.includes("before-agent"));
  assert.equal(copies.length, 1);
  assert.match(copies[0], /declarations\/2026-09\/draft-table\.before-agent-2026-10-10T11-12-13-000Z\.json$/);
  const saved = (await loadDeclaration(directory, "2026-09")).draft.rows;
  assert.equal(saved.length, 1);
});

test("a corrected date lifts the previous-year exclusion", async () => {
  const { client } = await setup();
  const wrong = [snapshot("a", "12/09/25", 118)];
  assert.equal((await recheckIntake({ client, month: "2026-09", snapshots: wrong, index: 0, today })).exclude, "previous-year");
  const fixed = [snapshot("a", "12/09/26", 118)];
  assert.equal((await recheckIntake({ client, month: "2026-09", snapshots: fixed, index: 0, today })).exclude, null);
});
