// Confirmed aliases of a client (step 4.6.2): the store, the rule of proof, find_client, get_client_context, add_rows routed_by alias and
// the box of choose_client, on real stores in memory.
import test from "node:test";
import assert from "node:assert/strict";
import { addAlias, readAliases, removeAlias } from "../aliases-store.js";
import { aliasProves, buyerOf, provesSame, sameBuyer } from "../client-alias.js";
import { createContext } from "../agent/run.js";
import { createDefaultRegistry } from "../agent/index.js";
import { rawRecord, recordingUi, scriptedExtraction, toolContext } from "./agent-fixtures.mjs";
import { binaryDirectory, listPaths, putFile } from "./memory-binary-directory.mjs";

const now = "2026-10-17T10:00:00.000Z";
const textOf = async (directory, name) => (await (await (await directory.getFileHandle(name)).getFile()).text());

test("the rule of proof: the printed VAT number decides; without one, the exact name after normalising", () => {
  assert.deepEqual(buyerOf(rawRecord({ buyer_vat_id: "0300-000-007", buyer_name: "  משה\nלוי " })), { vatId: "300000007", name: "משה לוי" });
  assert.equal(buyerOf(rawRecord({ buyer_vat_id: null, buyer_name: "" })), null);
  assert.equal(aliasProves({ vatId: "300000007" }, { vatId: "300000007", name: "someone else" }), true);
  assert.equal(aliasProves({ vatId: "", name: "משה לוי" }, { vatId: "300000007", name: "משה לוי" }), false, "a printed number that is not the alias's: the name does not help");
  assert.equal(aliasProves({ name: "Levi Plumbing Ltd" }, { vatId: "", name: "LEVI plumbing" }), true, "case and the legal suffix do not count");
  assert.equal(aliasProves({ name: "Levi Plumbing" }, { vatId: "", name: "Levi" }), false, "a part of the name is no proof");
  assert.equal(provesSame({ vatId: "1", name: "a b" }, { vatId: "01", name: "other" }), true);
  assert.equal(provesSame({ vatId: "1", name: "a b" }, { vatId: "", name: "a b" }), false);
  assert.equal(sameBuyer({ vatId: "1", name: "Dana" }, { vatId: "1", name: "dana" }), true);
});

test("aliases.json: added once, removed by marking, a damaged or newer file gives no aliases and is never overwritten", async () => {
  const directory = binaryDirectory("Levi");
  assert.deepEqual(await readAliases(directory), { aliases: [], damaged: false });
  assert.deepEqual(await addAlias(directory, { vatId: "300000007", name: "משה לוי" }, { now }), { added: true });
  assert.deepEqual(await addAlias(directory, { vatId: "0300000007", name: "משה  לוי" }, { now }), { added: false });
  await addAlias(directory, { vatId: "", name: "דנה לוי" }, { now });
  assert.deepEqual((await readAliases(directory)).aliases, [
    { index: 0, vatId: "300000007", name: "משה לוי", addedAt: now }, { index: 1, vatId: "", name: "דנה לוי", addedAt: now },
  ]);
  assert.deepEqual(await removeAlias(directory, 0, { now: "2026-10-18T00:00:00.000Z" }), { removed: true });
  assert.deepEqual((await readAliases(directory)).aliases.map((alias) => alias.name), ["דנה לוי"]);
  assert.equal(JSON.parse(await textOf(directory, "aliases.json")).aliases[0].removedAt, "2026-10-18T00:00:00.000Z", "kept in the file");
  assert.deepEqual(await removeAlias(directory, 0), { removed: false });
  await assert.rejects(addAlias(directory, { vatId: "", name: " " }), /אין מספר או שם/);

  for (const text of ["{ not json", JSON.stringify({ schemaVersion: 2, aliases: [] })]) {
    const damaged = binaryDirectory("Cohen");
    await putFile(damaged, "aliases.json", text);
    assert.deepEqual(await readAliases(damaged), { aliases: [], damaged: true });
    await assert.rejects(addAlias(damaged, { vatId: "1", name: "x" }), /פגום/);
    assert.equal(await textOf(damaged, "aliases.json"), text);
  }
});

test("find_client gives match alias by the number, or by the exact name when no number is given; get_client_context lists the aliases", async () => {
  const { w, dispatch, client } = await toolContext();
  await addAlias(w.levi.directory, { vatId: "300000007", name: "משה לוי" }, { now });
  await addAlias(w.cohen.directory, { vatId: "", name: "דנה כהן" }, { now });
  const found = async (args) => (await dispatch("find_client", args)).matches.map((match) => [match.name, match.match]);
  assert.deepEqual(await found({ vat_id: "300000007" }), [["Levi Plumbing Ltd", "alias"]]);
  assert.deepEqual(await found({ name: "דנה כהן" }), [["Cohen Studio", "alias"]]);
  assert.deepEqual(await found({ vat_id: "399999999", name: "דנה כהן" }), [], "a printed number decides");
  assert.deepEqual(await found({ name: "דנה" }), [], "a part of the name is not the alias");
  const context = await dispatch("get_client_context", { client: await client("Levi") });
  assert.deepEqual(context.aliases, [{ vat_id: "300000007", name: "משה לוי" }]);
  assert.equal("aliases_damaged" in context, false);
  await w.putFile("clients/Cohen/aliases.json", "{ damaged");
  const cohen = await dispatch("get_client_context", { client: await client("Cohen Studio") });
  assert.deepEqual([cohen.aliases, cohen.aliases_damaged], [[], true]);
});

// A run with an extraction script; files() gives the handles, factsOf(name) extracts a file and gives its fact handles.
async function session(records, options = {}) {
  const tools = await toolContext({ extraction: scriptedExtraction(records.map((record) => ({ records: [record] }))), ...options });
  const handles = await tools.files();
  const factsOf = async (name, dispatch = tools.dispatch) => (await dispatch("extract_document", { file: handles[name] })).documents.map((doc) => doc.fact);
  return { ...tools, handles, factsOf, levi: await tools.client("Levi") };
}
const row = (fact, extra = {}) => ({ fact, routed_by: "alias", decision: "expense", account: "202", needs_review: false, reason: "חשבונית משרדית", ...extra });
const buyer = { buyer_vat_id: null, buyer_name: "משה לוי" };

test("add_rows routed_by alias: refused until the user confirmed the buyer for this client, refused when two clients hold it", async () => {
  const { w, dispatch, factsOf, levi } = await session([rawRecord(buyer), rawRecord({ ...buyer, buyer_vat_id: "300000007", document_number: "X-2" })]);
  const [photo] = await factsOf("photo.jpg");
  const before = (await dispatch("add_rows", { client: levi, rows: [row(photo)] })).rows[0];
  assert.deepEqual([before.state, before.error.code, before.error.message], ["rejected", "not_allowed", "The buyer of the document is not a confirmed alias of this client."]);
  await addAlias(w.cohen.directory, { name: "משה לוי" }, { now });
  assert.match((await dispatch("add_rows", { client: levi, rows: [row(photo)] })).rows[0].error.message, /not a confirmed alias of this client/, "an alias of another client");
  await addAlias(w.levi.directory, { name: "משה לוי" }, { now });
  assert.match((await dispatch("add_rows", { client: levi, rows: [row(photo)] })).rows[0].error.message, /more than one client/);
  await removeAlias(w.cohen.directory, 0);
  assert.equal((await dispatch("add_rows", { client: levi, rows: [row(photo)] })).rows[0].state, "created");
  const [policy] = await factsOf("policy.pdf");
  assert.match((await dispatch("add_rows", { client: levi, rows: [row(policy)] })).rows[0].error.message, /not a confirmed alias/, "it prints a number that is not the alias");
});

test("add_rows routed_by alias: a document without a buyer has no alias proof", async () => {
  const { dispatch, factsOf, levi } = await session([rawRecord({ buyer_vat_id: null, buyer_name: null })]);
  const [photo] = await factsOf("photo.jpg");
  assert.match((await dispatch("add_rows", { client: levi, rows: [row(photo)] })).rows[0].error.message, /prints no buyer/);
});

// The page: the box of the card was ticked and a client chosen, so the buyer is kept for that client (what app.js does).
const chooseWithBox = (w, name, { tick = true } = {}) => async (card) => {
  const option = card.more.find((item) => item.label === name) ?? card.options.find((item) => item.label === name);
  if (!option) return { type: "option", id: "mixed", ...(card.alias ? { alias: tick } : {}) };
  if (!card.alias) return { type: "option", id: option.id };
  if (!tick) return { type: "option", id: option.id, alias: false };
  const client = w.clients.find((item) => item.clientName === name);
  await addAlias(client.directory, { vatId: card.alias.vatId, name: card.alias.name }, { now });
  return { type: "option", id: option.id, alias: true, aliasSaved: true };
};

test("choose_client offers the box when every document prints one buyer; after the tick a later run routes by alias without a question", async () => {
  let answer = null;
  const first = await session([rawRecord(buyer), rawRecord(buyer)], { answers: (card) => answer(card) });
  const { w, dispatch, factsOf, handles, levi, ui } = first;
  answer = chooseWithBox(w, "Levi Plumbing Ltd");
  const [photo] = await factsOf("photo.jpg");
  const asked = await dispatch("ask_user", { question: "לאיזה לקוח שייך המסמך?", choose_client: true, about: { files: [handles["photo.jpg"]] }, allow_other: false });
  assert.deepEqual(ui.cards[0].alias, { vatId: "", name: "משה לוי", clients: Object.fromEntries(ui.cards[0].more.map((item) => [item.id, w.clients.find((client) => client.clientName === item.label).id])) });
  assert.deepEqual([asked.client, asked.alias_saved], [levi, true]);
  assert.equal((await dispatch("add_rows", { client: levi, rows: [row(photo, { routed_by: "user", routing_ask: asked.ask })] })).rows[0].state, "created");
  assert.deepEqual((await readAliases(w.levi.directory)).aliases.map(({ vatId, name }) => ({ vatId, name })), [{ vatId: "", name: "משה לוי" }]);

  // A later run: the same buyer on another document is found and proven without asking.
  const ui2 = recordingUi({ answers: [] });
  const ctx2 = createContext({ services: w.services, ui: ui2, now: () => "2026-10-18T09:00:00.000Z" });
  const registry = createDefaultRegistry();
  const dispatch2 = (name, args = {}) => registry.dispatch({ name, args }, ctx2);
  const files2 = Object.fromEntries((await dispatch2("list_inbox")).files.map((item) => [item.name, item.file]));
  const [again] = (await dispatch2("extract_document", { file: files2["photo.jpg"] })).documents.map((doc) => doc.fact);
  const [match] = (await dispatch2("find_client", { name: "משה לוי" })).matches;
  assert.deepEqual([match.name, match.match], ["Levi Plumbing Ltd", "alias"]);
  const added = (await dispatch2("add_rows", { client: match.client, rows: [row(again)] })).rows[0];
  // The same photo again: proven by the alias, and kept as an inactive duplicate of the row of the first run (the code, not the model).
  assert.deepEqual([added.state, added.excluded], ["created", "duplicate"]);
  assert.equal(ui2.cards.length, 0, "no question in the later run");
});

test("choose_client: no box when the buyers differ, one is missing, a file was not read, or a client already holds the buyer", async () => {
  const cards = async (records, read, setup = async () => {}) => {
    const s = await session(records, { answers: () => ({ type: "dismissed" }) });
    await setup(s.w);
    for (const name of read) await s.factsOf(name);
    await s.dispatch("ask_user", { question: "לאיזה לקוח?", choose_client: true, about: { files: [s.handles["photo.jpg"], s.handles["policy.pdf"]] }, allow_other: false });
    return s.ui.cards[0];
  };
  const other = { ...buyer, buyer_name: "דנה כהן" };
  assert.equal((await cards([rawRecord(buyer), rawRecord(other)], ["photo.jpg", "policy.pdf"])).alias, undefined, "two buyers");
  assert.equal((await cards([rawRecord(buyer), rawRecord({ buyer_vat_id: null, buyer_name: null })], ["photo.jpg", "policy.pdf"])).alias, undefined, "a missing buyer");
  assert.equal((await cards([rawRecord(buyer)], ["photo.jpg"])).alias, undefined, "a file not read");
  assert.equal((await cards([rawRecord(buyer), rawRecord(buyer)], ["photo.jpg", "policy.pdf"], (w) => addAlias(w.cohen.directory, { name: "משה לוי" }, { now }))).alias, undefined, "already an alias");
  const vat = { buyer_vat_id: "035123459", buyer_name: "x" };
  assert.equal((await cards([rawRecord(vat), rawRecord(vat)], ["photo.jpg", "policy.pdf"])).alias, undefined, "the VAT number of a client");
  assert.deepEqual((await cards([rawRecord(buyer), rawRecord(buyer)], ["photo.jpg", "policy.pdf"])).alias.name, "משה לוי", "the same buyer on both");
});

test("choose_client: the box counts only with a client chosen; nothing is written by the tool itself", async () => {
  let answer = null;
  const { w, dispatch, factsOf, handles } = await session([rawRecord(buyer), rawRecord(buyer)], { answers: (card) => answer(card) });
  await factsOf("photo.jpg");
  await factsOf("policy.pdf");
  const both = [handles["photo.jpg"], handles["policy.pdf"]];
  answer = chooseWithBox(w, "nobody");
  const mixed = await dispatch("ask_user", { question: "לאיזה לקוח?", choose_client: true, about: { files: both }, allow_other: false });
  assert.deepEqual([mixed.answer.id, "alias_saved" in mixed], ["mixed", false]);
  answer = chooseWithBox(w, "Cohen Studio", { tick: false });
  const unticked = await dispatch("ask_user", { question: "ושוב, לאיזה לקוח?", choose_client: true, about: { files: both }, allow_other: false });
  assert.equal("alias_saved" in unticked, false);
  assert.equal((await listPaths(w.root)).some((path) => path.endsWith("aliases.json")), false);
});
