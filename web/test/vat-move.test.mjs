// Step 9.8.1: the column "VAT month". The VAT of a row moves to a future month: the row shows VAT 0 and keeps its amounts, the chosen month
// gets a read-only line with that VAT and net 0, and choosing the row's own month again restores everything.
import test from "node:test";
import assert from "node:assert/strict";
import { createDeclaration, finalizeDeclaration, listDeclarations, loadDeclaration, saveDraft, saveSourceImage } from "../declaration-store.js";
import { documentReportItems, isRowLine } from "../document-report.js";
import { reconcile } from "../ledger-reconcile.js";
import { buildPcn874 } from "../pcn874.js";
import { REFUSALS, applyProposal } from "../proposal-apply.js";
import { reportEntries, vatReport } from "../reports.js";
import { pcnProblemText } from "../reports-view.js";
import { commitMove, prepareMove } from "../rows-move-flow.js";
import { movedLine, vatMonths } from "../vat-move-flow.js";
import { loadApp } from "./app-harness.mjs";
import { binaryDirectory, listPaths, readFileBytes } from "./memory-binary-directory.mjs";

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const config = { clientId: "c1", clientName: "Client", businessActivity: "x", businessKind: "office" };
const invoice = (extra = {}) => ({
  documentId: "doc-1", imageIndex: 1, imageFile: "001.jpg", receivedAt: "2026-10-01T08:00:00.000Z",
  values: ["05/10/26", "202", "paper", "Paper Shop", "512345679", "2002", "", "118.00", "100.00", "18.00", "100", "100"],
  rawNet: "100", rawVat: "18", vatPercent: "18", active: true, agent: { run: "r" }, statusClass: "ready", statusText: "מוכן", ...extra,
});

// October is on screen; other: months that exist already ({ month: closed? }).
async function setup({ rows = [invoice()], other = {}, answer = true } = {}) {
  const loaded = await loadApp();
  const client = binaryDirectory("client");
  const october = await createDeclaration(client, { clientId: "c1", month: "2026-10" });
  await saveDraft(october.directory, october.declaration, rows);
  await saveSourceImage(october.directory, "001.jpg", new Uint8Array([9, 9]));
  for (const [month, closed] of Object.entries(other)) {
    const made = await createDeclaration(client, { clientId: "c1", month });
    const existing = [invoice({ documentId: "there", imageFile: "", imageIndex: 0 })];
    await saveDraft(made.directory, made.declaration, existing);
    if (closed) await finalizeDeclaration({ clientDirectory: client, declarationDirectory: made.directory, declaration: made.declaration, finalExport: "no-export", rows: existing });
  }
  const asked = [];
  loaded.window.confirm = (text) => { asked.push(text); return answer; };
  await loaded.app.activateDeclaration({ workspace: { config, directory: client, parent: {} }, ...(await loadDeclaration(client, "2026-10")) });
  const choose = async (month, index = 0) => {
    const select = loaded.rows()[index].cells[19].querySelector("select");
    select.value = month;
    select.dispatchEvent(new loaded.window.Event("change"));
    for (let i = 0; i < 40 && select.disabled; i += 1) await settle();
    await settle();
    return select;
  };
  const saved = async (month) => loadDeclaration(client, month);
  return { ...loaded, client, asked, choose, saved };
}

test("the list holds the month of the table and the months after it, across the turn of the year", () => {
  const months = vatMonths("2026-10");
  assert.deepEqual([months[0], months[1], months[3], months.length], ["2026-10", "2026-11", "2027-01", 13]);
});

test("a move to a month that does not exist asks, writes the line, closes that month, and the row shows VAT 0", async () => {
  const { app, rows, asked, choose, saved, client } = await setup();
  const select = await choose("2026-11");
  assert.equal(select.value, "2026-11");
  assert.match(asked[0], /לא קיימת/);
  const snapshot = JSON.parse(JSON.stringify(app.rowSnapshot(rows()[0])));
  assert.deepEqual(snapshot.values.slice(7, 10), ["118.00", "100.00", "0.00"]);
  assert.equal(snapshot.rawVat, "18", "the original amount is kept");
  assert.equal(snapshot.vatMove.month, "2026-11");
  const november = await saved("2026-11");
  assert.equal(november.declaration.status, "closed", "only the month on screen stays open");
  const [line] = november.draft.rows;
  assert.deepEqual(line.values, ["05/10/26", "202", "paper", "Paper Shop", "512345679", "2002", "", "0.00", "0.00", "18.00", "100", "100"]);
  assert.deepEqual(line.vatMovedFrom, { id: snapshot.vatMove.id, month: "2026-10", net: "100" });
  assert.equal(new TextDecoder().decode(await readFileBytes(client, `declarations/2026-11/images/${line.imageFile}`)).length, 2, "the same original");
  assert.equal((await saved("2026-10")).draft.rows[0].vatMove.month, "2026-11", "the source is saved at once");
});

test("every total counts the document once: the net in its month, the VAT in the chosen month", async () => {
  const { app, rows, choose, saved } = await setup();
  await choose("2026-11");
  const source = JSON.parse(JSON.stringify(app.rowSnapshot(rows()[0])));
  const accounts = { 202: { name: "x", type: "expense" } };
  const entries = reportEntries([{ month: "2026-10", rows: [source] }, { month: "2026-11", rows: (await saved("2026-11")).draft.rows }], accounts);
  const sum = (field) => entries.reduce((total, entry) => total + entry[field], 0);
  assert.deepEqual([sum("gross"), sum("net"), sum("vat")], [118, 100, 18]);
  assert.deepEqual(entries.map((entry) => [entry.month, entry.vat]), [["2026-10", 0], ["2026-11", 18]]);
});

test("\"no\" changes nothing", async () => {
  const { app, rows, choose, client } = await setup({ answer: false });
  const select = await choose("2026-11");
  assert.equal(select.value, "2026-10");
  assert.equal(JSON.parse(JSON.stringify(app.rowSnapshot(rows()[0]))).values[9], "18.00");
  assert.deepEqual((await listDeclarations(client)).map((item) => item.declaration.month), ["2026-10"]);
});

test("choosing the own month again restores the row, asks about the closed month and takes the line out", async () => {
  const { app, rows, asked, choose, saved } = await setup();
  await choose("2026-11");
  const select = await choose("2026-10");
  assert.equal(select.value, "2026-10");
  assert.match(asked[1], /להסיר ממנה את שורת המע״מ/);
  const snapshot = JSON.parse(JSON.stringify(app.rowSnapshot(rows()[0])));
  assert.equal(snapshot.values[9], "18.00");
  assert.equal(snapshot.vatMove, undefined);
  const november = await saved("2026-11");
  assert.deepEqual([november.draft.rows.length, november.declaration.status], [0, "closed"]);
  assert.equal(rows()[0].cells[17].querySelector("input").disabled, false, "the row can be edited again");
});

test("changing the target moves the line; the rows of the months stay", async () => {
  const { choose, saved } = await setup({ other: { "2026-11": true } });
  await choose("2026-11");
  assert.equal((await saved("2026-11")).draft.rows.length, 2);
  await choose("2026-12");
  assert.deepEqual((await saved("2026-11")).draft.rows.map((row) => row.documentId), ["there"]);
  assert.equal((await saved("2026-12")).draft.rows[0].values[9], "18.00");
  assert.equal((await saved("2026-11")).declaration.reopenLog.at(-1).reason, "opened to move VAT");
});

test("a closed target is refused on \"no\" and untouched", async () => {
  const { asked, choose, saved } = await setup({ other: { "2026-11": true }, answer: false });
  const select = await choose("2026-11");
  assert.equal(select.value, "2026-10");
  assert.match(asked[0], /סגורה וייתכן שכבר דווחה/);
  assert.equal((await saved("2026-11")).draft.rows.length, 1);
});

test("a row without VAT or switched off has nothing to move, and nothing is asked", async () => {
  const none = await setup({ rows: [invoice({ rawVat: "0", imageFile: "", values: ["05/10/26", "202", "", "", "", "", "", "100.00", "100.00", "0.00", "100", "100"] })] });
  const empty = await none.choose("2026-11");
  assert.equal(empty.value, "2026-10");
  assert.equal(none.asked.length, 0);
  const off = await setup({ rows: [invoice({ active: false })] });
  assert.equal((await off.choose("2026-11")).value, "2026-10");
  assert.equal(off.asked.length, 0);
});

test("a row whose VAT moved takes no edit but its list; the line takes none at all, also after the table is opened again", async () => {
  const { app, rows, choose, document, saved } = await setup();
  await choose("2026-11");
  const [row] = rows();
  assert.equal(row.cells[10].querySelector("input").disabled, true);
  assert.equal(row.cells[17].querySelector("input").disabled, true);
  assert.equal(row.querySelector(".delete").disabled, true);
  assert.equal(row.cells[19].querySelector("select").disabled, false);
  const november = await saved("2026-11");
  app.restoreRow(november.draft.rows[0], null);
  const line = rows()[1];
  assert.match(line.cells[19].textContent, /מ-10\/2026/);
  assert.equal(line.cells[19].querySelector("select"), null);
  assert.equal(line.querySelector(".delete").disabled, true);
  assert.equal(line.cells[10].querySelector("input").disabled, true);
  assert.equal(line.cells[16].textContent.includes("מע״מ מועבר"), true);
  assert.deepEqual(JSON.parse(JSON.stringify(app.rowSnapshot(line))).values.slice(7, 10), ["0.00", "0.00", "18.00"]);
  assert.ok(document.querySelector("th[data-col='vatMonth']"));
});

test("the line of moved VAT is what the code says: nothing of the source's amounts but the VAT", () => {
  const line = movedLine(invoice(), { id: "x", fromMonth: "2026-10", vat: "18.00", now: "2026-10-02T08:00:00.000Z" });
  assert.deepEqual([line.documentId, line.rawNet, line.rawVat, line.booked, line.active], ["vatmove-x", "0", "18.00", true, true]);
  assert.deepEqual(line.vatMovedFrom, { id: "x", month: "2026-10", net: "100" });
});

test("the line keeps the net of a credit with its sign, and the page of its PDF", () => {
  const credit = invoice({ rawNet: "100", agent: { page: 3 }, values: ["05/10/26", "202", "", "", "", "", "", "-118.00", "-100.00", "-18.00", "100", "100"] });
  const { vatMovedFrom } = movedLine(credit, { id: "x", fromMonth: "2026-10", vat: "-18.00" });
  assert.deepEqual(vatMovedFrom, { id: "x", month: "2026-10", net: "-100", page: 3 });
});

// Step 9.8.2. The two months after a move, as the reports read them.
async function movedMonths(code, party = "512345679") {
  const values = ["05/10/26", code, "paper", "Paper Shop", party, "2002", "", "118.00", "100.00", "18.00", "100", "100"];
  const { app, rows, choose, saved } = await setup({ rows: [invoice({ values, reference: "2002" })] });
  await choose("2026-11");
  const source = JSON.parse(JSON.stringify(app.rowSnapshot(rows()[0])));
  return [
    { month: "2026-10", status: "closed", rows: [source] },
    { month: "2026-11", status: "closed", rows: (await saved("2026-11")).draft.rows },
  ];
}
const chart = { 160: { name: "הכנסות", type: "income" }, 202: { name: "x", type: "expense" } };
const slip = (declarations, month) => vatReport(reportEntries(declarations.filter((item) => item.month === month), chart));
const pcnFile = (declarations, month) => buildPcn874({ vatId: "123456782", from: month, to: month, declarations, accounts: chart });

test("the VAT report: a sale whose VAT moved is taxable in its month, and the VAT is due in the chosen month", async () => {
  const months = await movedMonths("160");
  const october = slip(months, "2026-10");
  assert.deepEqual([october.turnover, october.taxableSales, october.exemptSales, october.outputVat, october.payable], [100, 100, 0, 0, 0]);
  const november = slip(months, "2026-11");
  assert.deepEqual([november.turnover, november.taxableSales, november.exemptSales, november.outputVat, november.payable], [0, 0, 0, 18, 18]);
});

test("the VAT report: the VAT of an expense is deducted in the chosen month only", async () => {
  const months = await movedMonths("202");
  assert.equal(slip(months, "2026-10").inputVat, 0);
  assert.deepEqual([slip(months, "2026-11").inputVat, slip(months, "2026-11").payable], [18, -18]);
});

test("PCN874: a moved purchase is a line of the chosen month with the details and the net of its document", async () => {
  const months = await movedMonths("202");
  assert.deepEqual(pcnFile(months, "2026-10").lines, []);
  const november = pcnFile(months, "2026-11");
  assert.deepEqual(november.lines, ["T512345679202610050000000002002000000018+0000000100000000000"]);
  assert.deepEqual(november.warnings, []);
  assert.deepEqual(november.problems, []);
});

test("PCN874: a sale whose VAT moved is written as it is, with a warning in both months", async () => {
  const months = await movedMonths("160");
  const october = pcnFile(months, "2026-10");
  const november = pcnFile(months, "2026-11");
  assert.deepEqual(october.warnings, [{ code: "moved_sale", month: "2026-10", position: 1 }]);
  assert.deepEqual(november.warnings, [{ code: "moved_sale", month: "2026-11", position: 1 }]);
  assert.match(pcnProblemText(october.warnings[0]), /הועבר בין חודשים/);
  assert.deepEqual([october.report.exemptSales, october.report.taxableSales], [0, 100]);
});

test("PCN874: a sale to nobody by name whose VAT moved stays out of the exempt line", async () => {
  const months = await movedMonths("160", "");
  const { lines, report } = pcnFile(months, "2026-10");
  assert.deepEqual(lines, ["L000000000202610050000000002002000000000+0000000100000000000"]);
  assert.equal(report.exemptSales, 0);
});

test("the documents report: the line shows the original kept in its month and the line of its document in a sheet", async () => {
  const months = await movedMonths("202");
  const [line] = months[1].rows;
  assert.ok(line.imageFile);
  const [item] = documentReportItems(months, "2026-11", "2026-11");
  assert.equal(item.row.vatMovedFrom.net, "100");
  assert.equal(isRowLine(["2002", "100.00"], line), true);
  assert.equal(isRowLine(["2002", "55.00"], line), false);
});

test("the line keeps what the reports need when its table is saved again", async () => {
  const { app, rows } = await setup({ rows: [] });
  const line = movedLine(invoice({ agent: { page: 2 } }), { id: "x", fromMonth: "2026-09", vat: "18.00" });
  app.restoreRow(line, null);
  const snapshot = JSON.parse(JSON.stringify(app.rowSnapshot(rows()[0])));
  assert.deepEqual(snapshot.vatMovedFrom, { id: "x", month: "2026-09", net: "100", page: 2 });
});

test("the ledger check takes the source row for the operation and does not report the line as extra", async () => {
  const months = await movedMonths("202");
  const operation = { key: "2026-10|x|2026-10-05|100.00|118.00", month: "2026-10", name: "x", net: 100, vat: 18, gross: 118 };
  const { matched, missing, extra } = reconcile([operation], months, chart);
  assert.deepEqual([matched, missing.length, extra.length], [1, 0, 0]);
});

test("a move into a month with rows keeps a copy of its old table", async () => {
  const { client, choose } = await setup({ other: { "2026-11": true } });
  await choose("2026-11");
  const copies = (await listPaths(client)).filter((path) => path.includes("draft-table.before-vat-move"));
  assert.equal(copies.length, 1);
  assert.ok(copies[0].startsWith("declarations/2026-11/"));
});

test("the move of rows leaves a row whose VAT moved where it is", async () => {
  const { choose, saved, client } = await setup();
  await choose("2026-11");
  const prepared = await prepareMove({ client: { directory: client, config }, month: "2026-10", today: new Date(2026, 9, 7) });
  assert.equal(prepared.lines[0].fixed, true);
  await assert.rejects(() => commitMove(prepared, { assignments: new Map([[0, "2026-12"]]), client: { directory: client, config } }), /יש להחזיר אותו/);
  assert.equal((await saved("2026-10")).draft.rows.length, 1);
});

test("a proposal of the agent is refused for a row whose VAT moved", () => {
  const row = { dataset: { documentId: "d" } };
  const ops = { locked: () => false, month: () => "2026-10", rows: () => [row], vatMoved: () => true, edited() {} };
  const change = { documentId: "d", month: "2026-10", position: 1, field: "include", value: false };
  const { applied, refused } = applyProposal({ changes: [change] }, ops);
  assert.deepEqual([applied.length, refused[0].reason], [0, REFUSALS.vat_moved]);
});
