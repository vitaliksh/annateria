import test from "node:test";
import assert from "node:assert/strict";
import { REFUSALS, applyProposal } from "../proposal-apply.js";
import { buildRowSnapshot } from "../row-builder.js";
import { normalizeRecord } from "../agent/fact-record.js";
import { createDeclaration, loadDeclaration, saveDraft } from "../declaration-store.js";
import { loadApp } from "./app-harness.mjs";
import { rawRecord } from "./agent-fixtures.mjs";
import { binaryDirectory } from "./memory-binary-directory.mjs";

const change = (field, value, extra = {}) => ({ row: "R1", documentId: "doc-1", month: "2026-02", position: 2, field, value, reason: "r", ...extra });

// Operations that only write down what was asked of them.
function recorder({ locked = false, month = "2026-02", ids = ["doc-0", "doc-1"] } = {}) {
  const calls = [];
  const rows = ids.map((id) => ({ dataset: { documentId: id }, id }));
  const ops = {
    locked: () => locked, month: () => month, rows: () => rows,
    setText: (row, cell, text) => calls.push(["text", row.id, cell, text]),
    setReference: (row, full) => calls.push(["reference", row.id, full]),
    setAmount: (row, column, value) => calls.push(["amount", row.id, column, value]),
    setAccount: (row, code) => calls.push(["account", row.id, code]),
    setPercent: (row, role, value) => calls.push(["percent", row.id, role, value]),
    setInclude: (row, flag) => calls.push(["include", row.id, flag]),
    edited: (row) => calls.push(["edited", row.id]),
  };
  return { ops, calls };
}

test("every field goes to the cell or the function that the table uses for it", () => {
  const { ops, calls } = recorder();
  const result = applyProposal({ changes: [
    change("date", "2026-03-14"), change("purpose", "paper"), change("supplier_name", "Paper Shop"), change("supplier_vat_id", "512345679"),
    change("allocation_number", "123456789"), change("document_number", "INV-2002"), change("total", 236), change("net", 200), change("vat", 36),
    change("account", "202"), change("vat_recognized_percent", 66.67), change("expense_recognized_percent", 25), change("include", false),
  ] }, ops);
  assert.equal(result.applied.length, 13);
  assert.deepEqual(result.refused, []);
  assert.deepEqual(calls.filter(([kind]) => kind !== "edited"), [
    ["text", "doc-1", 2, "14/03/26"], ["text", "doc-1", 3, "paper"], ["text", "doc-1", 4, "Paper Shop"], ["text", "doc-1", 5, "512345679"],
    ["text", "doc-1", 7, "123456789"], ["reference", "doc-1", "INV-2002"], ["text", "doc-1", 6, "2002"], ["amount", "doc-1", 8, 236], ["amount", "doc-1", 9, 200],
    ["amount", "doc-1", 10, 36], ["account", "doc-1", "202"], ["percent", "doc-1", "vat", 66.67], ["percent", "doc-1", "expense", 25], ["include", "doc-1", false],
  ]);
  assert.deepEqual(calls.filter(([kind]) => kind === "edited"), [["edited", "doc-1"]], "a row is told it was edited once, after all its changes");
});

test("a text that is empty clears the cell; a reference without digits is shown as it is", () => {
  const { ops, calls } = recorder();
  applyProposal({ changes: [change("allocation_number", ""), change("document_number", "ABC")] }, ops);
  assert.deepEqual(calls.filter(([kind]) => kind === "text"), [["text", "doc-1", 7, ""], ["text", "doc-1", 6, "ABC"]]);
});

test("a change is refused, not guessed: locked table, another month, a row that is no longer there, a move of month", () => {
  const refuse = (changes, options) => applyProposal({ changes }, recorder(options).ops).refused.map((item) => item.reason);
  assert.deepEqual(refuse([change("purpose", "x")], { locked: true }), [REFUSALS.locked]);
  assert.deepEqual(refuse([change("purpose", "x", { month: "2026-05" })]), [REFUSALS.other_month("2026-05")]);
  assert.match(REFUSALS.other_month("2026-05"), /05\/2026/);
  assert.deepEqual(refuse([change("purpose", "x", { documentId: "doc-9" })]), [REFUSALS.changed], "another row now stands at that number");
  assert.deepEqual(refuse([change("purpose", "x", { position: 9 })]), [REFUSALS.changed], "the table is shorter now");
  assert.deepEqual(refuse([change("purpose", "x", { position: 0 })]), [REFUSALS.changed]);
  assert.deepEqual(refuse([change("month", "2026-03")]), [REFUSALS.month_move]);
  assert.match(refuse([change("colour", "red")])[0], /שדה לא נתמך/);
});

test("the good changes of a proposal are applied even when another one is refused", () => {
  const { ops, calls } = recorder();
  const result = applyProposal({ changes: [change("purpose", "ok"), change("purpose", "stale", { documentId: "doc-9" }), change("include", true, { position: 1, documentId: "doc-0" })] }, ops);
  assert.deepEqual([result.applied.length, result.refused.length], [2, 1]);
  assert.deepEqual(calls.filter(([kind]) => kind === "edited").map(([, id]) => id).sort(), ["doc-0", "doc-1"]);
});

// --- on the real table of the page ---

const snapshot = (overrides, extra = {}) => buildRowSnapshot({
  record: normalizeRecord(rawRecord(overrides)), entry: { hash: "f".repeat(64), addedAt: "2026-10-16T08:00:00.000Z" }, documentId: "doc-a", decision: "expense", account: "202",
  facts: { reasons: [], exclude: null, year: { year: 2026 }, duplicates: { level: null, matches: [] } }, kind: "office", month: "2026-02", reason: "r", needsReview: false,
  agent: { run: "r1", version: "v1", fact: "F1.1" }, ...extra,
});

async function openedPage(kind = "office") {
  const page = await loadApp({ businessKind: kind });
  const client = binaryDirectory("Client");
  const created = await createDeclaration(client, { clientId: "c1", month: "2026-02" });
  await saveDraft(created.directory, created.declaration, []);
  const loaded = await loadDeclaration(client, "2026-02");
  const config = { clientId: "c1", clientName: "Client", businessActivity: "x", businessKind: kind };
  await page.app.activateDeclaration({ workspace: { config, directory: client, parent: {} }, declaration: loaded.declaration, directory: loaded.directory, draft: loaded.draft });
  page.app.appendSnapshots([snapshot({}, { documentId: "doc-a" }), snapshot({ document_number: "INV-77", net: 100, vat: 18, total: 118 }, { documentId: "doc-b" })]);
  return page;
}
const proposalOf = (changes) => ({ changes: changes.map((item) => ({ row: "R1", reason: "r", month: "2026-02", documentId: "doc-b", position: 2, ...item })) });

test("on the table of the page: a correction is typed into the row, the amounts follow, the draft is saved", async () => {
  const { app, rows } = await openedPage();
  const result = app.applyProposalToTable(proposalOf([{ field: "date", value: "2026-02-25" }, { field: "net", value: 200 }, { field: "supplier_name", value: "New Name" }, { field: "document_number", value: "INV-9999" }]), [0, 1, 2, 3]);
  assert.deepEqual([result.applied.length, result.refused.length], [4, 0]);
  const row = rows()[1];
  assert.deepEqual([row.cells[2].textContent, row.cells[4].textContent, row.cells[6].textContent, row.dataset.fullReference], ["25/02/26", "New Name", "9999", "INV-9999"]);
  assert.deepEqual([row.cells[9].querySelector("input").value, row.cells[10].querySelector("input").value, row.cells[8].querySelector("input").value], ["200.00", "36.00", "236.00"], "the VAT of the rate stays and the total follows");
  assert.equal(app.rowSnapshot(row).reference, "INV-9999");
  assert.equal(rows()[0].cells[2].textContent, "20/02/26", "the other row is untouched");
});

test("on the table of the page: another account, no export, a recognition percentage", async () => {
  const { app, rows } = await openedPage();
  app.applyProposalToTable(proposalOf([{ field: "account", value: "206" }, { field: "include", value: false }, { field: "expense_recognized_percent", value: 25 }, { field: "vat_recognized_percent", value: 25 }]), [0, 1, 2, 3]);
  const row = rows()[1];
  assert.equal(row.cells[1].querySelector("select").value, "206");
  assert.equal(row.cells[17].querySelector("input").checked, false);
  assert.equal(row.classList.contains("not-for-export"), true);
  assert.deepEqual([row.cells[12].querySelector("select").value, row.cells[11].querySelector("select").value], ["25", "25"], "the percentages of the proposal are applied after the account, so they win over the business rule");
});

test("on the table of the page: only the changes the user kept are applied, and a row that moved is refused", async () => {
  const { app, rows } = await openedPage();
  const proposal = proposalOf([{ field: "purpose", value: "kept" }, { field: "supplier_name", value: "not kept" }, { field: "allocation_number", value: "123456789", documentId: "doc-a", position: 2 }]);
  const result = app.applyProposalToTable(proposal, [0, 2]);
  assert.deepEqual([Array.from(result.applied, (item) => item.field), Array.from(result.refused, (item) => item.reason)], [["purpose"], [REFUSALS.changed]]);
  assert.equal(rows()[1].cells[3].textContent.replace("⇄", ""), "kept");
  assert.equal(rows()[1].cells[4].textContent, "Paper Shop");
  assert.equal(rows()[1].cells[3].querySelector(".field-swap") !== null, true, "the swap button of the cell is back");
});
