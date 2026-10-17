// add_rows and move_file_to_declaration (docs/AGENT_TOOLS.md, 5.3) on real stores in memory.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadDeclaration, listDeclarations } from "../declaration-store.js";
import { readInboxIndex } from "../inbox-store.js";
import { createContext } from "../agent/run.js";
import { createDefaultRegistry } from "../agent/index.js";
import { createServices } from "../agent/services.js";
import { call, rawRecord, recordingUi, scriptedExtraction, toolContext, world } from "./agent-fixtures.mjs";
import { listPaths, putFile, readFileBytes } from "./memory-binary-directory.mjs";

const answers = (...records) => ({ records });
const sha = (text) => createHash("sha256").update(text).digest("hex");

// A run with an extraction script; files() gives the handles, factsOf(name) extracts a file and gives its fact handles.
async function session(script, options = {}) {
  const tools = await toolContext({ extraction: scriptedExtraction(script.map((records) => answers(...records))), ...options });
  const handles = await tools.files();
  const factsOf = async (name) => (await tools.dispatch("extract_document", { file: handles[name] })).documents.map((doc) => doc.fact);
  return { ...tools, handles, factsOf, levi: await tools.client("Levi") };
}
// What the model sends: a key that is undefined is not sent at all.
const decision = (fact, extra = {}) => Object.fromEntries(Object.entries({ fact, routed_by: "vat_id", decision: "expense", account: "202", needs_review: false, reason: "חשבונית משרדית", ...extra }).filter(([, value]) => value !== undefined));
const tableOf = async (w, month = "2026-02") => (await loadDeclaration(w.levi.directory, month)).draft.rows;

test("add_rows: an invoice for the client becomes a ready row at the end of the table, with everything copied from the fact", async () => {
  const { w, ctx, dispatch, factsOf, levi } = await session([[rawRecord()]]);
  const [fact] = await factsOf("photo.jpg");
  const result = await dispatch("add_rows", { client: levi, rows: [decision(fact)] });
  assert.equal(result.ok, true);
  const [added] = result.rows;
  assert.deepEqual([added.fact, added.state, added.month, added.position, added.status, added.reasons, added.excluded], [fact, "created", "2026-02", 4, "ready", [], null]);
  assert.match(added.row, /^R\d+$/);
  assert.equal("file" in added || "fileHash" in added, false, "no internal key reaches the model");
  const rows = await tableOf(w);
  assert.equal(rows.length, 4);
  const row = rows[3];
  assert.deepEqual(row.values, ["20/02/26", "202", "paper", "Paper Shop", "512345679", "2002", "", "236.00", "200.00", "36.00", "100", "100"]);
  assert.deepEqual([row.active, row.statusText, row.statusClass, row.reference, row.documentKind, row.agentOpinion, row.confidence], [true, "מוכן לייצוא", "ready", "INV-2002", "expense_invoice", "חשבונית משרדית", "92%"]);
  assert.deepEqual([row.agent.run, row.agent.version, row.agent.fact, row.agent.page, row.agent.reasons], [ctx.run.id, "stand-in-2026-10-17e", fact, null, []]);
  assert.equal(row.agent.file.length, 64);
  assert.equal(ctx.handles.get("R", added.row).position, 4);
  assert.equal(ctx.run.factsUsed.has(fact), true);
  assert.equal(ctx.run.addedEntries.length, 1);
});

test("add_rows: the table is copied once before the first write of the run, and not again for a second row", async () => {
  const { w, dispatch, factsOf, levi } = await session([[rawRecord(), rawRecord({ document_number: "INV-2003", net: 50, vat: 9, total: 59 })]]);
  const facts = await factsOf("photo.jpg");
  const before = (await listPaths(w.root)).filter((path) => path.includes("draft-table.before-agent-")).length;
  await dispatch("add_rows", { client: levi, rows: [decision(facts[0])] });
  await dispatch("add_rows", { client: levi, rows: [decision(facts[1])] });
  const copies = (await listPaths(w.root)).filter((path) => path.includes("draft-table.before-agent-"));
  assert.equal(copies.length - before, 1);
  assert.ok(copies.at(-1).startsWith("clients/Levi/declarations/2026-02/"));
  const copied = JSON.parse(new TextDecoder().decode(await readFileBytes(w.root, copies.at(-1))));
  assert.equal(copied.rows.length, 3, "the copy holds the table as it was before the agent");
});

test("add_rows: the decision decides the status; an account outside the chart is dropped and said so", async () => {
  const { w, dispatch, factsOf, levi } = await session([[1, 2, 3, 4, 5].map((n) => rawRecord({ document_number: `N-${n}`, net: 10 * n, vat: 0, total: 10 * n }))]);
  const [f1, f2, f3, f4, f5] = await factsOf("photo.jpg");
  const result = await dispatch("add_rows", { client: levi, rows: [
    decision(f1, { needs_review: true }),
    decision(f2, { decision: "not_expense", account: undefined }),
    decision(f3, { decision: "unclear", account: undefined }),
    decision(f4, { account: undefined }),
    decision(f5, { account: "999" }),
  ] });
  assert.deepEqual(result.rows.map((row) => row.status), ["review", "review", "review", "review", "review"]);
  assert.equal(result.rows[4].account_rejected, true);
  assert.match(result.rows[4].message, /999.*not in the chart/);
  const rows = (await tableOf(w)).slice(3);
  assert.deepEqual(rows.map((row) => [row.statusText, row.active, row.values[1]]), [
    ["נדרש עיון", true, "202"], ["לא הוצאה — נדרש אישור", false, ""], ["נדרש עיון", false, ""], ["נדרש קוד מיון", false, ""], ["נדרש קוד מיון", false, ""],
  ]);
});

test("add_rows: the proof of the client: the folder of the file, or the VAT number of the buyer; nothing else counts", async () => {
  const { dispatch, factsOf, levi } = await session([[rawRecord()], [rawRecord({ buyer_vat_id: "999999990", document_number: "B-1" })]]);
  const [photo] = await factsOf("photo.jpg"); // in _unsorted, the buyer is Levi
  const [policy] = await factsOf("policy.pdf"); // in the folder of Levi, the buyer is someone else
  const add = async (fact, routed_by) => (await dispatch("add_rows", { client: levi, rows: [decision(fact, { routed_by })] })).rows[0];
  assert.equal((await add(policy, "folder")).state, "created", "the folder of the client");
  const unsorted = await add(photo, "folder");
  assert.deepEqual([unsorted.state, unsorted.error.code], ["rejected", "not_allowed"]);
  assert.match(unsorted.error.message, /not in the inbox folder/, "_unsorted is no proof");
  assert.equal((await add(photo, "vat_id")).state, "created", "the VAT number of the buyer");
});

test("add_rows: a buyer that is another business, or no buyer on the document, is no proof by VAT number", async () => {
  const other = await session([[rawRecord({ buyer_vat_id: "999999990" })]]);
  const [fact] = await other.factsOf("photo.jpg");
  const wrong = (await other.dispatch("add_rows", { client: other.levi, rows: [decision(fact)] })).rows[0];
  assert.deepEqual([wrong.state, wrong.error.code], ["rejected", "not_allowed"]);
  assert.match(wrong.error.message, /VAT number of the buyer/);
  const noBuyer = await session([[rawRecord({ buyer_vat_id: null })]]);
  const [lonely] = await noBuyer.factsOf("photo.jpg");
  assert.equal((await noBuyer.dispatch("add_rows", { client: noBuyer.levi, rows: [decision(lonely)] })).rows[0].error.code, "not_allowed");
});

test("add_rows: routed by the user needs a question about this file, answered by a button that carries this client", async () => {
  const click = (id) => ({ type: "option", id });
  const { dispatch, factsOf, levi, client, files } = await session([[rawRecord({ buyer_vat_id: null })], [rawRecord({ buyer_vat_id: null, document_number: "X-2" })]], { answers: [click("levi"), { type: "dismissed" }, click("cohen")] });
  const handles = await files();
  const [photo] = await factsOf("photo.jpg");
  const cohen = await client("Cohen");
  const ask = async (file, question) => (await dispatch("ask_user", {
    question, allow_other: false, about: { files: [file] },
    options: [{ id: "levi", label: "Levi", client: levi }, { id: "cohen", label: "Cohen", client: cohen }],
  })).ask;
  const forLevi = await ask(handles["photo.jpg"], "Whose is this?");
  const row = (extra = {}) => ({ client: levi, rows: [decision(photo, { routed_by: "user", ...extra })] });
  assert.equal((await dispatch("add_rows", row({ routing_ask: forLevi }))).rows[0].state, "created", "the user clicked Levi");

  const [second] = await factsOf("policy.pdf");
  const dismissed = await ask(handles["policy.pdf"], "Fourth?");
  const forCohen = await ask(handles["policy.pdf"], "And this one?");
  const refused = (await dispatch("add_rows", { client: levi, rows: [decision(second, { routed_by: "user", routing_ask: forCohen })] })).rows[0];
  assert.deepEqual([refused.state, refused.error.code, refused.error.message], ["rejected", "not_allowed", "The user did not choose this client for this file."]);
  assert.match((await dispatch("add_rows", { client: levi, rows: [decision(second, { routed_by: "user", routing_ask: forLevi })] })).rows[0].error.message, /not about the file/);
  assert.match((await dispatch("add_rows", { client: levi, rows: [decision(second, { routed_by: "user", routing_ask: dismissed })] })).rows[0].error.message, /not answered with a button/);
  assert.equal((await dispatch("add_rows", { client: levi, rows: [decision(second, { routed_by: "user" })] })).rows[0].error.code, "invalid_argument", "routing_ask is required");
  assert.equal((await dispatch("add_rows", { client: levi, rows: [decision(second, { routed_by: "user", routing_ask: "Q99" })] })).rows[0].error.code, "not_found");
});

test("ask_user: one question for several files routes all of them; the same files are never asked about twice", async () => {
  const { dispatch, factsOf, levi, handles, client, ui } = await session([[rawRecord({ buyer_vat_id: null })], [rawRecord({ buyer_vat_id: null, document_number: "X-2" })]], { answers: [{ type: "option", id: "levi" }] });
  const [photo] = await factsOf("photo.jpg");
  const [policy] = await factsOf("policy.pdf");
  const cohen = await client("Cohen");
  const both = [handles["photo.jpg"], handles["policy.pdf"]];
  const options = [{ id: "levi", label: "Levi", client: levi }, { id: "cohen", label: "Cohen", client: cohen }];
  const first = await dispatch("ask_user", { question: "Whose are these?", options, allow_other: false, about: { files: both } });
  assert.equal(ui.cards.length, 1);
  assert.deepEqual(ui.cards[0].about.files.map((file) => file.file), both);
  for (const fact of [photo, policy]) {
    assert.equal((await dispatch("add_rows", { client: levi, rows: [decision(fact, { routed_by: "user", routing_ask: first.ask })] })).rows[0].state, "created");
  }
  // Another wording, one of the files, or both again: the user is not asked, the earlier answer comes back.
  const again = await dispatch("ask_user", { question: "And the second one?", options, allow_other: false, about: { files: [handles["policy.pdf"]] } });
  const twice = await dispatch("ask_user", { question: "Please confirm", options, allow_other: false, about: { files: both } });
  assert.equal(ui.cards.length, 1, "no second card");
  assert.deepEqual([again.ask, again.already_answered, twice.ask, twice.already_answered], [first.ask, true, first.ask, true]);
});

test("ask_user: a file that was dismissed or answered with a typed text is asked about again", async () => {
  const { dispatch, handles, levi, ui } = await session([[rawRecord()]], { answers: [{ type: "dismissed" }, { type: "option", id: "levi" }] });
  const options = [{ id: "levi", label: "Levi", client: levi }, { id: "x", label: "X" }];
  const about = { files: [handles["photo.jpg"]] };
  await dispatch("ask_user", { question: "First?", options, allow_other: false, about });
  const second = await dispatch("ask_user", { question: "Second?", options, allow_other: false, about });
  assert.equal(ui.cards.length, 2);
  assert.equal(second.already_answered, undefined);
});

test("add_rows: the same document as a row of the table is added as an inactive duplicate with its reason", async () => {
  const { w, dispatch, factsOf, levi } = await session([[rawRecord({ date: "2026-02-14", document_number: "INV-1001", net: 100, vat: 18, total: 118 })]]);
  const [fact] = await factsOf("photo.jpg");
  const [added] = (await dispatch("add_rows", { client: levi, rows: [decision(fact)] })).rows;
  assert.deepEqual([added.status, added.excluded, added.reasons.includes("duplicate")], ["review", "duplicate", true]);
  const row = (await tableOf(w)).at(-1);
  assert.deepEqual([row.active, row.autoExclude, row.statusText, row.statusClass], [false, "duplicate", "כפילות של שורה 1 בהצהרה זו", "review"]);
  assert.match(row.agentOpinion, /לבדיקה: .*כפילות/);
});

test("add_rows: a document of the previous year is an inactive row; one of a filed month goes to the first open month", async () => {
  const { w, dispatch, factsOf, levi } = await session([[rawRecord({ date: "2025-12-20", document_number: "OLD-1" })], [rawRecord({ date: "2026-01-10", document_number: "JAN-1" })]]);
  const [old] = await factsOf("photo.jpg");
  const [jan] = await factsOf("policy.pdf");
  const first = (await dispatch("add_rows", { client: levi, rows: [decision(old)] })).rows[0];
  assert.deepEqual([first.excluded, first.status], ["previous-year", "review"]);
  const second = (await dispatch("add_rows", { client: levi, rows: [decision(jan, { routed_by: "vat_id" })] })).rows[0];
  assert.deepEqual([second.state, second.month, second.excluded], ["moved_month", "2026-02", null]);
  assert.equal((await tableOf(w, "2026-01")).length, 1, "the filed month is untouched");
  assert.equal((await tableOf(w)).length, 5);
});

test("add_rows: a month after the last filed one that has no declaration yet gets one, open, and the sidebar is told", async () => {
  const created = [];
  const w = await world({ extraction: scriptedExtraction([answers(rawRecord({ date: "2026-03-05", document_number: "MAR-1" }))]) });
  const services = createServices({
    getDataRoot: () => w.root, getClients: () => w.clients, extraction: scriptedExtraction([answers(rawRecord({ date: "2026-03-05", document_number: "MAR-1" }))]),
    onDeclarationCreated: (clientId, month) => created.push([clientId, month]),
  });
  const ctx = createContext({ services, ui: recordingUi() });
  const registry = createDefaultRegistry();
  const run = (name, args) => registry.dispatch({ name, args }, ctx);
  const photo = (await run("list_inbox", { kind: "image" })).files[0].file;
  const fact = (await run("extract_document", { file: photo })).documents[0].fact;
  const levi = (await run("find_client", { name: "Levi" })).matches[0].client;
  const [added] = (await run("add_rows", { client: levi, rows: [decision(fact)] })).rows;
  assert.deepEqual([added.state, added.month, added.position], ["created", "2026-03", 1], "the month of the document itself, so it was not moved");
  assert.deepEqual(created, [["id-Levi", "2026-03"]]);
  const list = await listDeclarations(w.levi.directory);
  assert.deepEqual(list.map((item) => [item.declaration.month, item.declaration.status]).sort(), [["2026-01", "closed"], ["2026-02", "open"], ["2026-03", "open"]]);
  assert.equal((await loadDeclaration(w.levi.directory, "2026-03")).draft.rows.length, 1);
  assert.equal((await listPaths(w.root)).filter((path) => path.includes("declarations/2026-03/draft-table.before-agent-")).length, 1, "the new table is copied too");
});

test("add_rows: the month the user chose with a button, and nothing else", async () => {
  const click = (id) => ({ type: "option", id });
  const { w, dispatch, factsOf, levi, files } = await session([[rawRecord({ date: "2026-02-20" })]], { answers: [click("march"), click("jan")] });
  const handles = await files();
  const [fact] = await factsOf("photo.jpg");
  const options = [{ id: "march", label: "03/2026", month: "2026-03" }, { id: "jan", label: "01/2026", month: "2026-01" }];
  const march = (await dispatch("ask_user", { question: "Which month?", options, allow_other: false, about: { files: [handles["photo.jpg"]] } })).ask;
  const wrongMonth = (await dispatch("add_rows", { client: levi, rows: [decision(fact, { month_override: { month: "2026-04", ask: march } })] })).rows[0];
  assert.deepEqual([wrongMonth.state, wrongMonth.error.message], ["rejected", "The user did not choose this month for this file."]);
  const done = (await dispatch("add_rows", { client: levi, rows: [decision(fact, { month_override: { month: "2026-03", ask: march } })] })).rows[0];
  assert.deepEqual([done.state, done.month], ["moved_month", "2026-03"]);
  assert.equal((await tableOf(w, "2026-03")).length, 1);

  const { dispatch: again, factsOf: more, levi: client, files: filesOf } = await session([[rawRecord({ document_number: "J-1" })]], { answers: [click("jan")] });
  const [jan] = await more("photo.jpg");
  const ask = (await again("ask_user", { question: "Which month?", options, allow_other: false, about: { files: [(await filesOf())["photo.jpg"]] } })).ask;
  const locked = (await again("add_rows", { client, rows: [decision(jan, { month_override: { month: "2026-01", ask } })] })).rows[0];
  assert.deepEqual([locked.state, locked.error.code], ["rejected", "locked"]);
});

test("add_rows: a second call for the same fact changes nothing; a second copy of a document in the same run is a duplicate", async () => {
  const { w, dispatch, factsOf, levi } = await session([[rawRecord({ document_number: "SAME-1" })], [rawRecord({ document_number: "SAME-1" })]]);
  const [one] = await factsOf("photo.jpg");
  const [two] = await factsOf("policy.pdf");
  const first = (await dispatch("add_rows", { client: levi, rows: [decision(one)] })).rows[0];
  const again = (await dispatch("add_rows", { client: levi, rows: [decision(one)] })).rows[0];
  assert.deepEqual([again.state, again.row, again.month, again.position], ["already_added", first.row, first.month, first.position]);
  assert.equal((await tableOf(w)).length, 4);
  const copy = (await dispatch("add_rows", { client: levi, rows: [decision(two, { routed_by: "folder" })] })).rows[0];
  assert.deepEqual([copy.excluded, copy.status], ["duplicate", "review"]);
  assert.equal((await tableOf(w)).length, 5, "the copy is kept as an inactive row");
});

test("add_rows: the groups of one invoice share one documentId and are not duplicates of each other", async () => {
  const { w, dispatch, factsOf, levi } = await session([[rawRecord({ document_number: "SPLIT-1", net: 100, vat: 18, total: 118 }), rawRecord({ document_number: "SPLIT-1", net: 50, vat: 0, total: 50, vat_percent: 0 })]]);
  const facts = await factsOf("photo.jpg");
  const rows = (await dispatch("add_rows", { client: levi, rows: facts.map((fact) => decision(fact)) })).rows;
  assert.deepEqual(rows.map((row) => [row.state, row.excluded, row.position]), [["created", null, 4], ["created", null, 5]]);
  const table = await tableOf(w);
  assert.equal(table[3].documentId, table[4].documentId);
  assert.match(table[3].documentId, /^agent-[0-9a-f]{16}-p0$/);
});

test("add_rows: a bad row does not stop the others; unknown handles are refused in place", async () => {
  const { dispatch, factsOf, levi } = await session([[rawRecord({ document_number: "G-1" }), rawRecord({ buyer_vat_id: "999999990", document_number: "G-2" })]]);
  const [good, wrong] = await factsOf("photo.jpg");
  const result = await dispatch("add_rows", { client: levi, rows: [decision(wrong), decision("F9.9"), decision(good)] });
  assert.deepEqual(result.rows.map((row) => row.state), ["rejected", "rejected", "created"]);
  assert.equal(result.rows[1].error.code, "not_found");
  assert.equal((await dispatch("add_rows", { client: "C99", rows: [decision(good)] })).error.code, "not_found");
  assert.equal((await dispatch("add_rows", { client: levi, rows: [] })).error.code, "invalid_argument");
  assert.equal((await dispatch("add_rows", { client: levi, rows: Array.from({ length: 41 }, () => decision(good)) })).error.code, "invalid_argument");
  assert.equal((await dispatch("add_rows", { client: levi, rows: [{ ...decision(good), amount: 5 }] })).error.code, "invalid_argument", "the model cannot give a value of the row");
});

test("add_rows: when the table cannot be copied, nothing is written", async () => {
  const w = await world({ extraction: scriptedExtraction([answers(rawRecord())]) });
  const services = Object.freeze({ ...w.services, tables: Object.freeze({ copyBeforeAgent: async () => { throw new Error("disk full"); } }) });
  const ctx = createContext({ services, ui: recordingUi() });
  const registry = createDefaultRegistry();
  const run = (name, args) => registry.dispatch({ name, args }, ctx);
  const photo = (await run("list_inbox", { kind: "image" })).files[0].file;
  const fact = (await run("extract_document", { file: photo })).documents[0].fact;
  const levi = (await run("find_client", { name: "Levi" })).matches[0].client;
  const result = (await run("add_rows", { client: levi, rows: [decision(fact)] })).rows[0];
  assert.deepEqual([result.state, result.error.code], ["rejected", "unavailable"]);
  assert.equal((await tableOf(w)).length, 3);
});

test("add_rows: the open table in the page takes the rows through the page, and is saved before the copy", async () => {
  const appended = [], flushed = [];
  const live = { clientId: "id-Levi", month: "2026-02", rows: [], append: async (snapshots) => { appended.push(...snapshots); return snapshots.map((_, index) => 10 + index); }, flush: async () => { flushed.push("flush"); } };
  const { w, dispatch, factsOf, levi } = await session([[rawRecord()]], { liveTable: () => live });
  const [fact] = await factsOf("photo.jpg");
  const result = (await dispatch("add_rows", { client: levi, rows: [decision(fact)] })).rows[0];
  assert.deepEqual([result.state, result.position, appended.length, flushed], ["created", 10, 1, ["flush"]]);
  assert.equal((await tableOf(w)).length, 3, "the file is not written twice: the page saves it");
  assert.equal(appended[0].agent.fact, fact);
});

// --- move_file_to_declaration ---

async function withRow(records, extra = {}, rowOptions = {}) {
  const tools = await session(records, extra);
  const facts = await tools.factsOf("photo.jpg");
  const result = await tools.dispatch("add_rows", { client: tools.levi, rows: facts.map((fact) => decision(fact, rowOptions)) });
  return { ...tools, facts, added: result.rows };
}

test("move_file_to_declaration: the original is copied into the images, the rows get it, and the file leaves the inbox", async () => {
  const { w, dispatch, levi, handles, ctx } = await withRow([[rawRecord()]]);
  const result = await dispatch("move_file_to_declaration", { file: handles["photo.jpg"], client: levi, months: ["2026-02"] });
  assert.deepEqual(result, { ok: true, file: handles["photo.jpg"], state: "filed", images: [{ month: "2026-02", image_file: "001.jpg" }], rows: 1, inbox_removed: true });
  assert.equal(new TextDecoder().decode(await readFileBytes(w.root, "clients/Levi/declarations/2026-02/images/001.jpg")), "jpeg-bytes");
  const row = (await tableOf(w)).at(-1);
  assert.deepEqual([row.imageFile, row.imageIndex], ["001.jpg", 1]);
  assert.equal((await readInboxIndex(w.root)).files.some((entry) => entry.name === "photo.jpg"), false);
  assert.equal((await listPaths(w.root)).includes("inbox/_unsorted/photo.jpg"), false);
  assert.equal(ctx.run.fileStatus.get(handles["photo.jpg"]), "filed");
  assert.equal((await dispatch("list_inbox", { status: "filed" })).files.length, 0, "the file is gone from the list");
  const again = await dispatch("move_file_to_declaration", { file: handles["photo.jpg"], client: levi, months: ["2026-02"] });
  assert.deepEqual([again.ok, again.state], [true, "already_filed"]);
});

test("move_file_to_declaration: the number continues after the images of the month, and a PDF keeps its extension", async () => {
  const tools = await session([[rawRecord({ document_number: "PDF-1" })]]);
  await tools.w.putFile("clients/Levi/declarations/2026-02/images/003.jpg", "old");
  await tools.w.putFile("clients/Levi/declarations/2026-02/images/source-2026-10-13T15-17-12.pdf", "legacy");
  const [fact] = await tools.factsOf("policy.pdf");
  await tools.dispatch("add_rows", { client: tools.levi, rows: [decision(fact, { routed_by: "folder" })] });
  const result = await tools.dispatch("move_file_to_declaration", { file: tools.handles["policy.pdf"], client: tools.levi, months: ["2026-02"] });
  assert.deepEqual(result.images, [{ month: "2026-02", image_file: "004.pdf" }]);
  assert.deepEqual((await tableOf(tools.w)).at(-1).imageIndex, 4);
});

test("move_file_to_declaration: a file with no row made in this run is not moved; the months must be exactly those that hold rows", async () => {
  const { dispatch, levi, handles, w } = await session([[rawRecord()]]);
  assert.equal((await dispatch("move_file_to_declaration", { file: handles["photo.jpg"], client: levi, months: ["2026-02"] })).error.code, "conflict");
  assert.equal((await readInboxIndex(w.root)).files.length, 3);

  const two = await session([[rawRecord({ date: "2026-02-20", document_number: "A-1" }), rawRecord({ date: "2026-03-05", document_number: "A-2", page: 2 })]]);
  const facts = await two.factsOf("photo.jpg");
  await two.dispatch("add_rows", { client: two.levi, rows: facts.map((fact) => decision(fact)) });
  const move = (months) => two.dispatch("move_file_to_declaration", { file: two.handles["photo.jpg"], client: two.levi, months });
  const missing = await move(["2026-02"]);
  assert.deepEqual([missing.error.code, missing.error.message], ["invalid_argument", "Rows of this file are also in 2026-03: give all the months."]);
  assert.equal((await move(["2026-02", "2026-03", "2026-05"])).error.code, "conflict");
  assert.equal((await move(["2026-2"])).error.code, "invalid_argument");
  const done = await move(["2026-03", "2026-02"]);
  assert.deepEqual([done.state, done.images.map((image) => image.month).sort(), done.rows], ["filed", ["2026-02", "2026-03"], 2]);
  assert.equal(new TextDecoder().decode(await readFileBytes(two.w.root, "clients/Levi/declarations/2026-03/images/001.jpg")), "jpeg-bytes");
});

test("move_file_to_declaration: a failure leaves the original in the inbox; a file that changed since it was indexed is refused", async () => {
  const { dispatch, levi, handles, w, ctx } = await withRow([[rawRecord()]]);
  const real = ctx.services;
  ctx.services = { ...real, files: { ...real.files, copyToDeclaration: async () => { throw new Error("disk full"); } } };
  const failed = await dispatch("move_file_to_declaration", { file: handles["photo.jpg"], client: levi, months: ["2026-02"] });
  assert.deepEqual([failed.ok, failed.error.code], [false, "unavailable"]);
  assert.equal((await listPaths(w.root)).includes("inbox/_unsorted/photo.jpg"), true);
  assert.notEqual(ctx.run.fileStatus.get(handles["photo.jpg"]), "filed");

  ctx.services = { ...real, rows: { ...real.rows, attachImage: async () => { throw new Error("cannot save"); } } };
  assert.equal((await dispatch("move_file_to_declaration", { file: handles["photo.jpg"], client: levi, months: ["2026-02"] })).error.code, "unavailable");
  assert.equal((await listPaths(w.root)).includes("inbox/_unsorted/photo.jpg"), true, "the rows could not get the image, so the original stays");

  ctx.services = real;
  await putFile(w.root, "inbox/_unsorted/photo.jpg", new TextEncoder().encode("changed on disk"));
  const changed = await dispatch("move_file_to_declaration", { file: handles["photo.jpg"], client: levi, months: ["2026-02"] });
  assert.equal(changed.error.code, "unavailable");
  assert.equal((await readInboxIndex(w.root)).files.some((entry) => entry.name === "photo.jpg"), true);
});

test("move_file_to_declaration: for the open table the page gives the rows their image", async () => {
  const attached = [];
  const live = { clientId: "id-Levi", month: "2026-02", rows: [], append: async (s) => s.map((_, i) => 4 + i), flush: async () => {}, attachImage: async (info) => { attached.push(info); return 1; } };
  const { dispatch, levi, handles } = await withRow([[rawRecord()]], { liveTable: () => live });
  const result = await dispatch("move_file_to_declaration", { file: handles["photo.jpg"], client: levi, months: ["2026-02"] });
  assert.deepEqual([result.state, result.rows], ["filed", 1]);
  assert.deepEqual(attached, [{ fileHash: sha("jpeg-bytes"), imageFile: "001.jpg", imageIndex: 1 }]);
});

test("a whole run: list, read, find the client, check, add the row, file the original, answer", async () => {
  const { runAgent } = await import("../agent/run.js");
  const { scriptedModel, reply, say } = await import("./agent-fixtures.mjs");
  const w = await world({ extraction: scriptedExtraction([answers(rawRecord({ document_number: "RUN-9" }))]) });
  const last = (request, name) => request.contents.at(-1).parts.map((part) => part.functionResponse).find((item) => item.name === name)?.response;
  const model = scriptedModel([
    reply(call("list_inbox", { kind: "image" })),
    (request) => reply(call("extract_document", { file: last(request, "list_inbox").files[0].file }), call("find_client", { name: "Levi" })),
    (request) => reply(call("facts_for", { fact: last(request, "extract_document").documents[0].fact, client: last(request, "find_client").matches[0].client })),
    (request) => reply(call("add_rows", { client: "C1", rows: [decision("F1.1", { reason: "חשבונית משרדית של הלקוח", needs_review: last(request, "facts_for").suggested_status !== "ready" })] })),
    () => reply(call("move_file_to_declaration", { file: "F1", client: "C1", months: ["2026-02"] })),
    (request) => reply(say(`added ${last(request, "move_file_to_declaration").state}`)),
  ]);
  const result = await runAgent({ model, system: "s", registry: createDefaultRegistry(), message: "go", services: w.services, ui: recordingUi() });
  assert.deepEqual([result.status, result.text], ["completed", "added filed"]);
  assert.deepEqual(result.added, [{ clientId: "id-Levi", month: "2026-02", count: 1 }], "the result says where the rows went");
  const rows = (await loadDeclaration(w.levi.directory, "2026-02")).draft.rows;
  assert.equal(rows.length, 4);
  assert.deepEqual([rows[3].statusClass, rows[3].imageFile, rows[3].agent.run], ["ready", "001.jpg", result.runId]);
  assert.equal((await readInboxIndex(w.root)).files.some((entry) => entry.name === "photo.jpg"), false);
});

test("a whole run: two moves called in one turn are done one after the other; both files are filed, both rows have their image", async () => {
  const { runAgent } = await import("../agent/run.js");
  const { scriptedModel, reply, say } = await import("./agent-fixtures.mjs");
  const w = await world({ extraction: scriptedExtraction([answers(rawRecord({ document_number: "P-1" })), answers(rawRecord({ document_number: "P-2" }))]) });
  const last = (request, name) => request.contents.at(-1).parts.map((part) => part.functionResponse).filter((item) => item.name === name).map((item) => item.response);
  let read = [];
  const model = scriptedModel([
    reply(call("list_inbox", {})),
    (request) => reply(...last(request, "list_inbox")[0].files.filter((file) => file.kind !== "spreadsheet").map((file) => call("extract_document", { file: file.file })), call("find_client", { name: "Levi" })),
    (request) => reply(call("add_rows", { client: last(request, "find_client")[0].matches[0].client, rows: (read = last(request, "extract_document")).map((item) => decision(item.documents[0].fact, { routed_by: "vat_id" })) })),
    (request) => reply(...read.map((item) => call("move_file_to_declaration", { file: item.file, client: "C1", months: ["2026-02"] }))),
    (request) => reply(say(last(request, "move_file_to_declaration").map((item) => item.state).join(","))),
  ]);
  const result = await runAgent({ model, system: "s", registry: createDefaultRegistry(), message: "go", services: w.services, ui: recordingUi() });
  assert.deepEqual([result.status, result.error, result.text], ["completed", undefined, "filed,filed"]);
  const rows = (await loadDeclaration(w.levi.directory, "2026-02")).draft.rows.filter((row) => row.agent?.run === result.runId);
  assert.ok(rows.length === 2 && rows.every((row) => row.imageFile), "every row of the run has its picture");
  assert.equal(new Set(rows.map((row) => row.imageFile)).size, rows.length, "every picture has its own number");
  assert.equal((await readInboxIndex(w.root)).files.some((entry) => entry.folder === "_unsorted"), false, "nothing of the run is left in the inbox");
  assert.equal((await readInboxIndex(w.root)).files.some((entry) => entry.name === "policy.pdf"), false);
});

test("a run that filed a file says which files it left in the inbox, from the run and not from the model", async () => {
  const { runAgent } = await import("../agent/run.js");
  const { scriptedModel, reply, say } = await import("./agent-fixtures.mjs");
  const w = await world({ extraction: scriptedExtraction([answers(rawRecord({ document_number: "L-1" }))]) });
  const last = (request, name) => request.contents.at(-1).parts.map((part) => part.functionResponse).find((item) => item.name === name)?.response;
  let photo = null;
  const model = scriptedModel([
    reply(call("list_inbox", {})),
    (request) => reply(call("extract_document", { file: (photo = last(request, "list_inbox").files.find((file) => file.name === "photo.jpg").file) }), call("find_client", { name: "Levi" })),
    (request) => reply(call("add_rows", { client: last(request, "find_client").matches[0].client, rows: [decision(last(request, "extract_document").documents[0].fact)] })),
    () => reply(call("move_file_to_declaration", { file: photo, client: "C1", months: ["2026-02"] })),
    () => reply(say("everything is processed")),
  ]);
  const ids = (await (await import("../inbox-store.js")).readInboxIndex(w.root)).files.map((file) => file.name);
  assert.ok(ids.includes("photo.jpg") && ids.includes("policy.pdf") && ids.includes("journal.xlsx"));
  const result = await runAgent({ model, system: "s", registry: createDefaultRegistry(), message: "go", services: w.services, ui: recordingUi() });
  assert.deepEqual([result.status, result.text], ["completed", "everything is processed"]);
  assert.deepEqual(result.left.map((file) => file.name), ["policy.pdf"], "the spreadsheet is not counted, the filed photo is gone");
});

test("a run that did no work on files reports nothing as left", async () => {
  const { runAgent } = await import("../agent/run.js");
  const { scriptedModel, reply, say } = await import("./agent-fixtures.mjs");
  const w = await world();
  const model = scriptedModel([reply(call("list_inbox", {})), reply(say("three files wait"))]);
  const result = await runAgent({ model, system: "s", registry: createDefaultRegistry(), message: "what is left", services: w.services, ui: recordingUi() });
  assert.equal(result.left, undefined);
});

test("extract_document: a file that is listed but gone from its folder is named as missing, not as unreadable", async () => {
  const { w, dispatch, handles } = await session([[rawRecord()]]);
  const folder = await (await w.root.getDirectoryHandle("inbox")).getDirectoryHandle("_unsorted");
  await folder.removeEntry("photo.jpg");
  const result = await dispatch("extract_document", { file: handles["photo.jpg"] });
  assert.deepEqual([result.ok, result.error.code], [false, "not_found"]);
  assert.match(result.error.message, /not in its folder/);
});
