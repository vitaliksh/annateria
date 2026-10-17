// get_client_context, query_rows and read_document (docs/AGENT_TOOLS.md, 5.1) on real stores in memory.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { createDocumentReader } from "../agent/adapters/documents.js";
import { addToInbox } from "../inbox-store.js";
import { readRules } from "../rules-store.js";
import { file, tableRow, toolContext } from "./agent-fixtures.mjs";
import { binaryDirectory, putFile } from "./memory-binary-directory.mjs";

test("get_client_context: profile, declarations with their state, the last locked month, the client's own chart", async () => {
  const { dispatch, client } = await toolContext();
  const result = await dispatch("get_client_context", { client: await client("Levi") });
  assert.equal(result.ok, true);
  assert.deepEqual([result.name, result.activity, result.kind, result.pcn_required, result.vat_id, result.vat_period], ["Levi Plumbing Ltd", "plumbing", "office", false, "514123456", "monthly"]);
  assert.deepEqual(result.declarations, [{ month: "2026-01", status: "locked", rows: 1 }, { month: "2026-02", status: "open", rows: 2 }]);
  assert.equal(result.locked_through, "2026-01");
  assert.deepEqual(result.chart, [{ code: "202", name: "משרדיות", type: "expense" }, { code: "206", name: "ביטוח עסק", type: "outsideVatBase" }]);
  assert.deepEqual([result.chart_source, result.rules, result.rules_truncated], ["client", "", false]);
});

test("get_client_context: a home client with nothing yet, a PCN client, and clients without an own chart use the built-in one", async () => {
  const { dispatch, client } = await toolContext();
  const cohen = await dispatch("get_client_context", { client: await client("Cohen") });
  assert.deepEqual([cohen.kind, cohen.declarations, cohen.locked_through, cohen.chart, cohen.chart_source], ["home", [], null, [], "built-in"]);
  assert.equal((await dispatch("get_client_context", { client: await client("Pcn") })).pcn_required, true);
  assert.equal((await dispatch("get_client_context", { client: "C99" })).error.code, "not_found");
});

test("get_client_context: rules.md is returned; a long one keeps its newest lines", async () => {
  const { w, dispatch, client } = await toolContext();
  await w.putFile("clients/Levi/rules.md", "- fuel is an expense\n");
  assert.equal((await dispatch("get_client_context", { client: await client("Levi") })).rules, "- fuel is an expense\n");
  const lines = Array.from({ length: 600 }, (_, index) => `- rule number ${index + 1} of this client`);
  await w.putFile("clients/Levi/rules.md", lines.join("\n"));
  const long = await dispatch("get_client_context", { client: await client("Levi") });
  assert.equal(long.rules_truncated, true);
  assert.ok(long.rules.length <= 8000);
  assert.ok(long.rules.endsWith("- rule number 600 of this client"));
  assert.equal(long.rules.includes("rule number 1 of"), false);
});

test("readRules: a missing file is empty text", async () => {
  assert.equal(await readRules(binaryDirectory()), "");
  const directory = binaryDirectory();
  await putFile(directory, "rules.md", "- a rule");
  assert.equal(await readRules(directory), "- a rule");
});

test("query_rows: every row of every month with the facts of the table, flags and handles", async () => {
  const { ctx, dispatch, client } = await toolContext();
  const result = await dispatch("query_rows", { client: await client("Levi") });
  assert.equal(result.total, 4);
  const byId = Object.fromEntries(result.rows.map((row) => [row.row, row]));
  assert.equal(result.rows.length, 4);
  const [old, paper, insurance, copy] = result.rows;
  assert.deepEqual([old.month, old.position, old.date], ["2026-01", 1, "2026-01-10"]);
  assert.deepEqual([paper.month, paper.position, paper.supplier, paper.supplier_vat_id, paper.document_number, paper.net, paper.vat, paper.total, paper.account, paper.flags], ["2026-02", 1, "Paper Shop", "512345679", "INV-1001", 100, 18, 118, "202", []]);
  assert.deepEqual([insurance.flags, insurance.agent_reason, insurance.status], [["review", "agent"], "ביטוח עסק", "נדרש עיון"]);
  assert.deepEqual([copy.flags, copy.position, "agent_reason" in copy], [["review", "duplicate", "excluded"], 3, false]);
  assert.equal(Object.keys(byId).length, 4, "four different handles");
  assert.deepEqual(ctx.handles.get("R", paper.row), { clientId: "id-Levi", month: "2026-02", documentId: "d-1", position: 1 });
});

test("query_rows: month, text, supplier, dates, allocation, account and flag filters", async () => {
  const { dispatch, client } = await toolContext();
  const levi = await client("Levi");
  const ids = async (args) => (await dispatch("query_rows", { client: levi, ...args })).rows.map((row) => `${row.month}#${row.position}`);
  assert.deepEqual(await ids({ month: "2026-02" }), ["2026-02#1", "2026-02#2", "2026-02#3"]);
  assert.deepEqual(await ids({ where: { text: "INSURANCE" } }), ["2026-02#2"]);
  assert.deepEqual(await ids({ where: { text: "INV-1001" } }), ["2026-02#1"], "the full reference of a row");
  assert.deepEqual(await ids({ where: { text: "1001" } }), ["2026-02#1", "2026-02#3"]);
  assert.deepEqual(await ids({ where: { supplier: "paper" } }), ["2026-01#1", "2026-02#1", "2026-02#3"]);
  assert.deepEqual(await ids({ where: { date_from: "2026-02-01", date_to: "2026-02-14" } }), ["2026-02#1", "2026-02#3"]);
  assert.deepEqual(await ids({ where: { has_allocation: true } }), []);
  assert.equal((await ids({ where: { has_allocation: false } })).length, 4);
  assert.deepEqual(await ids({ where: { account: "206" } }), ["2026-02#2"]);
  assert.deepEqual(await ids({ where: { flag: "duplicate" } }), ["2026-02#3"]);
  assert.deepEqual(await ids({ where: { flag: "agent" } }), ["2026-02#2"]);
  assert.deepEqual(await ids({ where: { flag: "excluded", supplier: "paper" } }), ["2026-02#3"]);
});

test("query_rows: a row with an allocation number matches has_allocation, a PCN client shows the rows still to be approved", async () => {
  const { w, dispatch, client } = await toolContext();
  const { directory, declaration } = await (async () => {
    const found = w.levi.declarations.find((item) => item.declaration.month === "2026-02");
    return { directory: found.directory, declaration: found.declaration };
  })();
  const { saveDraft } = await import("../declaration-store.js");
  await saveDraft(directory, declaration, [tableRow("a-1", ["01/02/2026", "202", "x", "S", "1", "1", "123456789", "1", "1", "0"])]);
  assert.deepEqual((await dispatch("query_rows", { client: await client("Levi"), month: "2026-02", where: { has_allocation: true } })).rows.map((row) => row.allocation_number), ["123456789"]);
  const pcn = await dispatch("query_rows", { client: await client("Pcn"), where: { flag: "pcn_pending" } });
  assert.deepEqual(pcn.rows.map((row) => [row.supplier, row.flags]), [["Big Supplier", ["pcn_pending"]]]);
  assert.deepEqual((await dispatch("query_rows", { client: await client("Levi"), where: { flag: "pcn_pending" } })).rows, []);
});

test("query_rows: pages, bad input and a missing month", async () => {
  const { dispatch, client } = await toolContext();
  const levi = await client("Levi");
  const first = await dispatch("query_rows", { client: levi, limit: 3 });
  assert.deepEqual([first.rows.length, first.total, first.next], [3, 4, "3"]);
  const second = await dispatch("query_rows", { client: levi, limit: 3, next: first.next });
  assert.deepEqual([second.rows.length, second.next], [1, undefined]);
  assert.equal((await dispatch("query_rows", { client: levi, month: "2026-09" })).error.code, "not_found");
  assert.equal((await dispatch("query_rows", { client: levi, month: "2026-9" })).error.code, "invalid_argument");
  assert.equal((await dispatch("query_rows", { client: levi, where: { date_from: "tomorrow" } })).error.code, "invalid_argument");
  assert.equal((await dispatch("query_rows", { client: levi, where: { flag: "weird" } })).error.code, "invalid_argument");
});

test("query_rows reads the open table as it is on screen, not as it was saved", async () => {
  let live = null;
  const { dispatch, client } = await toolContext({ liveTable: () => live });
  live = { clientId: "id-Levi", month: "2026-02", rows: [tableRow("d-1", ["14/02/2026", "202", "paper", "Typed On Screen", "512345679", "1001", "", "118", "100", "18"])] };
  const result = await dispatch("query_rows", { client: await client("Levi"), month: "2026-02" });
  assert.deepEqual(result.rows.map((row) => row.supplier), ["Typed On Screen"]);
  assert.equal((await dispatch("query_rows", { client: await client("Levi") })).total, 2, "one row of 01/2026 and the one on screen");
});

// --- read_document ---

const pdfLibrary = (pages, { fail = false } = {}) => async () => ({
  getDocument: () => ({
    promise: fail ? Promise.reject(new Error("broken pdf")) : Promise.resolve({
      numPages: pages.length,
      getPage: async (number) => ({ getTextContent: async () => ({ items: [{ str: pages[number - 1], hasEOL: false }] }) }),
      destroy: async () => {},
    }),
  }),
});

async function documentTools(options) {
  const documents = createDocumentReader({ imageSize: async () => ({ width: 3000, height: 2000 }), ...options });
  return toolContext({ documents });
}

test("read_document: a photo gives its size and nothing else, never the image", async () => {
  const { dispatch, files } = await documentTools();
  const result = await dispatch("read_document", { file: (await files())["photo.jpg"] });
  assert.deepEqual(result, { ok: true, file: (await files())["photo.jpg"], kind: "image", width: 3000, height: 2000 });
  const unknown = await documentTools({ imageSize: async () => { throw new Error("cannot decode heic"); } });
  assert.deepEqual((await unknown.dispatch("read_document", { file: (await unknown.files())["photo.jpg"] })).kind, "image");
});

test("read_document: a PDF gives its pages and the text layer, all pages or one", async () => {
  const { dispatch, files } = await documentTools({ loadPdf: pdfLibrary(["First page text", "Second page text", "Third page text"]) });
  const handle = (await files())["policy.pdf"];
  const all = await dispatch("read_document", { file: handle });
  assert.equal(all.pages, 3);
  assert.match(all.text, /--- page 1 ---\nFirst page text\n--- page 2 ---\nSecond page text/);
  assert.deepEqual((await dispatch("read_document", { file: handle, page: 2 })).text, "Second page text");
  assert.equal((await dispatch("read_document", { file: handle, page: 4 })).error.code, "invalid_argument");
});

test("read_document: a text longer than max_chars is cut and marked; a scan without a text layer has no text", async () => {
  const long = await documentTools({ loadPdf: pdfLibrary(["x".repeat(900)]) });
  const cut = await long.dispatch("read_document", { file: (await long.files())["policy.pdf"], max_chars: 300 });
  assert.deepEqual([cut.text.length, cut.truncated], [300, true]);
  const scan = await documentTools({ loadPdf: pdfLibrary(["", "  "]) });
  const result = await scan.dispatch("read_document", { file: (await scan.files())["policy.pdf"] });
  assert.deepEqual([result.pages, "text" in result], [2, false]);
});

test("read_document: a workbook gives sheet names, row counts and the first rows; a CSV too", async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["date", "sum"], ["2026-02-01", 100], ["2026-02-02", 250]]), "Journal");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["empty"]]), "Notes");
  const bytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
  const { w, dispatch, files } = await documentTools({ loadXlsx: async () => XLSX });
  await addToInbox(w.root, [file("real.xlsx", bytes), file("rows.csv", "a,b\n1,2\n3,4\n")], { folder: "Levi" });
  const handles = await files();
  const sheet = await dispatch("read_document", { file: handles["real.xlsx"] });
  assert.deepEqual(sheet.sheets.map((item) => [item.name, item.rows]), [["Journal", 3], ["Notes", 1]]);
  assert.match(sheet.sheets[0].text, /date,sum\n2026-02-01,100\n2026-02-02,250/);
  const csv = await dispatch("read_document", { file: handles["rows.csv"] });
  assert.deepEqual(csv.sheets, [{ name: "csv", rows: 3, text: "a,b\n1,2\n3,4" }]);
  const broken = await dispatch("read_document", { file: handles["journal.xlsx"] });
  assert.equal(broken.error.code, "unavailable", "bytes that are not a workbook");
});

test("read_document: a page of something that is not a PDF, an unreadable PDF and an unknown handle are errors; other files only get a kind", async () => {
  const { w, dispatch, files } = await documentTools({ loadPdf: pdfLibrary([], { fail: true }) });
  await addToInbox(w.root, [file("notes.txt", "hello")], { folder: "Levi" });
  const handles = await files();
  assert.equal((await dispatch("read_document", { file: handles["photo.jpg"], page: 1 })).error.code, "invalid_argument");
  assert.equal((await dispatch("read_document", { file: handles["policy.pdf"] })).error.code, "unavailable");
  assert.deepEqual(await dispatch("read_document", { file: handles["notes.txt"] }), { ok: true, file: handles["notes.txt"], kind: "other" });
  assert.equal((await dispatch("read_document", { file: "F99" })).error.code, "not_found");
});

// --- regression: the first real run (16 October 2026) named rows R30 and R8 that were rows 32 and 9 of the table ---

async function sharedIdTable() {
  const tools = await toolContext();
  const { createDeclaration, listDeclarations, saveDraft } = await import("../declaration-store.js");
  const { directory, declaration } = await createDeclaration(tools.w.cohen.directory, { clientId: "id-Cohen", month: "2026-09" });
  await saveDraft(directory, declaration, [
    tableRow("a", ["01/09/2026", "202", "x", "First Shop", "", "1", "", "100", "100", "0"]),
    tableRow("split", ["02/09/2026", "200", "x", "Market", "", "7", "", "89.06", "75.47", "13.59"]),
    tableRow("split", ["02/09/2026", "200", "x", "Market", "", "7", "", "0", "0", "0"], { rawNet: "0", rawVat: "0" }),
    tableRow("c", ["03/09/2026", "203", "electricity", "Power Co", "", "9", "", "247.39", "211.44", "35.95"], { rawNet: "845.79", rawVat: "143.78" }),
  ]);
  tools.w.cohen.declarations = await listDeclarations(tools.w.cohen.directory);
  return tools;
}

test("two rows that share one documentId get two handles, each with its own row number", async () => {
  const { ctx, dispatch, client } = await sharedIdTable();
  const result = await dispatch("query_rows", { client: await client("Cohen"), month: "2026-09" });
  assert.deepEqual(result.rows.map((row) => row.position), [1, 2, 3, 4]);
  assert.equal(new Set(result.rows.map((row) => row.row)).size, 4, "four rows, four handles");
  assert.deepEqual(result.rows.map((row) => row.row), ["R1", "R2", "R3", "R4"], "so a handle is never off from the row number");
  assert.deepEqual([ctx.handles.get("R", "R2"), ctx.handles.get("R", "R3")], [
    { clientId: "id-Cohen", month: "2026-09", documentId: "split", position: 2 },
    { clientId: "id-Cohen", month: "2026-09", documentId: "split", position: 3 },
  ]);
});

test("query_rows gives the amount of the document and what the table shows, and flags an active row with nothing in it", async () => {
  const { dispatch, client } = await sharedIdTable();
  const cohen = await client("Cohen");
  const [, , zero, power] = (await dispatch("query_rows", { client: cohen, month: "2026-09" })).rows;
  assert.deepEqual([power.net, power.vat, power.total, power.recognized_total], [845.79, 143.78, 989.57, 247.39], "a home client recognises 25%: both amounts are given");
  assert.deepEqual([zero.total, zero.recognized_total, zero.flags], [0, 0, ["zero_amount"]]);
  assert.deepEqual((await dispatch("query_rows", { client: cohen, where: { flag: "zero_amount" } })).rows.map((row) => row.position), [3]);
  assert.deepEqual((await dispatch("query_rows", { client: await client("Levi"), where: { flag: "zero_amount" } })).rows, [], "no such row among the others");
});

test("a proposal names the row by its number, even when the row shares its documentId with another", async () => {
  const { ui, dispatch, client } = await sharedIdTable();
  const cohen = await client("Cohen");
  const rows = (await dispatch("query_rows", { client: cohen, month: "2026-09" })).rows;
  const result = await dispatch("propose_change", { client: cohen, title: "t", changes: [{ row: rows[2].row, field: "include", value: "false", reason: "אפסים" }] });
  assert.equal(result.ok, true);
  assert.deepEqual(ui.proposals[0].changes.map((change) => [change.position, change.documentId, change.month]), [[3, "split", "2026-09"]]);
});

test("the instruction has the agent read import files and name the wizard of the menu, and never extract a spreadsheet (4.7.1)", async () => {
  const { ORCHESTRATOR_PROMPT, AGENT_VERSION } = await import("../agent/prompts.js");
  const { default: listInbox } = await import("../agent/tools/list-inbox.js");
  assert.equal(AGENT_VERSION, "stand-in-2026-10-17f");
  assert.ok(ORCHESTRATOR_PROMPT.includes("read every spreadsheet, and every PDF that does not look like an invoice"));
  assert.ok(ORCHESTRATOR_PROMPT.includes("with read_document, and never extract a spreadsheet with the vision model"));
  assert.ok(ORCHESTRATOR_PROMPT.includes("say plainly when you cannot tell what a file is"));
  assert.doesNotMatch(ORCHESTRATOR_PROMPT, /ignore spreadsheets|tell the user to use the Excel import/);
  for (const name of ["יומן קליטה", "כרטסת קודי מיון", "כרטסת", "דיווח הכנסות תקופתי"]) assert.ok(ORCHESTRATOR_PROMPT.includes(name), name);
  // The labels the agent quotes are the labels of the menu in index.html; a renamed button must change the instruction too.
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const menu = html.match(/<details[^>]*id="add-documents-menu">([\s\S]*?)<\/details>/)[1];
  const summary = menu.match(/<summary[^>]*>([^<]+)<\/summary>/)[1];
  assert.ok(ORCHESTRATOR_PROMPT.includes(`menu "${summary}"`));
  // The journal goes through prepare_import now; the menu items that remain for the other kinds are quoted.
  for (const id of ["check-ledger", "import-income-report"]) {
    const label = menu.match(new RegExp(`id="${id}"[^>]*>([^<]+)</button>`))[1];
    assert.ok(ORCHESTRATOR_PROMPT.includes(`"${label}"`), `${id}: ${label}`);
  }
  assert.doesNotMatch(listInbox.description, /not processed by the agent/);
  assert.match(listInbox.description, /never read with the vision model/);
});

test("the instruction tells the model what the user can and cannot do: no handles, no apply button, row numbers, both amounts", async () => {
  const { ORCHESTRATOR_PROMPT } = await import("../agent/prompts.js");
  const { default: proposeChange } = await import("../agent/tools/propose-change.js");
  const { default: queryRows } = await import("../agent/tools/query-rows.js");
  assert.match(ORCHESTRATOR_PROMPT, /by its number/);
  assert.match(ORCHESTRATOR_PROMPT, /handles like R12, F3, C1, Q2 or P1 are internal/);
  assert.match(ORCHESTRATOR_PROMPT, /recognized_total/);
  assert.match(ORCHESTRATOR_PROMPT, /zero_amount/);
  assert.match(ORCHESTRATOR_PROMPT, /Do not assume the gender/);
  assert.ok(ORCHESTRATOR_PROMPT.includes("Always ask through ask_user (buttons): never end your answer with a question in plain text"));
  assert.ok(ORCHESTRATOR_PROMPT.includes("the user decides with the button \"החל\""), "the card can be applied now");
  assert.ok(ORCHESTRATOR_PROMPT.includes("A name match alone is no proof. Never add a row for a document whose client is not proven."));
  assert.ok(ORCHESTRATOR_PROMPT.includes("call move_file_to_declaration with every month in which it has rows"));
  assert.doesNotMatch(ORCHESTRATOR_PROMPT, /not available yet|cannot be applied/);
  assert.ok(ORCHESTRATOR_PROMPT.includes("ONE question for all the files whose client is not proven yet"));
  assert.ok(ORCHESTRATOR_PROMPT.includes("A file the user has already answered about is never asked about again."));
  assert.ok(ORCHESTRATOR_PROMPT.includes("Never say that all the documents were processed unless every file you listed"));
  assert.doesNotMatch(ORCHESTRATOR_PROMPT, /\b(she|her)\b/);
  assert.match(proposeChange.description, /applies the ones that stay ticked/);
  assert.doesNotMatch(proposeChange.description, /the card cannot be applied/);
  assert.match(queryRows.description, /position is the row number of the # column/);
});

test("the instruction sends a journal to prepare_import and never lets the model say that something was imported (4.7.2)", async () => {
  const { ORCHESTRATOR_PROMPT } = await import("../agent/prompts.js");
  const { default: prepareImport } = await import("../agent/tools/prepare-import.js");
  assert.ok(ORCHESTRATOR_PROMPT.includes("is prepared with prepare_import, kind journal"));
  assert.ok(ORCHESTRATOR_PROMPT.includes("you import nothing, the user opens the wizard, so never say that a file was imported"));
  assert.ok(ORCHESTRATOR_PROMPT.includes("its counts and problems, never numbers of your own"));
  assert.ok(ORCHESTRATOR_PROMPT.includes('the button "פתח אשף"'));
  assert.ok(ORCHESTRATOR_PROMPT.includes("prepare an import file for the user's wizard (prepare_import)"));
  assert.doesNotMatch(ORCHESTRATOR_PROMPT, /you cannot import them yet/);
  assert.match(prepareImport.description, /write nothing and the wizard opens only when the user clicks/);
  assert.deepEqual(prepareImport.schema.properties.kind.enum, ["journal"], "only the kinds that are built");
});
