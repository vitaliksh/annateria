// prepare_import (docs/AGENT_TOOLS.md, 5.6, step 4.7.2) on real stores in memory, with synthetic journals: it parses and checks read-only,
// shows a card, tells the model counts and check results only, and writes nothing.
import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { addToInbox } from "../inbox-store.js";
import { createDocumentReader } from "../agent/adapters/documents.js";
import { createImportReader } from "../agent/adapters/imports.js";
import { buildJournalGrid, SAMPLE_ROWS } from "./excel-journal-fixture.mjs";
import { ledgerGrid, ledgerPdfPages, ledgerRowsGrid, ledgerRowsPdfPages } from "./ledger-fixture.mjs";
import { fakePdfJs, sampleReport, summaryPage } from "./income-report-fixture.mjs";
import { createDefaultRegistry } from "../agent/index.js";
import { runAgent } from "../agent/run.js";
import { call, file, reply, say, scriptedModel, recordingUi, toolContext, world } from "./agent-fixtures.mjs";
import { listPaths, readFileBytes } from "./memory-binary-directory.mjs";

const loadLibrary = async () => XLSX;

function workbook(grid, sheet = "גיליון2") {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(grid), sheet);
  return XLSX.write(book, { type: "array", bookType: "xlsx" });
}

// The inbox folder of `owner` (default Levi, who has a chart of his own) holds a journal, next to the fixture files. Cohen has no chart
// of his own, so the standard names of Rivhit are known and the footer of the file adds up.
async function session({ answers, grid = buildJournalGrid({ month: 8 }), name = "journal-08.xlsx", owner = "Levi", folder = owner } = {}) {
  const tools = await toolContext({ answers, imports: createImportReader({ loadLibrary }) });
  const added = await addToInbox(tools.w.root, [file(name, workbook(grid))], { folder, now: "2026-10-16T08:05:00.000Z" });
  assert.equal(added.added.length, 1);
  const handles = await tools.files();
  return { ...tools, handles, handle: handles[name], levi: await tools.client(owner) };
}
const prepare = (s, extra = {}) => s.dispatch("prepare_import", { file: s.handle, kind: "journal", client: s.levi, routed_by: "folder", reason: "יומן קליטה של ריבהיט", ...extra });
const snapshot = async (root) => {
  const paths = (await listPaths(root)).sort();
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [path, Buffer.from(await readFileBytes(root, path)).toString("base64")])));
};

test("prepare_import: a journal in the folder of the client gives counts and checks, a card, and changes nothing on disk", async () => {
  const s = await session({ owner: "Cohen" });
  const before = await snapshot(s.w.root);
  const result = await prepare(s);
  assert.equal(result.ok, true);
  assert.deepEqual([result.state, result.kind, result.wizard, result.card_shown, result.month], ["prepared", "journal", "excel_import", true, "2026-08"]);
  assert.match(result.prepared, /^I\d+$/);
  assert.equal(result.summary.rows, SAMPLE_ROWS.length);
  assert.deepEqual(result.checks.map((check) => [check.code, check.ok]), [
    ["header_found", true], ["rows_found", true], ["row_values", true], ["footer_totals", true], ["month_in_header", true],
  ]);
  assert.equal(result.checks[1].count, SAMPLE_ROWS.length);
  assert.deepEqual(await snapshot(s.w.root), before, "the file tree is byte-equal after the call");
  // The card is for the user: it has the totals and the file; the model got neither the sums nor a name from the file.
  assert.equal(s.ui.importCards.length, 1);
  const [card] = s.ui.importCards;
  assert.deepEqual([card.id, card.kind, card.client, card.file.name, card.reason], [result.prepared, "journal", { id: "id-Cohen", name: "Cohen Studio" }, "journal-08.xlsx", "יומן קליטה של ריבהיט"]);
  assert.deepEqual(card.totals, { net: 13520.5, vat: 1280.31, gross: 15840.19 });
  const told = JSON.stringify(result);
  for (const secret of ["Shop A", "Utility B", "13520.5", "15840.19", "אחזקה", "הכנסות"]) assert.equal(told.includes(secret), false, `the model is not told ${secret}`);
  assert.equal("totals" in result || "rows" in result, false);
});

test("prepare_import: the same file twice is prepared once and no second card is shown", async () => {
  const s = await session();
  const first = await prepare(s);
  const second = await prepare(s);
  assert.deepEqual([second.ok, second.state, second.prepared], [true, "already_prepared", first.prepared]);
  assert.equal(s.ui.importCards.length, 1);
});

test("prepare_import: a file that is not a journal is wrong_format with the message of the parser, and no card", async () => {
  const grid = [["name", "amount"], ["a", 1], ["b", 2]];
  const s = await session({ grid, name: "other.xlsx" });
  const result = await prepare(s);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "wrong_format");
  assert.match(result.error.message, /journal header row/);
  assert.equal(s.ui.importCards.length, 0);
  // The fixture file of the world holds bytes that are no workbook at all.
  const fake = await prepare({ ...s, handle: s.handles["journal.xlsx"] });
  assert.equal(fake.error.code, "wrong_format");
  assert.equal(s.ui.importCards.length, 0);
});

test("prepare_import: a kind that does not fit the type of the file, and kinds that are not built yet, are invalid arguments", async () => {
  const s = await session();
  assert.equal((await prepare({ ...s, handle: s.handles["policy.pdf"] })).error.code, "invalid_argument");
  assert.equal((await prepare(s, { kind: "ledger_check" })).error.code, "wrong_format", "a journal is no operations ledger");
  assert.equal((await prepare(s, { kind: "ledger_codes" })).error.code, "wrong_format", "a journal is no classification-codes ledger");
  assert.equal((await prepare(s, { kind: "income_report" })).error.code, "invalid_argument");
  assert.equal((await prepare(s, { month: "2026-13" })).error.code, "invalid_argument");
  assert.equal((await prepare(s, { file: "F99" })).error.code, "not_found");
  assert.equal((await prepare(s, { extra: 1 })).error.code, "invalid_argument", "unknown fields are refused");
  assert.equal(s.ui.importCards.length, 0);
});

test("prepare_import: the client must be proven, a name is not enough (folder or a click of the user)", async () => {
  const s = await session({ folder: "_unsorted" });
  const cohen = await s.client("Cohen");
  assert.equal((await prepare(s)).error.code, "not_allowed", "a file in _unsorted is not in the folder of Levi");
  const elsewhere = await session();
  assert.equal((await prepare(elsewhere, { client: await elsewhere.client("Cohen") })).error.code, "not_allowed", "the file lies in the folder of another client");
  assert.equal((await prepare(s, { routed_by: "user" })).error.code, "invalid_argument", "routing_ask is required");
  assert.equal(s.ui.importCards.length, 0);
});

test("prepare_import: a click of the user is the proof for a file in _unsorted, but only for the client and the file it was about", async () => {
  const s = await session({ folder: "_unsorted", answers: [{ type: "option", id: "levi" }, { type: "option", id: "levi" }, { type: "dismissed" }] });
  const cohen = await s.client("Cohen");
  const options = [{ id: "levi", label: "Levi", client: s.levi }, { id: "cohen", label: "Cohen", client: cohen }];
  const ask = async (files, question) => (await s.dispatch("ask_user", { question, options, allow_other: false, about: { files } })).ask;
  const forLevi = await ask([s.handle], "Whose is this journal?");
  const aboutPhoto = await ask([s.handles["photo.jpg"]], "And the photo?");
  const dismissed = await ask([s.handle, s.handles["policy.pdf"]], "Both?");
  assert.equal((await prepare(s, { routed_by: "user", routing_ask: aboutPhoto })).error.code, "not_allowed", "a question about another file");
  assert.equal((await prepare(s, { routed_by: "user", routing_ask: dismissed })).error.code, "not_allowed", "dismissed is no answer");
  assert.equal((await prepare(s, { routed_by: "user", routing_ask: forLevi, client: cohen })).error.code, "not_allowed", "the user chose Levi, not Cohen");
  const ok = await prepare(s, { routed_by: "user", routing_ask: forLevi });
  assert.deepEqual([ok.ok, ok.state], [true, "prepared"]);
});

test("prepare_import: the month of the file decides; another month is a warning, a locked month an error, a month with rows a warning", async () => {
  const s = await session({ grid: buildJournalGrid({ month: 1 }), name: "journal-01.xlsx" });
  const locked = await prepare(s, { month: "2026-03" });
  assert.deepEqual(locked.problems.filter((item) => ["month_differs", "month_locked"].includes(item.code)).map((item) => [item.code, item.severity]), [["month_differs", "warning"], ["month_locked", "error"]]);
  assert.equal(locked.month, "2026-01", "the month of the file, not the suggestion");
  const rows = await session({ grid: buildJournalGrid({ month: 2 }), name: "journal-02.xlsx" });
  const withRows = await prepare(rows);
  assert.deepEqual(withRows.problems.find((item) => item.code === "month_has_rows"), { code: "month_has_rows", severity: "warning", count: 3 });
  const plain = await prepare(await session());
  assert.equal(plain.problems.some((item) => item.code.startsWith("month_")), false);
});

test("prepare_import: errors and warnings of the file are problems, not a refusal; the wizard decides what to do", async () => {
  const broken = SAMPLE_ROWS.map((row, index) => (index === 0 ? { ...row, net: 100, vat: 18 } : row));
  const grid = buildJournalGrid({ month: 8, rows: broken, footer: { totalVat: "999.00" } });
  const s = await session({ grid });
  const result = await prepare(s);
  assert.equal(result.ok, true);
  assert.equal(result.checks.find((check) => check.code === "footer_totals").ok, false);
  const codes = result.problems.map((item) => item.code);
  assert.ok(codes.includes("footer-mismatch") || codes.includes("types_suggested"), codes.join());
  assert.ok(codes.includes("draft-rows"), "the draft status of the rows is a warning");
  assert.equal(s.ui.importCards.length, 1);
});

test("prepare_import needs a panel and a run that can show the card", async () => {
  const s = await session();
  delete s.ctx.ui.importCard;
  assert.equal((await prepare(s)).error.code, "unavailable");
});

test("a run: the model reads the file, finds the client, prepares the import and says that a card waits; nothing is imported", async () => {
  const w = await world({ documents: createDocumentReader({ loadXlsx: loadLibrary }), imports: createImportReader({ loadLibrary }) });
  await addToInbox(w.root, [file("journal-08.xlsx", workbook(buildJournalGrid({ month: 8 })))], { folder: "Cohen", now: "2026-10-16T08:05:00.000Z" });
  const ui = recordingUi();
  const responses = (request) => request.contents.flatMap((content) => content.parts.filter((part) => part.functionResponse).map((part) => part.functionResponse));
  const last = (request, name) => responses(request).filter((item) => item.name === name).at(-1).response;
  const fileOf = (request) => last(request, "list_inbox").files.find((item) => item.name === "journal-08.xlsx").file;
  const before = await snapshot(w.root);
  const model = scriptedModel([
    reply(call("list_inbox")),
    (request) => reply(call("read_document", { file: fileOf(request) }), call("find_client", { name: "Cohen" })),
    (request) => reply(call("prepare_import", {
      file: fileOf(request), kind: "journal", client: last(request, "find_client").matches[0].client, routed_by: "folder", reason: "יומן קליטה לחודש 8",
    })),
    (request) => reply(say(`A card waits for ${last(request, "prepare_import").summary.rows} rows.`)),
  ]);
  const result = await runAgent({ model, system: "s", registry: createDefaultRegistry(), message: "go", services: w.services, ui });
  assert.equal(result.status, "completed");
  assert.equal(result.text, `A card waits for ${SAMPLE_ROWS.length} rows.`);
  assert.equal(ui.importCards.length, 1);
  // read_document and find_client ran together, so their order in the log is not fixed.
  assert.deepEqual(result.log.entries.filter((entry) => entry.kind === "tool").map((entry) => [entry.name, entry.ok]).sort(), [
    ["find_client", true], ["list_inbox", true], ["prepare_import", true], ["read_document", true],
  ]);
  const read = result.log.entries.find((entry) => entry.name === "read_document");
  assert.equal(read.ok, true, "the sample of the workbook is readable by the agent");
  const files = await snapshot(w.root);
  assert.deepEqual(Object.keys(files).filter((path) => !(path in before)), [], "no file was made");
  assert.deepEqual(Object.keys(before).filter((path) => !(path in files)), [], "no file was removed");
  assert.equal(files["inbox/Cohen/journal-08.xlsx"] !== undefined, true, "the original is still in the inbox");
});

test("prepare_import: the client the user picked from the list of a choose_client question is the proof", async () => {
  const s = await session({ folder: "_unsorted", answers: [{ type: "option", id: "list2" }] });
  const asked = await s.dispatch("ask_user", { question: "לאיזה לקוח שייך היומן?", choose_client: true, allow_other: false, about: { files: [s.handle] } });
  assert.equal(asked.ok, true);
  const levi = asked.client;
  assert.equal(s.ctx.handles.get("C", levi).clientId, "id-Levi", "the list is sorted by name: Cohen, Levi, Pcn");
  const ok = await prepare(s, { client: levi, routed_by: "user", routing_ask: asked.ask });
  assert.deepEqual([ok.ok, ok.state], [true, "prepared"]);
});

// --- kind ledger_codes (step 4.7.3) ---

async function ledgerSession({ name = "codes.xlsx", owner = "Cohen", pdf = false } = {}) {
  const tools = await toolContext({ imports: createImportReader({ loadLibrary, loadPdf: fakePdfJs(ledgerPdfPages()) }) });
  const content = pdf ? new TextEncoder().encode("%PDF-1.4 synthetic") : workbook(ledgerGrid());
  await addToInbox(tools.w.root, [file(name, content, pdf ? "application/pdf" : "")], { folder: owner, now: "2026-10-16T08:06:00.000Z" });
  const handles = await tools.files();
  return { ...tools, handles, handle: handles[name], levi: await tools.client(owner) };
}
const codes = (s, extra = {}) => prepare(s, { kind: "ledger_codes", reason: "כרטסת קודי מיון של הלקוח", ...extra });

test("prepare_import ledger_codes: a ledger workbook gives the number of codes and the plan, a card, and changes nothing", async () => {
  const s = await ledgerSession();
  const before = await snapshot(s.w.root);
  const result = await codes(s);
  assert.equal(result.ok, true);
  assert.deepEqual([result.kind, result.wizard, result.state], ["ledger_codes", "ledger_codes", "prepared"]);
  assert.ok(result.summary.accounts > 0);
  assert.deepEqual([result.summary.had_own_chart, result.summary.rows_to_remap, result.summary.months_to_remap], [false, 0, []]);
  assert.deepEqual(result.checks.map((check) => check.code), ["codes_found", "all_lines_read", "imported_rows_remapped"]);
  assert.deepEqual(await snapshot(s.w.root), before);
  assert.equal(JSON.stringify(result).includes('הנה"ח'), false, "no account name reaches the model");
  assert.equal(s.ui.importCards[0].kind, "ledger_codes");
});

test("prepare_import ledger_codes: a PDF ledger is read too; a client with codes of its own is warned that they are replaced", async () => {
  const s = await ledgerSession({ name: "codes.pdf", owner: "Levi", pdf: true });
  const result = await codes(s);
  assert.equal(result.ok, true);
  assert.equal(result.summary.had_own_chart, true);
  assert.deepEqual(result.problems.find((item) => item.code === "replaces_own_chart"), { code: "replaces_own_chart", severity: "warning", count: 1 });
});

test("prepare_import ledger_codes: a file without codes is wrong_format with the message of the reader", async () => {
  const s = await session({ grid: [["a", "b"], [1, 2]], name: "not-codes.xlsx", owner: "Cohen" });
  const result = await prepare(s, { kind: "ledger_codes" });
  assert.equal(result.error.code, "wrong_format");
  assert.match(result.error.message, /לא נמצאו קודי מיון/);
  assert.equal(s.ui.importCards.length, 0);
});

// --- kind ledger_check (step 4.7.4) ---
async function checkSession({ pdf = false } = {}) {
  const tools = await toolContext({ imports: createImportReader({ loadLibrary, loadPdf: fakePdfJs(ledgerRowsPdfPages()) }) });
  const name = pdf ? "ledger.pdf" : "ledger.xlsx";
  const content = pdf ? new TextEncoder().encode("%PDF-1.4 synthetic") : workbook(ledgerRowsGrid());
  await addToInbox(tools.w.root, [file(name, content, pdf ? "application/pdf" : "")], { folder: "Levi", now: "2026-10-16T08:07:00.000Z" });
  const handles = await tools.files();
  return { ...tools, handles, handle: handles[name], levi: await tools.client("Levi") };
}
const check = (s) => prepare(s, { kind: "ledger_check", reason: "כרטסת עם פעולות לבדיקה מול ההצהרות" });

test("prepare_import ledger_check: the ledger is compared with the declarations of its year; counts only, a card, nothing written", async () => {
  const s = await checkSession();
  const before = await snapshot(s.w.root);
  const result = await check(s);
  assert.equal(result.ok, true);
  assert.deepEqual([result.kind, result.wizard], ["ledger_check", "ledger_check"]);
  const { summary } = result;
  assert.equal(summary.year, 2026);
  assert.ok(summary.operations > 0);
  assert.equal(summary.matched + summary.missing, summary.operations);
  assert.ok(summary.can_add <= summary.missing);
  assert.deepEqual(result.checks.map((item) => item.code), ["operations_found", "all_in_declarations"]);
  if (summary.missing) assert.equal(result.problems.find((item) => item.code === "operations_missing").count, summary.missing);
  assert.deepEqual(await snapshot(s.w.root), before);
  assert.equal(s.ui.importCards[0].kind, "ledger_check");
  assert.equal(/"details"|"name"|"date"/.test(JSON.stringify(result)), false, "no operation reaches the model");
});

test("prepare_import ledger_check: a PDF ledger gives the same counts as the workbook", async () => {
  const fromXlsx = await check(await checkSession());
  const fromPdf = await check(await checkSession({ pdf: true }));
  assert.equal(fromPdf.ok, true);
  assert.deepEqual(fromPdf.summary, fromXlsx.summary);
});

test("prepare_import ledger_check: a ledger of which almost nothing is in the tables, though they have rows in its months, is flagged", async () => {
  // Levi's tables have rows in 01 and 02/2026; a ledger of 2026 with operations in those months that none of them match.
  const blocks = [{ section: "הוצאות הנהלה וכלליות", code: "202", name: "משרדיות", rows: Array.from({ length: 12 }, (_, index) => ({
    month: 1 + (index % 2), line: String(index + 1), date: `2026-0${1 + (index % 2)}-1${index % 9}`, details: `Shop ${index}`, ref1: String(900 + index),
    gross: -(118 + index), net: -(100 + index), vat: -18,
  })) }];
  const tools = await toolContext({ imports: createImportReader({ loadLibrary }) });
  await addToInbox(tools.w.root, [file("other.xlsx", workbook(ledgerRowsGrid(blocks)))], { folder: "Levi", now: "2026-10-16T08:08:00.000Z" });
  const handles = await tools.files();
  const s = { ...tools, handles, handle: handles["other.xlsx"], levi: await tools.client("Levi") };
  const result = await check(s);
  assert.equal(result.ok, true);
  assert.equal(result.summary.matched, 0);
  assert.deepEqual(result.problems[0], { code: "maybe_other_client", severity: "error", count: 1 });
  // A client whose tables have nothing in the ledger's months is not flagged: there is nothing to compare with.
  const cohen = await toolContext({ imports: createImportReader({ loadLibrary }) });
  await addToInbox(cohen.w.root, [file("other.xlsx", workbook(ledgerRowsGrid(blocks)))], { folder: "Cohen", now: "2026-10-16T08:08:00.000Z" });
  const cohenFiles = await cohen.files();
  const empty = await check({ ...cohen, handle: cohenFiles["other.xlsx"], levi: await cohen.client("Cohen") });
  assert.equal(empty.ok, true);
  assert.equal(empty.problems.some((item) => item.code === "maybe_other_client"), false);
});

test("prepare_import ledger_codes: an operations ledger (dated movements) is refused as wrong_format and pointed to ledger_check", async () => {
  const tools = await toolContext({ imports: createImportReader({ loadLibrary, loadPdf: fakePdfJs(ledgerRowsPdfPages()) }) });
  await addToInbox(tools.w.root, [file("ops.xlsx", workbook(ledgerRowsGrid())), file("ops.pdf", new TextEncoder().encode("%PDF-1.4 ops"), "application/pdf")], { folder: "Cohen", now: "2026-10-16T08:09:00.000Z" });
  const handles = await tools.files();
  const cohen = await tools.client("Cohen");
  for (const name of ["ops.xlsx", "ops.pdf"]) {
    const result = await prepare({ ...tools, handle: handles[name], levi: cohen }, { kind: "ledger_codes" });
    assert.equal(result.error?.code, "wrong_format", name);
    assert.match(result.error.message, /operations ledger with \d+ dated movements.*use kind ledger_check/);
  }
  assert.equal(tools.ui.importCards.length, 0);
  assert.equal((await prepare({ ...tools, handle: handles["ops.xlsx"], levi: cohen }, { kind: "ledger_check" })).ok, true, "the same file as ledger_check is fine");
});

// --- kind income_report (step 4.7.5) ---
async function incomeSession(pages, { owner = "Levi" } = {}) {
  const tools = await toolContext({ imports: createImportReader({ loadLibrary, loadPdf: fakePdfJs(pages) }) });
  await addToInbox(tools.w.root, [file("report.pdf", new TextEncoder().encode("%PDF-1.4 report"), "application/pdf")], { folder: owner, now: "2026-10-16T08:10:00.000Z" });
  const handles = await tools.files();
  return { ...tools, handles, handle: handles["report.pdf"], levi: await tools.client(owner) };
}
const income = (s) => prepare(s, { kind: "income_report", reason: "דוח הכנסות תקופתי של חשבונית ירוקה" });
const february = () => [summaryPage({ from: "01/02/2026", to: "28/02/2026", taxable: 250.5, vat: 45.09, gross: 295.59, documents: 5 }), ...sampleReport().pages.slice(1)];

test("prepare_import income_report: the report is read and checked; the model gets the month and counts, the card the sums", async () => {
  const s = await incomeSession(february());
  const before = await snapshot(s.w.root);
  const result = await income(s);
  assert.equal(result.ok, true);
  assert.deepEqual([result.kind, result.wizard, result.month], ["income_report", "income_report", "2026-02"]);
  assert.deepEqual(result.summary, { month: "2026-02", period_from: "2026-02-01", period_to: "2026-02-28", documents: 5, rows_to_add: 1, verified: true });
  assert.deepEqual(result.checks.map((check) => [check.code, check.ok]), [["report_read", true], ["listing_matches_summary", true]]);
  assert.deepEqual(result.problems, []);
  assert.equal(JSON.stringify(result).includes("295.59"), false, "no sum reaches the model");
  assert.deepEqual(s.ui.importCards[0].totals, { net: 250.5, vat: 45.09, gross: 295.59 });
  assert.deepEqual(await snapshot(s.w.root), before);
});

test("prepare_import income_report: a month without a declaration or a locked month is an error on the card; a listing that differs is a warning", async () => {
  const september = await income(await incomeSession(sampleReport().pages));
  assert.deepEqual(september.problems.map((item) => [item.code, item.severity]), [["month_missing", "error"]]);
  const locked = [summaryPage({ from: "01/01/2026", to: "31/01/2026", taxable: 250.5, vat: 45.09, gross: 295.59, documents: 5 }), ...sampleReport().pages.slice(1)];
  assert.deepEqual((await income(await incomeSession(locked))).problems.map((item) => item.code), ["month_locked"]);
  const tampered = [summaryPage({ from: "01/02/2026", to: "28/02/2026", taxable: 999, vat: 45.09, gross: 1044.09, documents: 5 }), ...sampleReport().pages.slice(1)];
  const differs = await income(await incomeSession(tampered));
  assert.equal(differs.summary.verified, false);
  assert.ok(differs.problems.some((item) => item.code === "sum-differs" && item.severity === "warning"));
});

test("prepare_import income_report: a PDF that is no income report is wrong_format, a spreadsheet is the wrong type", async () => {
  const other = await income(await incomeSession([[{ str: "חשבונית מס 77", x: 300, y: 700, width: 60 }]]));
  assert.equal(other.error.code, "wrong_format");
  assert.match(other.error.message, /Not a periodic income report/);
  const s = await session();
  assert.equal((await prepare(s, { kind: "income_report" })).error.code, "invalid_argument");
});
