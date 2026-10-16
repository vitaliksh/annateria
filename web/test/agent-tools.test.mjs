import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultRegistry } from "../agent/index.js";
import { createContext } from "../agent/run.js";
import { recordingUi, world } from "./agent-fixtures.mjs";
import { listPaths, readFileBytes } from "./memory-binary-directory.mjs";

async function setup({ answers, limits } = {}) {
  const w = await world();
  const ui = recordingUi({ answers });
  const ctx = createContext({ services: w.services, ui, ...(limits ? { limits: { ...createContext({ services: w.services }).limits, ...limits } } : {}) });
  const registry = createDefaultRegistry();
  return { w, ui, ctx, dispatch: (name, args = {}) => registry.dispatch({ name, args }, ctx) };
}
const row = (ctx, documentId, month = "2026-02", clientId = "id-Levi", position = 1) => ctx.handles.create("R", `${clientId}|${month}|${documentId}`, { clientId, month, documentId, position });
const options = [{ id: "levi", label: "Levi" }, { id: "cohen", label: "Cohen" }];

test("list_inbox: counts, kinds, the note on spreadsheets, stable handles", async () => {
  const { dispatch } = await setup();
  const first = await dispatch("list_inbox");
  assert.equal(first.ok, true);
  assert.deepEqual(first.counts, { total: 3, waiting: 3, byFolder: { Levi: 2, _unsorted: 1 } });
  const byName = Object.fromEntries(first.files.map((file) => [file.name, file]));
  assert.deepEqual([byName["photo.jpg"].kind, byName["policy.pdf"].kind, byName["journal.xlsx"].kind], ["image", "pdf", "spreadsheet"]);
  assert.equal(byName["journal.xlsx"].note, "use the Excel import");
  assert.equal(byName["photo.jpg"].folder, "_unsorted");
  assert.deepEqual(Object.keys(byName["photo.jpg"]).sort(), ["added_at", "file", "folder", "kind", "name", "size_kb", "source_date", "status"]);
  assert.match(byName["photo.jpg"].file, /^F[1-9]$/);
  const second = await dispatch("list_inbox");
  assert.deepEqual(second.files.map((file) => file.file), first.files.map((file) => file.file));
  assert.equal(JSON.stringify(first).includes("hash"), false, "no hash reaches the model");
});

test("list_inbox: filters, status and pages", async () => {
  const { dispatch } = await setup();
  assert.deepEqual((await dispatch("list_inbox", { folder: "Levi" })).files.map((file) => file.name).sort(), ["journal.xlsx", "policy.pdf"]);
  assert.deepEqual((await dispatch("list_inbox", { kind: "pdf" })).files.map((file) => file.name), ["policy.pdf"]);
  assert.deepEqual((await dispatch("list_inbox", { status: "extracted" })).files, []);
  const page1 = await dispatch("list_inbox", { limit: 2 });
  assert.equal(page1.files.length, 2);
  assert.equal(page1.next, "2");
  const page2 = await dispatch("list_inbox", { limit: 2, next: page1.next });
  assert.equal(page2.files.length, 1);
  assert.equal(page2.next, undefined);
  assert.equal((await dispatch("list_inbox", { limit: 500 })).error.code, "invalid_argument");
});

test("list_inbox: an empty inbox, and a state of the run is shown", async () => {
  const { ctx, dispatch } = await setup();
  const files = (await dispatch("list_inbox")).files;
  ctx.run.fileStatus.set(files[0].file, "filed");
  const after = await dispatch("list_inbox");
  assert.equal(after.counts.waiting, 2);
  assert.equal((await dispatch("list_inbox", { status: "filed" })).files.length, 1);
  const empty = createContext({ services: { inbox: { readIndex: async () => ({ files: [] }) } } });
  assert.deepEqual(await createDefaultRegistry().dispatch({ name: "list_inbox", args: {} }, empty), { ok: true, counts: { total: 0, waiting: 0, byFolder: {} }, files: [] });
});

test("find_client: a VAT number is matched by digits, leading zeros ignored", async () => {
  const { dispatch } = await setup();
  const hit = await dispatch("find_client", { vat_id: "514-123-456" });
  assert.deepEqual(hit.matches.map(({ name, match }) => [name, match]), [["Levi Plumbing Ltd", "vat_id"]]);
  assert.match(hit.matches[0].client, /^C\d$/);
  assert.equal((await dispatch("find_client", { vat_id: "0035123459" })).matches[0].name, "Cohen Studio");
  assert.deepEqual((await dispatch("find_client", { vat_id: "999999999" })).matches, []);
});

test("find_client: names match exactly or partly, a VAT number wins, nothing given is an error", async () => {
  const { dispatch } = await setup();
  assert.deepEqual((await dispatch("find_client", { name: "Cohen Studio" })).matches.map((m) => m.match), ["name_exact"]);
  assert.deepEqual((await dispatch("find_client", { name: "Levi Plumbing" })).matches.map((m) => m.match), ["name_exact"], "the legal suffix Ltd does not count");
  assert.deepEqual((await dispatch("find_client", { name: "Levi" })).matches.map((m) => m.match), ["name_partial"]);
  assert.deepEqual((await dispatch("find_client", { name: "Levi Plumbing Ltd Haifa branch" })).matches.map((m) => m.match), ["name_partial"], "the whole name inside a longer one");
  assert.deepEqual((await dispatch("find_client", { name: "Levi Bakery" })).matches, [], "one shared word is not enough");
  assert.deepEqual((await dispatch("find_client", { name: "Levi", vat_id: "035123459" })).matches.map((m) => [m.name, m.match]), [["Cohen Studio", "vat_id"], ["Levi Plumbing Ltd", "name_partial"]]);
  assert.equal((await dispatch("find_client", {})).error.code, "invalid_argument");
});

test("find_client only sees clients inside the data root", async () => {
  const { w, ctx } = await setup();
  const registry = createDefaultRegistry();
  w.clients.push({ id: "id-Outside", clientName: "Opened From Elsewhere", directory: w.levi.directory, parent: null, entryName: null, config: { vatId: "111111118" } });
  assert.deepEqual((await registry.dispatch({ name: "find_client", args: { vat_id: "111111118" } }, ctx)).matches, []);
});

test("ask_user: the card goes to the user, the answer comes back, the same question is not asked twice", async () => {
  const { ui, dispatch } = await setup({ answers: [{ type: "option", id: "levi" }] });
  await dispatch("list_inbox");
  const result = await dispatch("ask_user", { question: "Whose is this file?", options, allow_other: true, about: { files: ["F1"] } });
  assert.deepEqual(result, { ok: true, ask: "Q1", answer: { type: "option", id: "levi" }, remember: false });
  assert.equal(ui.cards.length, 1);
  assert.deepEqual(ui.cards[0].about.files[0].file, "F1");
  assert.equal(ui.cards[0].allowOther, true);
  assert.equal(ui.cards[0].remember, null);
  const again = await dispatch("ask_user", { question: "  whose is this FILE? ", options, allow_other: true });
  assert.deepEqual(again, result);
  assert.equal(ui.cards.length, 1);
});

test("ask_user: other needs allow_other, an unknown option is refused, dismissed is an answer", async () => {
  const text = await setup({ answers: [{ type: "other", text: "  The tax office  " }] });
  assert.deepEqual((await text.dispatch("ask_user", { question: "Q1?", options, allow_other: true })).answer, { type: "other", text: "The tax office" });
  const closed = await setup({ answers: [{ type: "other", text: "x" }, { type: "option", id: "nobody" }, { type: "other", text: "   " }, { type: "dismissed" }] });
  for (const question of ["A?", "B?", "C?"]) {
    const bad = await closed.dispatch("ask_user", { question, options, allow_other: question === "C?" });
    assert.deepEqual([bad.ok, bad.error.code], [false, "internal"], question);
  }
  assert.deepEqual((await closed.dispatch("ask_user", { question: "D?", options, allow_other: false })).answer, { type: "dismissed" });
});

test("ask_user: checks options, handles and the limit; the limit counts only new questions", async () => {
  const { dispatch, ui } = await setup({ answers: () => ({ type: "option", id: "levi" }), limits: { questions: 2 } });
  const code = async (args) => (await dispatch("ask_user", { options, allow_other: false, ...args })).error?.code;
  assert.equal(await code({ question: "Same ids?", options: [{ id: "a", label: "A" }, { id: "a", label: "B" }] }), "invalid_argument");
  assert.equal(await code({ question: "Reserved?", options: [{ id: "other", label: "A" }, { id: "b", label: "B" }] }), "invalid_argument");
  assert.equal(await code({ question: "One option?", options: [{ id: "a", label: "A" }] }), "invalid_argument");
  assert.equal(await code({ question: "Ghost file?", about: { files: ["F9"] } }), "not_found");
  assert.equal(await code({ question: "Ghost client?", remember: { client: "C9", rule: "x" } }), "not_found");
  assert.equal(await code({ question: "One?" }), undefined);
  assert.equal(await code({ question: "Two?" }), undefined);
  assert.equal(await code({ question: "one?" }), undefined, "an earlier question is answered again without counting");
  assert.equal(await code({ question: "Three?" }), "limit_reached");
  assert.equal(ui.cards.length, 2);
});

test("ask_user: remember is true only when the card offered it and the user ticked the box", async () => {
  const { ui, dispatch } = await setup({ answers: [{ type: "option", id: "levi", remember: true }, { type: "option", id: "levi", remember: true }, { type: "option", id: "levi" }] });
  const client = (await dispatch("find_client", { vat_id: "514123456" })).matches[0].client;
  const ticked = await dispatch("ask_user", { question: "Insurance is a business expense?", options, allow_other: false, remember: { client, rule: "ביטוח עסק הוא הוצאה" } });
  assert.deepEqual([ticked.ask, ticked.remember], ["Q1", true]);
  assert.deepEqual(ui.cards[0].remember, { client: "Levi Plumbing Ltd", rule: "ביטוח עסק הוא הוצאה" });
  const noOffer = await dispatch("ask_user", { question: "No rule offered?", options, allow_other: false });
  assert.equal(noOffer.remember, false, "a tick on a card without the offer counts for nothing");
  const unticked = await dispatch("ask_user", { question: "Offered but not ticked?", options, allow_other: false, remember: { client, rule: "x" } });
  assert.equal(unticked.remember, false);
});

test("propose_change: the user sees a card with parsed values; nothing on disk changes", async () => {
  const { w, ui, ctx, dispatch } = await setup();
  const before = await listPaths(w.root);
  const client = (await dispatch("find_client", { vat_id: "514123456" })).matches[0].client;
  const handle = row(ctx, "doc-1");
  const result = await dispatch("propose_change", {
    client, title: "תיקון שורה", changes: [
      { row: handle, field: "date", value: "14/03/2026", reason: "התאריך בצילום שונה" },
      { row: handle, field: "net", value: "1,234.5".replace(",", ""), reason: "סכום" },
      { row: handle, field: "account", value: "206", reason: "ביטוח" },
      { row: handle, field: "vat_recognized_percent", value: "66.67", reason: "נייד" },
      { row: handle, field: "include", value: "false", reason: "כפילות" },
      { row: handle, field: "supplier_vat_id", value: "514123456", reason: "ח.פ." },
    ],
  });
  assert.deepEqual(result, { ok: true, proposal: "P1", count: 6 });
  assert.equal(ui.proposals.length, 1);
  assert.deepEqual(ui.proposals[0].changes.map((change) => [change.field, change.value]), [
    ["date", "2026-03-14"], ["net", 1234.5], ["account", "206"], ["vat_recognized_percent", 66.67], ["include", false], ["supplier_vat_id", "514123456"],
  ]);
  assert.deepEqual([ui.proposals[0].client, ui.proposals[0].changes[0].documentId, ui.proposals[0].changes[0].month], [{ id: "id-Levi", name: "Levi Plumbing Ltd" }, "doc-1", "2026-02"]);
  assert.deepEqual(await listPaths(w.root), before);
});

test("propose_change: refuses rows of a locked month, another client's rows, unknown handles and a locked or missing target month", async () => {
  const { ui, ctx, dispatch } = await setup();
  const client = (await dispatch("find_client", { vat_id: "514123456" })).matches[0].client;
  const change = (handle, field = "purpose", value = "x") => ({ client, title: "t", changes: [{ row: handle, field, value, reason: "r" }] });
  assert.equal((await dispatch("propose_change", change(row(ctx, "locked-row", "2026-01")))).error.code, "locked");
  assert.match((await dispatch("propose_change", change(row(ctx, "other", "2026-02", "id-Cohen")))).error.message, /another client/);
  assert.equal((await dispatch("propose_change", change("R99"))).error.code, "not_found");
  const open = row(ctx, "open-row");
  assert.equal((await dispatch("propose_change", change(open, "month", "2026-01"))).error.code, "locked");
  assert.equal((await dispatch("propose_change", change(open, "month", "2026-07"))).error.code, "not_found");
  assert.equal((await dispatch("propose_change", change(open, "month", "2026-2"))).error.code, "invalid_argument");
  assert.equal(ui.proposals.length, 0, "a refused call shows nothing");
  assert.equal((await dispatch("propose_change", change(open, "month", "2026-02"))).ok, true);
});

test("propose_change: validates every value by the type of its field, and the whole call fails on one bad change", async () => {
  const { ui, ctx, dispatch } = await setup();
  const client = (await dispatch("find_client", { vat_id: "514123456" })).matches[0].client;
  const open = row(ctx, "open-row");
  const bad = async (field, value) => {
    const result = await dispatch("propose_change", { client, title: "t", changes: [{ row: open, field, value, reason: "r" }] });
    return result.ok ? "accepted" : `${result.error.code}: ${result.error.message}`;
  };
  assert.match(await bad("date", "31/02/2026x"), /invalid_argument.*date/);
  assert.match(await bad("net", "abc"), /number/);
  assert.match(await bad("net", ""), /number/);
  assert.match(await bad("supplier_vat_id", "51a"), /digits/);
  assert.match(await bad("account", "9"), /three-digit/);
  assert.match(await bad("account", "999"), /not in the client's chart/);
  assert.match(await bad("vat_recognized_percent", "50"), /one of/);
  assert.match(await bad("expense_recognized_percent", "66.67"), /one of/);
  assert.match(await bad("include", "yes"), /true or false/);
  assert.match(await bad("document_number", "x".repeat(61)), /too long/);
  assert.equal(await bad("allocation_number", ""), "accepted", "an empty text clears the field");
  assert.equal(ui.proposals.length, 1);
  const mixed = await dispatch("propose_change", { client, title: "t", changes: [{ row: open, field: "purpose", value: "ok", reason: "r" }, { row: open, field: "net", value: "x", reason: "r" }] });
  assert.match(mixed.error.message, /changes\[1\]/);
  assert.equal(ui.proposals.length, 1, "the good change of a bad call is not shown either");
  const twice = await dispatch("propose_change", { client, title: "t", changes: [{ row: open, field: "purpose", value: "a", reason: "r" }, { row: open, field: "purpose", value: "b", reason: "r" }] });
  assert.match(twice.error.message, /twice/);
});

test("propose_change and ask_user need a panel", async () => {
  const w = await world();
  const ctx = createContext({ services: w.services, ui: {} });
  const registry = createDefaultRegistry();
  const client = (await registry.dispatch({ name: "find_client", args: { vat_id: "514123456" } }, ctx)).matches[0].client;
  assert.equal((await registry.dispatch({ name: "ask_user", args: { question: "q", options, allow_other: false } }, ctx)).error.code, "unavailable");
  const handle = row(ctx, "doc");
  assert.equal((await registry.dispatch({ name: "propose_change", args: { client, title: "t", changes: [{ row: handle, field: "purpose", value: "x", reason: "r" }] } }, ctx)).error.code, "unavailable");
  assert.equal(new TextDecoder().decode(await readFileBytes(w.root, "inbox/index.json")).includes("photo.jpg"), true);
});
