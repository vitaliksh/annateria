// add_rows and move_file_to_declaration (docs/AGENT_TOOLS.md, 5.3) on real stores in memory.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { finalizeDeclaration, loadDeclaration, listDeclarations } from "../declaration-store.js";
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
const decision = (fact, extra = {}) => Object.fromEntries(Object.entries({ fact, decision: "expense", account: "202", needs_review: false, reason: "חשבונית משרדית", ...extra }).filter(([, value]) => value !== undefined));
const tableOf = async (w, month = "2026-02") => (await loadDeclaration(w.levi.directory, month)).draft.rows;

test("add_rows: an invoice for the client becomes a ready row at the end of the table, with everything copied from the fact", async () => {
  const { w, ctx, dispatch, factsOf, levi } = await session([[rawRecord()]], { skills: { classification: 3, "periods-and-duplicates": 2 } });
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
  assert.deepEqual([row.agent.run, row.agent.version, row.agent.fact, row.agent.page, row.agent.reasons], [ctx.run.id, "base-2026-11-06a", fact, null, []]);
  assert.equal(row.agent.file.length, 64);
  assert.deepEqual(row.agent.skills, { classification: 3, "periods-and-duplicates": 2 }, "the version of every skill of the run is in the row (5.1)");
  assert.equal(ctx.handles.get("R", added.row).position, 4);
  assert.equal(ctx.run.factsUsed.has(fact), true);
  assert.equal(ctx.run.addedEntries.length, 1);
});

// A bug report of 6 November 2026: the user opens a month and starts a run; the list of clients was read before the click, so every row
// was refused as locked. The state on disk is the truth.
test("add_rows: a month the user opened after the list of clients was read takes rows, and the agent is told it is open", async () => {
  const { w, dispatch, factsOf, levi } = await session([[rawRecord()]]);
  w.levi.declarations.find((item) => item.declaration.month === "2026-02").declaration.status = "closed"; // as the list read before the click
  assert.equal(await w.services.declarations.state("id-Levi", "2026-02"), "open");
  const profile = await w.services.clients.profile("id-Levi");
  assert.equal(profile.declarations.find((item) => item.month === "2026-02").status, "open");
  assert.equal((await w.services.rows.list("id-Levi", "2026-02"))[0].status, "open");
  const [fact] = await factsOf("photo.jpg");
  const result = await dispatch("add_rows", { client: levi, rows: [decision(fact)] });
  assert.equal(result.rows[0].state, "created");
  assert.equal((await tableOf(w)).length, 4);
});

test("add_rows: a month closed after the list of clients was read takes nothing", async () => {
  const { w, dispatch, factsOf, levi } = await session([[rawRecord()]]);
  const clientDirectory = w.levi.directory;
  const open = await loadDeclaration(clientDirectory, "2026-02");
  await finalizeDeclaration({ clientDirectory, declarationDirectory: open.directory, declaration: open.declaration, finalExport: "no-export", rows: open.draft.rows });
  const [fact] = await factsOf("photo.jpg");
  const { rows } = await dispatch("add_rows", { client: levi, rows: [decision(fact)] });
  assert.deepEqual([rows[0].state, rows[0].error.code], ["rejected", "locked"]);
  assert.equal((await tableOf(w)).length, 3);
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

// Step 9.6: every document of the month becomes a row of the month; what the facts doubt marks the row, never moves or refuses it.
test("add_rows: a buyer that is another business is written into the month and marked to look at; no buyer is no doubt", async () => {
  const { w, dispatch, factsOf, levi } = await session([[rawRecord({ buyer_vat_id: "999999990", document_number: "B-1" }), rawRecord({ buyer_vat_id: null, document_number: "B-2" })]]);
  const [other, none] = await factsOf("photo.jpg");
  const rows = (await dispatch("add_rows", { client: levi, rows: [decision(other), decision(none)] })).rows;
  assert.deepEqual(rows.map((row) => [row.state, row.month, row.status]), [["created", "2026-02", "review"], ["created", "2026-02", "ready"]]);
  assert.deepEqual(rows[0].reasons, ["buyer_mismatch"]);
  assert.match((await tableOf(w)).at(-2).agentOpinion, /המסמך מיועד לקונה אחר/);
});

test("add_rows: writes only into the month of the run; a run without one, another client and a locked month are refused", async () => {
  const { dispatch, factsOf, levi, client, ctx, w } = await session([[rawRecord({ document_number: "S-1" }), rawRecord({ document_number: "S-2" })]]);
  const [one, two] = await factsOf("photo.jpg");
  const cohen = await client("Cohen");
  const foreign = (await dispatch("add_rows", { client: cohen, rows: [decision(one)] })).rows[0];
  assert.deepEqual([foreign.state, foreign.error.code], ["rejected", "not_allowed"]);
  assert.match(foreign.error.message, /only into the open month 2026-02/);
  ctx.scope = null;
  const unscoped = (await dispatch("add_rows", { client: levi, rows: [decision(one)] })).rows[0];
  assert.deepEqual([unscoped.state, unscoped.error.code], ["rejected", "not_allowed"]);
  assert.match(unscoped.error.message, /No month is open/);
  ctx.scope = { ...w.scope, month: "2026-01" };
  const locked = (await dispatch("add_rows", { client: levi, rows: [decision(two)] })).rows[0];
  assert.deepEqual([locked.state, locked.error.code], ["rejected", "locked"]);
  assert.equal((await tableOf(w, "2026-01")).length, 1, "the locked month is untouched");
  assert.equal((await tableOf(w)).length, 3);
});

test("the services refuse a write outside the month of the run, whatever the tool asks (step 9.6)", async () => {
  const w = await world();
  const row = { documentId: "x", values: [] };
  await assert.rejects(() => w.services.rows.append("id-Levi", "2026-03", [row]), /Only the open month/);
  await assert.rejects(() => w.services.rows.append("id-Pcn", "2026-02", [row]), /Only the open month/);
  await assert.rejects(() => w.services.rows.attachImage("id-Pcn", "2026-02", "hash", { imageFile: "001.jpg", imageIndex: 1 }), /Only the open month/);
  await assert.rejects(() => w.services.declarations.create("id-Levi", "2026-03"), /Only the open month/);
  const entry = (await readInboxIndex(w.root)).files[0];
  await assert.rejects(() => w.services.files.copyToDeclaration(entry, "id-Pcn", "2026-02"), /Only the open month/);
  const unscoped = await world({ scope: null });
  await assert.rejects(() => unscoped.services.rows.append("id-Levi", "2026-02", [row]), /Only the open month/);
  assert.equal((await tableOf({ levi: w.levi })).length, 3);
  assert.deepEqual(await w.services.rows.append("id-Levi", "2026-02", [row]), [4], "the month of the run takes it");
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

test("add_rows: a document of the previous year is an inactive row; one of a filed month stays in the month of the run", async () => {
  const { w, dispatch, factsOf, levi } = await session([[rawRecord({ date: "2025-12-20", document_number: "OLD-1" })], [rawRecord({ date: "2026-01-10", document_number: "JAN-1" })]]);
  const [old] = await factsOf("photo.jpg");
  const [jan] = await factsOf("policy.pdf");
  const first = (await dispatch("add_rows", { client: levi, rows: [decision(old)] })).rows[0];
  assert.deepEqual([first.excluded, first.status], ["previous-year", "review"]);
  const second = (await dispatch("add_rows", { client: levi, rows: [decision(jan)] })).rows[0];
  assert.deepEqual([second.state, second.month, second.excluded, second.status, second.reasons], ["created", "2026-02", null, "review", ["doc_before_month"]], "the earlier month is filed and paid");
  assert.equal((await tableOf(w, "2026-01")).length, 1, "the filed month is untouched");
  assert.equal((await tableOf(w)).length, 5);
});

test("add_rows: a document for a period dated before the month is judged by its period, not marked for its date", async () => {
  const { dispatch, factsOf, levi } = await session([[rawRecord({ date: "2026-01-10", period_from: "2026-01-01", period_to: "2026-12-31", document_number: "YEAR-1" })]]);
  const [fact] = await factsOf("photo.jpg");
  const [added] = (await dispatch("add_rows", { client: levi, rows: [decision(fact)] })).rows;
  assert.equal(added.reasons.includes("doc_before_month"), false);
});

test("add_rows: a document dated after the month is written into the month and marked to look at; no month is made", async () => {
  const { w, dispatch, factsOf, levi } = await session([[rawRecord({ date: "2026-03-05", document_number: "MAR-1" })]]);
  const [fact] = await factsOf("photo.jpg");
  const [added] = (await dispatch("add_rows", { client: levi, rows: [decision(fact)] })).rows;
  assert.deepEqual([added.state, added.month, added.position, added.status], ["created", "2026-02", 4, "review"]);
  assert.deepEqual(added.reasons, ["doc_after_month"]);
  assert.match((await tableOf(w)).at(-1).agentOpinion, /תאריך המסמך אחרי חודש ההצהרה/);
  assert.deepEqual((await listDeclarations(w.levi.directory)).map((item) => item.declaration.month).sort(), ["2026-01", "2026-02"]);
  assert.equal((await dispatch("add_rows", { client: levi, rows: [{ ...decision(fact), month_override: { month: "2026-03", ask: "Q1" } }] })).error.code, "invalid_argument", "no month can be asked for");
});

test("add_rows: a second call for the same fact changes nothing; a second copy of a document in the same run is a duplicate", async () => {
  const { w, dispatch, factsOf, levi } = await session([[rawRecord({ document_number: "SAME-1" })], [rawRecord({ document_number: "SAME-1" })]]);
  const [one] = await factsOf("photo.jpg");
  const [two] = await factsOf("policy.pdf");
  const first = (await dispatch("add_rows", { client: levi, rows: [decision(one)] })).rows[0];
  const again = (await dispatch("add_rows", { client: levi, rows: [decision(one)] })).rows[0];
  assert.deepEqual([again.state, again.row, again.month, again.position], ["already_added", first.row, first.month, first.position]);
  assert.equal((await tableOf(w)).length, 4);
  const copy = (await dispatch("add_rows", { client: levi, rows: [decision(two)] })).rows[0];
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
  const { dispatch, factsOf, levi } = await session([[rawRecord({ document_number: "G-1" })]]);
  const [good] = await factsOf("photo.jpg");
  const result = await dispatch("add_rows", { client: levi, rows: [decision("F9.9"), decision(good)] });
  assert.deepEqual(result.rows.map((row) => row.state), ["rejected", "created"]);
  assert.equal(result.rows[0].error.code, "not_found");
  assert.equal((await dispatch("add_rows", { client: "C99", rows: [decision(good)] })).error.code, "not_found");
  assert.equal((await dispatch("add_rows", { client: levi, rows: [] })).error.code, "invalid_argument");
  assert.equal((await dispatch("add_rows", { client: levi, rows: Array.from({ length: 41 }, () => decision(good)) })).error.code, "invalid_argument");
  assert.equal((await dispatch("add_rows", { client: levi, rows: [{ ...decision(good), amount: 5 }] })).error.code, "invalid_argument", "the model cannot give a value of the row");
});

test("add_rows: when the table cannot be copied, nothing is written", async () => {
  const w = await world({ extraction: scriptedExtraction([answers(rawRecord())]) });
  const services = Object.freeze({ ...w.services, tables: Object.freeze({ copyBeforeAgent: async () => { throw new Error("disk full"); } }) });
  const ctx = createContext({ services, ui: recordingUi(), scope: w.scope });
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
  const result = await dispatch("move_file_to_declaration", { file: handles["photo.jpg"] });
  assert.deepEqual(result, { ok: true, file: handles["photo.jpg"], state: "filed", images: [{ month: "2026-02", image_file: "001.jpg" }], rows: 1, inbox_removed: true });
  assert.equal(new TextDecoder().decode(await readFileBytes(w.root, "clients/Levi/declarations/2026-02/images/001.jpg")), "jpeg-bytes");
  const row = (await tableOf(w)).at(-1);
  assert.deepEqual([row.imageFile, row.imageIndex], ["001.jpg", 1]);
  assert.equal((await readInboxIndex(w.root)).files.some((entry) => entry.name === "photo.jpg"), false);
  assert.equal((await listPaths(w.root)).includes("inbox/Levi/photo.jpg"), false);
  assert.equal(ctx.run.fileStatus.get(handles["photo.jpg"]), "filed");
  assert.equal((await dispatch("list_inbox", { status: "filed" })).files.length, 0, "the file is gone from the list");
  const again = await dispatch("move_file_to_declaration", { file: handles["photo.jpg"] });
  assert.deepEqual([again.ok, again.state], [true, "already_filed"]);
});

test("move_file_to_declaration: the number continues after the images of the month, and a PDF keeps its extension", async () => {
  const tools = await session([[rawRecord({ document_number: "PDF-1" })]]);
  await tools.w.putFile("clients/Levi/declarations/2026-02/images/003.jpg", "old");
  await tools.w.putFile("clients/Levi/declarations/2026-02/images/source-2026-10-13T15-17-12.pdf", "legacy");
  const [fact] = await tools.factsOf("policy.pdf");
  await tools.dispatch("add_rows", { client: tools.levi, rows: [decision(fact)] });
  const result = await tools.dispatch("move_file_to_declaration", { file: tools.handles["policy.pdf"] });
  assert.deepEqual(result.images, [{ month: "2026-02", image_file: "004.pdf" }]);
  assert.deepEqual((await tableOf(tools.w)).at(-1).imageIndex, 4);
});

test("move_file_to_declaration: a file with no row made in this run is not moved; documents of two months share one image of the month", async () => {
  const { dispatch, handles, w } = await session([[rawRecord()]]);
  assert.equal((await dispatch("move_file_to_declaration", { file: handles["photo.jpg"] })).error.code, "conflict");
  assert.equal((await readInboxIndex(w.root)).files.length, 3);

  const two = await session([[rawRecord({ date: "2026-02-20", document_number: "A-1" }), rawRecord({ date: "2026-01-05", document_number: "A-2", page: 2 })]]);
  const facts = await two.factsOf("photo.jpg");
  await two.dispatch("add_rows", { client: two.levi, rows: facts.map((fact) => decision(fact)) });
  assert.equal((await two.dispatch("move_file_to_declaration", { file: two.handles["photo.jpg"], months: ["2026-01"] })).error.code, "invalid_argument", "no month can be given");
  const done = await two.dispatch("move_file_to_declaration", { file: two.handles["photo.jpg"] });
  assert.deepEqual([done.state, done.images, done.rows], ["filed", [{ month: "2026-02", image_file: "001.jpg" }], 2]);
  assert.equal((await listPaths(two.w.root)).some((path) => path.startsWith("clients/Levi/declarations/2026-01/images/")), false);
});

test("move_file_to_declaration: a failure leaves the original in the inbox; a file that changed since it was indexed is refused", async () => {
  const { dispatch, levi, handles, w, ctx } = await withRow([[rawRecord()]]);
  const real = ctx.services;
  ctx.services = { ...real, files: { ...real.files, copyToDeclaration: async () => { throw new Error("disk full"); } } };
  const failed = await dispatch("move_file_to_declaration", { file: handles["photo.jpg"] });
  assert.deepEqual([failed.ok, failed.error.code], [false, "unavailable"]);
  assert.equal((await listPaths(w.root)).includes("inbox/Levi/photo.jpg"), true);
  assert.notEqual(ctx.run.fileStatus.get(handles["photo.jpg"]), "filed");

  ctx.services = { ...real, rows: { ...real.rows, attachImage: async () => { throw new Error("cannot save"); } } };
  assert.equal((await dispatch("move_file_to_declaration", { file: handles["photo.jpg"] })).error.code, "unavailable");
  assert.equal((await listPaths(w.root)).includes("inbox/Levi/photo.jpg"), true, "the rows could not get the image, so the original stays");

  ctx.services = real;
  await putFile(w.root, "inbox/Levi/photo.jpg", new TextEncoder().encode("changed on disk"));
  const changed = await dispatch("move_file_to_declaration", { file: handles["photo.jpg"] });
  assert.equal(changed.error.code, "unavailable");
  assert.equal((await readInboxIndex(w.root)).files.some((entry) => entry.name === "photo.jpg"), true);
});

test("move_file_to_declaration: a file taken out of the inbox during the run is named as gone, not as staying there", async () => {
  // 25 Oct 2026: two PDFs were moved to the trash while the run waited for an answer; the rows were made, the move then said
  // "it stays in the inbox", which was not true.
  const { w, dispatch, levi, handles } = await withRow([[rawRecord()]]);
  const folder = await (await w.root.getDirectoryHandle("inbox")).getDirectoryHandle("Levi");
  await folder.removeEntry("photo.jpg");
  const result = await dispatch("move_file_to_declaration", { file: handles["photo.jpg"] });
  assert.deepEqual([result.ok, result.error.code], [false, "not_found"]);
  assert.match(result.error.message, /no longer in the inbox/);
  assert.doesNotMatch(result.error.message, /stays in the inbox/);
  assert.equal((await listPaths(w.root)).some((path) => path.includes("/images/")), false);
});

test("move_file_to_declaration: for the open table the page gives the rows their image", async () => {
  const attached = [];
  const live = { clientId: "id-Levi", month: "2026-02", rows: [], append: async (s) => s.map((_, i) => 4 + i), flush: async () => {}, attachImage: async (info) => { attached.push(info); return 1; } };
  const { dispatch, levi, handles } = await withRow([[rawRecord()]], { liveTable: () => live });
  const result = await dispatch("move_file_to_declaration", { file: handles["photo.jpg"] });
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
    () => reply(call("move_file_to_declaration", { file: "F1" })),
    (request) => reply(say(`added ${last(request, "move_file_to_declaration").state}`)),
  ]);
  const result = await runAgent({ model, system: "s", registry: createDefaultRegistry(), message: "go", services: w.services, scope: w.scope, ui: recordingUi() });
  assert.deepEqual([result.status, result.text], ["completed", "added filed"]);
  assert.deepEqual(result.added, [{ clientId: "id-Levi", month: "2026-02", count: 1 }], "the result says where the rows went");
  const rows = (await loadDeclaration(w.levi.directory, "2026-02")).draft.rows;
  assert.equal(rows.length, 4);
  assert.deepEqual([rows[3].statusClass, rows[3].imageFile, rows[3].agent.run], ["ready", "001.jpg", result.runId]);
  assert.equal((await readInboxIndex(w.root)).files.some((entry) => entry.name === "photo.jpg"), false);
});

test("a whole run says how many of the rows of each month are to look at (the panel's card \"לטיפולך\", C5)", async () => {
  const { runAgent } = await import("../agent/run.js");
  const { scriptedModel, reply, say } = await import("./agent-fixtures.mjs");
  const w = await world({ extraction: scriptedExtraction([answers(rawRecord({ document_number: "RUN-7" }))]) });
  const last = (request, name) => request.contents.at(-1).parts.map((part) => part.functionResponse).find((item) => item.name === name)?.response;
  const model = scriptedModel([
    reply(call("list_inbox", { kind: "image" })),
    (request) => reply(call("extract_document", { file: last(request, "list_inbox").files[0].file }), call("find_client", { name: "Levi" })),
    () => reply(call("add_rows", { client: "C1", rows: [decision("F1.1", { reason: "לא ברור", needs_review: true })] })),
    () => reply(call("move_file_to_declaration", { file: "F1" })),
    () => reply(say("done")),
  ]);
  const result = await runAgent({ model, system: "s", registry: createDefaultRegistry(), message: "go", services: w.services, scope: w.scope, ui: recordingUi() });
  assert.deepEqual(result.added, [{ clientId: "id-Levi", month: "2026-02", count: 1, review: 1 }]);
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
    (request) => reply(call("add_rows", { client: last(request, "find_client")[0].matches[0].client, rows: (read = last(request, "extract_document")).map((item) => decision(item.documents[0].fact)) })),
    (request) => reply(...read.map((item) => call("move_file_to_declaration", { file: item.file }))),
    (request) => reply(say(last(request, "move_file_to_declaration").map((item) => item.state).join(","))),
  ]);
  const result = await runAgent({ model, system: "s", registry: createDefaultRegistry(), message: "go", services: w.services, scope: w.scope, ui: recordingUi() });
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
    () => reply(call("move_file_to_declaration", { file: photo })),
    () => reply(say("everything is processed")),
  ]);
  const ids = (await (await import("../inbox-store.js")).readInboxIndex(w.root)).files.map((file) => file.name);
  assert.ok(ids.includes("photo.jpg") && ids.includes("policy.pdf") && ids.includes("journal.xlsx"));
  const result = await runAgent({ model, system: "s", registry: createDefaultRegistry(), message: "go", services: w.services, scope: w.scope, ui: recordingUi() });
  assert.deepEqual([result.status, result.text], ["completed", "everything is processed"]);
  assert.deepEqual(result.left.map((file) => file.name), ["policy.pdf"], "the spreadsheet is not counted, the filed photo is gone");
});

test("a run that did no work on files reports nothing as left", async () => {
  const { runAgent } = await import("../agent/run.js");
  const { scriptedModel, reply, say } = await import("./agent-fixtures.mjs");
  const w = await world();
  const model = scriptedModel([reply(call("list_inbox", {})), reply(say("three files wait"))]);
  const result = await runAgent({ model, system: "s", registry: createDefaultRegistry(), message: "what is left", services: w.services, scope: w.scope, ui: recordingUi() });
  assert.equal(result.left, undefined);
});

test("extract_document: a file that is listed but gone from its folder is named as missing, not as unreadable", async () => {
  const { w, dispatch, handles } = await session([[rawRecord()]]);
  const folder = await (await w.root.getDirectoryHandle("inbox")).getDirectoryHandle("Levi");
  await folder.removeEntry("photo.jpg");
  const result = await dispatch("extract_document", { file: handles["photo.jpg"] });
  assert.deepEqual([result.ok, result.error.code], [false, "not_found"]);
  assert.match(result.error.message, /not in its folder/);
});

// Anna, 25 October 2026: every document that came in must be in the table, even with missing or doubtful fields; she decides.
test("move_file_to_declaration: a document of the file that got no row gets one before the file is filed, inactive and to look at", async () => {
  // As in the owner's run: two documents of one scan, the agent added only the first.
  const { w, dispatch, levi, handles, factsOf } = await session([[
    rawRecord({ document_number: "S-1", page: 1 }), rawRecord({ document_number: "S-2", page: 2, buyer_vat_id: null, supplier_name: "Fuel" }),
  ]]);
  const facts = await factsOf("photo.jpg");
  const added = await dispatch("add_rows", { client: levi, rows: [decision(facts[0])] });
  assert.deepEqual(added.rows.map((row) => row.state), ["created"]);
  const result = await dispatch("move_file_to_declaration", { file: handles["photo.jpg"] });
  assert.deepEqual([result.ok, result.state, result.rows], [true, "filed", 2]);
  assert.deepEqual(result.added_for_review.map((item) => [item.fact, item.month]), [[facts[1], "2026-02"]]);
  const rows = (await tableOf(w)).slice(-2);
  assert.deepEqual(rows.map((row) => row.reference), ["S-1", "S-2"]);
  const [, missing] = rows;
  assert.deepEqual([missing.active, missing.statusClass, missing.values[1], missing.values[3], missing.imageFile], [false, "review", "", "Fuel", "001.jpg"]);
  assert.match(missing.agentOpinion, /לא נקלט על ידי הסוכן/);
  // The table counts it under "לבדיקה" by this mark, although it is off (docs/UI_REDESIGN_PROPOSAL.md, C4).
  assert.deepEqual([missing.agent.leftOut, rows[0].agent.leftOut], [true, undefined]);
  assert.equal((await readInboxIndex(w.root)).files.some((entry) => entry.name === "photo.jpg"), false);
});

test("move_file_to_declaration: a document left out goes into the month of the run, also when its date is in a locked month", async () => {
  const { w, dispatch, levi, handles, factsOf } = await session([[
    rawRecord({ document_number: "M-1" }), rawRecord({ document_number: "M-2", date: "2026-01-12", buyer_vat_id: null }),
  ]]);
  const facts = await factsOf("photo.jpg");
  await dispatch("add_rows", { client: levi, rows: [decision(facts[0])] });
  const result = await dispatch("move_file_to_declaration", { file: handles["photo.jpg"] });
  assert.equal(result.state, "filed");
  assert.deepEqual(result.added_for_review.map((item) => item.month), ["2026-02"]);
  assert.equal((await tableOf(w)).at(-1).reference, "M-2");
  assert.equal((await loadDeclaration(w.levi.directory, "2026-01")).draft.rows.length, 1, "the locked month is untouched");
});

test("a whole run: a file with rows that the model never filed is filed by the app at the end, with its left-out documents", async () => {
  const { runAgent } = await import("../agent/run.js");
  const { scriptedModel, reply, say } = await import("./agent-fixtures.mjs");
  const w = await world({ extraction: scriptedExtraction([answers(rawRecord({ document_number: "E-1" }), rawRecord({ document_number: "E-2", buyer_vat_id: null }))]) });
  const last = (request, name) => request.contents.at(-1).parts.map((part) => part.functionResponse).find((item) => item.name === name)?.response;
  const model = scriptedModel([
    reply(call("list_inbox", { kind: "image" })),
    (request) => reply(call("extract_document", { file: last(request, "list_inbox").files[0].file }), call("find_client", { name: "Levi" })),
    (request) => reply(call("add_rows", { client: "C1", rows: [decision(last(request, "extract_document").documents[0].fact)] })),
    () => reply(say("done")),
  ]);
  const result = await runAgent({ model, system: "s", registry: createDefaultRegistry(), message: "go", services: w.services, scope: w.scope, ui: recordingUi() });
  assert.equal(result.status, "completed");
  assert.deepEqual(result.filedByApp, [{ name: "photo.jpg", rows: 2, addedForReview: 1 }]);
  assert.equal((result.left ?? []).some((file) => file.name === "photo.jpg"), false);
  const rows = (await loadDeclaration(w.levi.directory, "2026-02")).draft.rows.filter((row) => row.agent?.run === result.runId);
  assert.deepEqual(rows.map((row) => [row.reference, row.imageFile, row.active]), [["E-1", "001.jpg", true], ["E-2", "001.jpg", false]]);
  assert.ok(result.log.entries.some((entry) => entry.kind === "tool" && entry.name === "move_file_to_declaration" && entry.byApp));
});

// 26 October 2026: the client's own receipts (she is the supplier, the buyer is her patient). A document the client issued names its
// customer as the buyer, which is no doubt; another buyer on a document of someone else is.
test("add_rows: a document the client issued is no buyer mismatch; another buyer on another's document is", async () => {
  const own = rawRecord({ document_number: "R-4887", supplier_name: "Levi Plumbing", supplier_vat_id: "514123456", buyer_name: "A patient", buyer_vat_id: "039123453" });
  const other = rawRecord({ document_number: "X-1", supplier_vat_id: "512345679", buyer_vat_id: "039123453" });
  const { dispatch, levi, factsOf } = await session([[own, other]]);
  const [mine, foreign] = await factsOf("photo.jpg");
  const result = await dispatch("add_rows", { client: levi, rows: [decision(mine), decision(foreign)] });
  assert.deepEqual(result.rows.map((row) => [row.state, row.reasons.includes("buyer_mismatch")]), [["created", false], ["created", true]]);
});
