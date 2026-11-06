// Confirmed aliases of a client (step 4.6.2): the store, the rule of proof, find_client and get_client_context, on real stores in
// memory. Since step 9.6 an alias routes no file (add_rows has no proof of the client) and no card offers to save one.
import test from "node:test";
import assert from "node:assert/strict";
import { addAlias, readAliases, removeAlias } from "../aliases-store.js";
import { aliasProves, buyerOf, provesSame, sameBuyer } from "../client-alias.js";
import { rawRecord, scriptedExtraction, toolContext } from "./agent-fixtures.mjs";
import { binaryDirectory, putFile } from "./memory-binary-directory.mjs";

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
