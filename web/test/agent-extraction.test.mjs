// extract_document and facts_for (docs/AGENT_TOOLS.md, 5.1 and 5.2), the fact record, the vision adapter and the semaphore.
import test from "node:test";
import assert from "node:assert/strict";
import { INLINE_TYPES, MAX_INLINE_BYTES, RESPONSE_SCHEMA, createExtractionAdapter, ExtractionError, toBase64 } from "../agent/adapters/extraction.js";
import { normalizeRecord, RECORD_SCHEMA } from "../agent/fact-record.js";
import { MODELS } from "../agent/models.js";
import { EXTRACTION_PROMPT } from "../agent/prompts.js";
import { createSemaphore } from "../agent/semaphore.js";
import { validate } from "../agent/schema.js";
import { entryFromRow, intakeFacts } from "../intake-facts.js";
import { addToInbox } from "../inbox-store.js";
import { abortError, file, modelError, rawRecord, scriptedExtraction, toolContext } from "./agent-fixtures.mjs";

const answers = (...records) => ({ records });

// --- the fact record ---

test("normalizeRecord cleans text, ids, dates and amounts, and adds the issues the code finds", () => {
  const record = normalizeRecord(rawRecord({
    date: "20/02/2026", period_from: "2026-01-01", period_to: "2026-12-31", supplier_vat_id: "512-345-678", buyer_vat_id: " 514 123 456 ", allocation_number: "1234 5678 9",
    document_number: "A\u0000B\n\n  7", purpose: "x".repeat(300), net: 100.004, vat: 18, total: 118.0, vat_percent: 18.001, currency: "usd", confidence: 91.6, issues: ["blurred", "blurred"],
  }));
  assert.deepEqual([record.date, record.period_from, record.period_to], ["2026-02-20", "2026-01-01", "2026-12-31"]);
  assert.deepEqual([record.supplier_vat_id, record.buyer_vat_id, record.allocation_number], ["512345678", "514123456", "123456789"]);
  assert.equal(record.document_number, "A B 7");
  assert.equal(record.purpose.length, 120);
  assert.deepEqual([record.net, record.vat, record.total, record.vat_percent, record.confidence], [100, 18, 118, 18, 92]);
  assert.equal(record.currency, "USD");
  assert.deepEqual(record.issues, ["bad_vat_id", "blurred", "foreign_currency"].sort());
  assert.equal(Object.isFrozen(record) && Object.isFrozen(record.issues), true);
});

test("normalizeRecord: amounts that do not add up, an unreadable date and a missing currency", () => {
  const record = normalizeRecord(rawRecord({ date: "someday", net: 100, vat: 18, total: 120, currency: "?", supplier_vat_id: null }));
  assert.deepEqual([record.date, record.currency, record.supplier_vat_id], [null, "ILS", null]);
  assert.deepEqual(record.issues, ["amounts_mismatch", "no_date"]);
  assert.deepEqual(normalizeRecord(rawRecord({ date: null })).issues, ["no_date"]);
  assert.deepEqual(normalizeRecord(rawRecord({ net: 100, vat: 18, total: 118.01 })).issues, [], "a cent of rounding is not a mismatch");
});

test("normalizeRecord: a photo has no page, a PDF page is kept only when it is a real page number", () => {
  assert.equal(normalizeRecord(rawRecord({ page: 3 }), { isImage: true }).page, null);
  assert.equal(normalizeRecord(rawRecord({ page: 3 })).page, 3);
  assert.equal(normalizeRecord(rawRecord({ page: 0 })).page, null);
});

test("the record schema accepts a good record, refuses unknown fields and unknown issue codes, and every field is required", () => {
  assert.equal(validate(RECORD_SCHEMA, rawRecord()).ok, true);
  assert.equal(validate(RECORD_SCHEMA, { ...rawRecord(), include: true }).ok, false);
  assert.equal(validate(RECORD_SCHEMA, rawRecord({ issues: ["weird"] })).ok, false);
  assert.equal(validate(RECORD_SCHEMA, rawRecord({ kind: "invoice" })).ok, false);
  for (const key of RECORD_SCHEMA.required) {
    const { [key]: _removed, ...rest } = rawRecord();
    assert.equal(validate(RECORD_SCHEMA, rest).ok, false, key);
  }
  assert.equal(validate(RECORD_SCHEMA, rawRecord({ confidence: 101 })).ok, false);
});

// --- extract_document ---

test("extract_document: facts get handles, the record is clean and frozen, the file is marked extracted", async () => {
  const extraction = scriptedExtraction([answers(rawRecord({ document_number: "INV\u0007-2002" }), rawRecord({ document_number: "INV-2003", page: 2 }))]);
  const { ctx, dispatch, files } = await toolContext({ extraction });
  const handle = (await files())["policy.pdf"];
  const result = await dispatch("extract_document", { file: handle, hint: "an insurance letter" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.documents.map((doc) => [doc.fact, doc.page, doc.document_number]), [[`${handle}.1`, null, "INV -2002"], [`${handle}.2`, 2, "INV-2003"]]);
  assert.deepEqual([result.file, result.model], [handle, "default"]);
  assert.deepEqual(extraction.calls, [{ name: "policy.pdf", hint: "an insurance letter", strong: false, signal: ctx.signal }]);
  assert.equal(ctx.run.fileStatus.get(handle), "extracted");
  assert.equal((await dispatch("list_inbox", { status: "extracted" })).files.length, 1);
  const { record } = ctx.handles.getFact(`${handle}.1`);
  assert.throws(() => { record.net = 1; }, TypeError);
});

test("extract_document: a second call returns the stored facts without a new model call", async () => {
  const extraction = scriptedExtraction([answers(rawRecord())]);
  const { dispatch, files } = await toolContext({ extraction });
  const handle = (await files())["photo.jpg"];
  const first = await dispatch("extract_document", { file: handle });
  const second = await dispatch("extract_document", { file: handle, hint: "ignored" });
  assert.deepEqual(second, first);
  assert.equal(extraction.calls.length, 1);
});

test("extract_document: a photo never has a page; a file with no document says so; invalid records are skipped and counted", async () => {
  const extraction = scriptedExtraction([answers(rawRecord({ page: 1 })), answers(), answers(rawRecord({ confidence: 500 }), rawRecord({ document_number: "OK-1" })), answers({ kind: "nonsense" })]);
  const { dispatch, files, w } = await toolContext({ extraction });
  await addToInbox(w.root, [file("b.jpg", "b", "image/jpeg"), file("c.jpg", "c", "image/jpeg"), file("d.jpg", "d", "image/jpeg")]);
  const handles = await files();
  assert.equal((await dispatch("extract_document", { file: handles["photo.jpg"] })).documents[0].page, null);
  const none = await dispatch("extract_document", { file: handles["b.jpg"] });
  assert.deepEqual([none.documents, none.note], [[], "no financial document found in this file"]);
  const partly = await dispatch("extract_document", { file: handles["c.jpg"] });
  assert.deepEqual([partly.documents.map((doc) => doc.document_number), partly.skipped], [["OK-1"], 1]);
  const bad = await dispatch("extract_document", { file: handles["d.jpg"] });
  assert.deepEqual([bad.ok, bad.error.code], [false, "unavailable"]);
});

test("extract_document: the strong model once, replacing the facts; not after a row was made from them; not a third time", async () => {
  const extraction = scriptedExtraction([answers(rawRecord({ document_number: "FIRST" })), answers(rawRecord({ document_number: "SECOND" }), rawRecord({ document_number: "SECOND-B" }))]);
  const { ctx, dispatch, files } = await toolContext({ extraction });
  const handle = (await files())["photo.jpg"];
  await dispatch("extract_document", { file: handle });
  const again = await dispatch("extract_document", { file: handle, model: "strong" });
  assert.deepEqual([again.model, again.documents.map((doc) => doc.document_number)], ["strong", ["SECOND", "SECOND-B"]]);
  assert.equal(extraction.calls[1].strong, true);
  assert.equal((await dispatch("extract_document", { file: handle, model: "strong" })).error.code, "limit_reached");
  assert.equal((await dispatch("extract_document", { file: handle })).documents.length, 2, "the plain call still returns the stored facts");

  const used = scriptedExtraction([answers(rawRecord())]);
  const other = await toolContext({ extraction: used });
  const photo = (await other.files())["photo.jpg"];
  await other.dispatch("extract_document", { file: photo });
  other.ctx.run.factsUsed.add(`${photo}.1`);
  assert.equal((await other.dispatch("extract_document", { file: photo, model: "strong" })).error.code, "conflict");
  assert.equal(used.calls.length, 1);
});

test("extract_document: a replaced reading drops the old handles", async () => {
  const extraction = scriptedExtraction([answers(rawRecord(), rawRecord(), rawRecord()), answers(rawRecord())]);
  const { dispatch, files, ctx } = await toolContext({ extraction });
  const handle = (await files())["photo.jpg"];
  await dispatch("extract_document", { file: handle });
  await dispatch("extract_document", { file: handle, model: "strong" });
  assert.doesNotThrow(() => ctx.handles.getFact(`${handle}.1`));
  assert.throws(() => ctx.handles.getFact(`${handle}.3`), /Unknown fact/);
});

test("extract_document: spreadsheets, unknown handles, a file handle used as a fact and the run limit", async () => {
  const extraction = scriptedExtraction([answers(rawRecord()), answers(rawRecord())]);
  const { dispatch, files } = await toolContext({ extraction, limits: { extractions: 1 } });
  const handles = await files();
  const refused = await dispatch("extract_document", { file: handles["journal.xlsx"] });
  assert.equal(refused.error.code, "not_allowed");
  assert.match(refused.error.message, /read_document/);
  assert.doesNotMatch(refused.error.message, /Excel import/);
  assert.equal((await dispatch("extract_document", { file: "F99" })).error.code, "not_found");
  assert.equal((await dispatch("extract_document", { file: handles["photo.jpg"] })).ok, true);
  assert.equal((await dispatch("extract_document", { file: handles["policy.pdf"] })).error.code, "limit_reached");
  assert.equal((await dispatch("facts_for", { fact: handles["photo.jpg"], client: await (await toolContext()).client("Levi") })).error.code, "not_found");
});

test("extract_document: what the adapter and the model client throw reaches the model in plain words", async () => {
  const cases = [
    [new ExtractionError("too_large", "The file is too large for one request."), "invalid_argument", /too large/],
    [new ExtractionError("unsupported_type", "Files of type x cannot be read."), "invalid_argument", /cannot be read/],
    [new ExtractionError("bad_answer", "The model did not answer with JSON."), "unavailable", /JSON/],
    [modelError("busy"), "unavailable", /\(busy\)/],
    [abortError(), "cancelled", /cancelled/],
    [new Error("C:\\secret\\path"), "unavailable", /could not be read/],
  ];
  const { dispatch, files } = await toolContext({ extraction: scriptedExtraction(cases.map(([error]) => error)) });
  const handle = (await files())["photo.jpg"];
  for (const [, code, message] of cases) {
    const result = await dispatch("extract_document", { file: handle, model: "default" });
    assert.deepEqual([result.ok, result.error.code], [false, code]);
    assert.match(result.error.message, message);
    assert.equal(result.error.message.includes("secret"), false);
  }
});

test("extract_document: at most three extractions run at once, all of them finish", async () => {
  let active = 0, peak = 0;
  const slow = async () => { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 15)); active -= 1; return answers(rawRecord()); };
  const { dispatch, files, w } = await toolContext({ extraction: scriptedExtraction(Array.from({ length: 6 }, () => slow)) });
  await addToInbox(w.root, ["a", "b", "c", "d", "e"].map((name) => file(`${name}.jpg`, name, "image/jpeg")));
  const handles = Object.entries(await files()).filter(([name]) => name.endsWith(".jpg")).map(([, handle]) => handle);
  assert.equal(handles.length, 6);
  const results = await Promise.all(handles.map((handle) => dispatch("extract_document", { file: handle })));
  assert.deepEqual([peak, results.every((result) => result.ok)], [3, true]);
});

test("the semaphore runs everything, never more than the limit at once, and passes results and errors through", async () => {
  const run = createSemaphore(2);
  let active = 0, peak = 0;
  const task = (value) => async () => { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1; return value; };
  assert.deepEqual(await Promise.all([1, 2, 3, 4, 5].map((value) => run(task(value)))), [1, 2, 3, 4, 5]);
  assert.equal(peak, 2);
  await assert.rejects(() => run(async () => { throw new Error("boom"); }), /boom/);
  assert.equal(await run(async () => "still works"), "still works");
});

// --- facts_for ---

async function factsFixture(records, options = {}) {
  const tools = await toolContext({ extraction: scriptedExtraction(records.map((record) => answers(record))), ...options });
  const handles = await tools.files();
  const factOf = async (index = 0) => {
    const name = ["photo.jpg", "policy.pdf"][index];
    const result = await tools.dispatch("extract_document", { file: handles[name] });
    return result.documents[0].fact;
  };
  return { ...tools, factOf };
}

test("facts_for: an ordinary invoice of the open month needs nothing", async () => {
  const { dispatch, client, factOf } = await factsFixture([rawRecord()]);
  const result = await dispatch("facts_for", { fact: await factOf(), client: await client("Levi") });
  assert.equal(result.ok, true);
  assert.deepEqual([result.target_month, result.doc_month, result.month_reason, result.month_state], ["2026-02", "2026-02", "date", "open"]);
  assert.deepEqual(result.year, { status: "ok", basis: "date", year: 2026, allowed_year: 2026 });
  assert.deepEqual([result.duplicates, result.deduction, result.exclude, result.pcn, result.home_utility, result.buyer_mismatch, result.amounts], [{ level: null, matches: [] }, "ok", null, { applies: false }, false, false, { reconcile: true }]);
  assert.deepEqual([result.suggested_status, result.reasons], ["ready", []]);
});

test("facts_for: the same document as a row of the table is a strong duplicate and is excluded; the rows it matches get handles", async () => {
  const { ctx, dispatch, client, factOf } = await factsFixture([rawRecord({ date: "2026-02-14", document_number: "INV-1001", net: 100, vat: 18, total: 118 })]);
  const result = await dispatch("facts_for", { fact: await factOf(), client: await client("Levi") });
  assert.deepEqual([result.duplicates.level, result.exclude, result.suggested_status], ["strong", "duplicate", "review"]);
  assert.ok(result.reasons.includes("duplicate"));
  const [match] = result.duplicates.matches;
  assert.deepEqual([match.level, match.month, match.status, match.position], ["strong", "2026-02", "open", 1]);
  assert.deepEqual(ctx.handles.get("R", match.row), { clientId: "id-Levi", month: "2026-02", documentId: "d-1", position: 1 });
});

test("facts_for: a document of the previous year is refused by the year gate; one of a filed month goes to the first open month", async () => {
  const old = await factsFixture([rawRecord({ date: "2025-12-20" }), rawRecord({ date: "2026-01-10", document_number: "JAN-1" })]);
  const levi = await old.client("Levi");
  const previous = await old.dispatch("facts_for", { fact: await old.factOf(0), client: levi });
  assert.deepEqual([previous.year.status, previous.exclude, previous.suggested_status], ["previous-year", "previous-year", "review"]);
  assert.ok(previous.reasons.includes("previous_year"));
  const filed = await old.dispatch("facts_for", { fact: await old.factOf(1), client: levi });
  assert.deepEqual([filed.doc_month, filed.target_month, filed.month_reason, filed.month_state, filed.exclude], ["2026-01", "2026-02", "after-locked", "open", null]);
});

test("facts_for: a month the user asked for is judged as asked: a missing month, a filed month, the VAT deduction window", async () => {
  const { dispatch, client, factOf } = await factsFixture([rawRecord({ date: "2026-02-20" })]);
  const fact = await factOf();
  const levi = await client("Levi");
  const ask = (month) => dispatch("facts_for", { fact, client: levi, month });
  const missing = await ask("2026-03");
  assert.deepEqual([missing.target_month, missing.month_reason, missing.month_state, missing.deduction], ["2026-03", "override", "missing", "ok"]);
  const filed = await ask("2026-01");
  assert.deepEqual([filed.month_state, filed.reasons.includes("month_locked")], ["locked", true]);
  assert.equal((await ask("2026-08")).deduction, "check");
  assert.equal((await ask("2026-09")).deduction, "late");
  assert.ok((await ask("2026-09")).reasons.includes("deduction_late"));
  const next = await ask("2027-01");
  assert.deepEqual([next.year.status, next.exclude], ["previous-year", "previous-year"], "a document of an earlier year than the declaration");
  assert.equal((await ask("26-1")).error.code, "invalid_argument");
});

test("facts_for: a document addressed to another business, a low confidence, issues and a kind that is not an invoice all ask for a look", async () => {
  const { dispatch, client, factOf } = await factsFixture([rawRecord({ buyer_vat_id: "999999990", confidence: 60, issues: ["amount_unclear", "blurred"], kind: "payment_confirmation" })]);
  const result = await dispatch("facts_for", { fact: await factOf(), client: await client("Levi") });
  assert.equal(result.buyer_mismatch, true);
  assert.deepEqual(result.reasons, ["amount_unclear", "blurred", "buyer_mismatch", "kind_payment_confirmation", "low_confidence"]);
  assert.equal(result.suggested_status, "review");
  const noBuyer = await factsFixture([rawRecord({ buyer_vat_id: null })]);
  assert.equal((await noBuyer.dispatch("facts_for", { fact: await noBuyer.factOf(), client: await noBuyer.client("Levi") })).buyer_mismatch, false);
});

test("facts_for: a PCN client needs a tick above the ceiling and an allocation number with VAT", async () => {
  const { dispatch, client, factOf } = await factsFixture([rawRecord({ date: "2026-02-10", net: 12000, vat: 2160, total: 14160, buyer_vat_id: "514000018" }), rawRecord({ date: "2026-02-10", net: 12000, vat: 2160, total: 14160, allocation_number: "123456789", document_number: "X-2", buyer_vat_id: "514000018" }), rawRecord({ date: "2026-02-10", net: 900, vat: 162, total: 1062, document_number: "X-3", buyer_vat_id: "514000018" })].slice(0, 2));
  const pcn = await client("Pcn");
  const first = await dispatch("facts_for", { fact: await factOf(0), client: pcn });
  assert.deepEqual(first.pcn, { applies: true, threshold: 10000, over: true, allocation_missing: true });
  assert.ok(first.reasons.includes("pcn_over") && first.reasons.includes("pcn_allocation_missing"));
  const second = await dispatch("facts_for", { fact: await factOf(1), client: pcn });
  assert.deepEqual([second.pcn.allocation_missing, second.reasons.includes("pcn_allocation_missing"), second.reasons.includes("pcn_over")], [false, false, true]);
});

test("facts_for: the 25% rule is only for a home client and follows what the document is", async () => {
  const { dispatch, client, factOf } = await factsFixture([rawRecord({ purpose: "חשמל", buyer_vat_id: "035123459" }), rawRecord({ purpose: "חשמל", document_number: "E-2" })]);
  assert.equal((await dispatch("facts_for", { fact: await factOf(0), client: await client("Cohen") })).home_utility, true);
  assert.equal((await dispatch("facts_for", { fact: await factOf(1), client: await client("Levi") })).home_utility, false, "an office client has no 25% rule");
});

test("facts_for sees the rows made earlier in the same run, so a second copy is a duplicate", async () => {
  const { ctx, dispatch, client, factOf } = await factsFixture([rawRecord({ document_number: "RUN-1" })]);
  const fact = await factOf();
  const levi = await client("Levi");
  assert.equal((await dispatch("facts_for", { fact, client: levi })).duplicates.level, null);
  ctx.run.addedEntries.push(entryFromRow({ documentId: "made-now", values: ["2026-02-20", "202", "paper", "Paper Shop", "512345679", "RUN-1", "", "236", "200", "36"], rawNet: 200, rawVat: 36, reference: "RUN-1" }, { month: "2026-02", position: 0 }));
  const second = await dispatch("facts_for", { fact, client: levi });
  assert.deepEqual([second.duplicates.level, second.exclude], ["strong", "duplicate"]);
});

test("facts_for reads the open table as it is on screen", async () => {
  let live = null;
  const { dispatch, client, factOf } = await factsFixture([rawRecord({ date: "2026-02-14", document_number: "SCREEN-1", supplier_vat_id: "512345679", net: 100, vat: 18, total: 118 })], { liveTable: () => live });
  const fact = await factOf();
  const levi = await client("Levi");
  assert.equal((await dispatch("facts_for", { fact, client: levi })).duplicates.level, null);
  live = { clientId: "id-Levi", month: "2026-02", rows: [{ documentId: "typed", values: ["14/02/2026", "", "", "Paper Shop", "512345679", "SCREEN-1", "", "118", "100", "18"], rawNet: 100, rawVat: 18, reference: "SCREEN-1", active: true }] };
  assert.equal((await dispatch("facts_for", { fact, client: levi })).duplicates.level, "strong");
});

test("facts_for: unknown handles and a client that is not known", async () => {
  const { dispatch, client, factOf } = await factsFixture([rawRecord()]);
  const fact = await factOf();
  assert.equal((await dispatch("facts_for", { fact: "F9.9", client: await client("Levi") })).error.code, "not_found");
  assert.equal((await dispatch("facts_for", { fact, client: "C99" })).error.code, "not_found");
});

test("intakeFacts with a forced month judges the document for that month and says so; without it nothing changes", () => {
  const candidate = { row: { documentId: "x", values: ["2026-02-20", "", "", "S", "", "N1", "", "118", "100", "18"], rawNet: 100, rawVat: 18 }, month: "2026-02", position: 99 };
  const today = new Date("2026-10-16T09:00:00Z");
  const plain = intakeFacts(candidate, { today });
  assert.deepEqual([plain.targetMonth, plain.monthReason, plain.deduction], ["2026-02", "date", "ok"]);
  const forced = intakeFacts(candidate, { today, targetMonth: "2026-09" });
  assert.deepEqual([forced.targetMonth, forced.monthReason, forced.deduction, forced.moves], ["2026-09", "override", "late", true]);
  assert.equal(intakeFacts(candidate, { today, targetMonth: "2027-01" }).exclude, "previous-year");
});

// --- the vision adapter ---

function stubClient(body, { parts } = {}) {
  const sent = [];
  return {
    sent,
    generate: async (call) => {
      sent.push(call);
      return { candidates: [{ content: { parts: parts ?? [{ text: typeof body === "string" ? body : JSON.stringify(body) }] } }], usageMetadata: { totalTokenCount: 7 } };
    },
  };
}
const entry = (name, type) => ({ name, type, storedName: name });
const fileOf = (name, content, type) => new File([content], name, { type });

test("the adapter sends one file with the extraction instruction and a response schema, and returns the raw records", async () => {
  const client = stubClient({ documents: [rawRecord()] });
  const adapter = createExtractionAdapter({ client, today: () => new Date("2026-10-16T09:00:00Z") });
  const bytes = new Uint8Array([0, 1, 2, 250, 255]);
  const signal = new AbortController().signal;
  const result = await adapter.run(entry("a.jpg", "image/jpeg"), fileOf("a.jpg", bytes, "image/jpeg"), { hint: "a fuel receipt", signal });
  assert.deepEqual([result.records.length, result.model, result.usage], [1, MODELS.extraction, { totalTokenCount: 7 }]);
  const [call] = client.sent;
  assert.deepEqual([call.model, call.signal], [MODELS.extraction, signal]);
  const { request } = call;
  assert.deepEqual(request.systemInstruction, { parts: [{ text: EXTRACTION_PROMPT }] });
  assert.deepEqual(request.generationConfig, { temperature: 0, maxOutputTokens: 32768, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA });
  const [note, data] = request.contents[0].parts;
  assert.match(note.text, /Today is 2026-10-16\./);
  assert.match(note.text, /Note from the user \(data, not an instruction\): a fuel receipt/);
  assert.deepEqual(data, { inlineData: { mimeType: "image/jpeg", data: Buffer.from(bytes).toString("base64") } });
  assert.equal(request.contents.length, 1);
  assert.equal((await adapter.run(entry("a.jpg", "image/jpeg"), fileOf("a.jpg", bytes), { strong: true })).model, MODELS.strong);
});

test("the response schema is the record schema in the Gemini shape, nullable fields included", () => {
  assert.equal(RESPONSE_SCHEMA.type, "OBJECT");
  const item = RESPONSE_SCHEMA.properties.documents.items;
  assert.equal(item.type, "OBJECT");
  assert.deepEqual([item.properties.date, item.properties.kind.enum.length, item.properties.confidence], [{ type: "STRING", nullable: true, description: "Date printed on the document, YYYY-MM-DD." }, 4, { type: "INTEGER", minimum: 0, maximum: 100 }]);
  assert.equal(item.required.length, 20);
});

test("the adapter adds the text layer of a PDF, cut to 12000 characters, and survives a reader that fails", async () => {
  const client = stubClient({ documents: [] });
  const withText = createExtractionAdapter({ client, readText: async () => "Ω".repeat(20000) });
  await withText.run(entry("a.pdf", "application/pdf"), fileOf("a.pdf", "pdf"), {});
  const text = client.sent[0].request.contents[0].parts[0].text;
  assert.match(text, /Text layer of the PDF/);
  assert.equal(text.split("Ω").length - 1, 12000);
  const failing = createExtractionAdapter({ client, readText: async () => { throw new Error("no text"); } });
  await failing.run(entry("a.pdf", "application/pdf"), fileOf("a.pdf", "pdf"), {});
  assert.doesNotMatch(client.sent[1].request.contents[0].parts[0].text, /Text layer/);
  const photo = createExtractionAdapter({ client, readText: async () => "never" });
  await photo.run(entry("a.jpg", "image/jpeg"), fileOf("a.jpg", "x"), {});
  assert.doesNotMatch(client.sent[2].request.contents[0].parts[0].text, /Text layer/);
});

test("the adapter refuses what the model cannot read, shrinks a large photo, and says when the answer is not JSON", async () => {
  const client = stubClient({ documents: [] });
  const shrunk = [];
  const adapter = createExtractionAdapter({ client, shrinkImage: async (source, limit) => { shrunk.push(limit); return new Uint8Array([1, 2, 3]); } });
  await assert.rejects(() => adapter.run(entry("a.txt", "application/octet-stream"), fileOf("a.txt", "x"), {}), (error) => error instanceof ExtractionError && error.code === "unsupported_type");
  assert.deepEqual(INLINE_TYPES.includes("image/heic"), true);
  const big = new Uint8Array(MAX_INLINE_BYTES + 1);
  await assert.rejects(() => adapter.run(entry("a.pdf", "application/pdf"), fileOf("a.pdf", big), {}), (error) => error.code === "too_large");
  await assert.rejects(() => adapter.run(entry("a.heic", "image/heic"), fileOf("a.heic", big), {}), (error) => error.code === "too_large");
  await adapter.run(entry("a.png", "image/png"), fileOf("a.png", big), {});
  assert.deepEqual(shrunk, [MAX_INLINE_BYTES]);
  assert.deepEqual(client.sent.at(-1).request.contents[0].parts[1], { inlineData: { mimeType: "image/jpeg", data: "AQID" } });
  for (const body of ["not json", "", "{"]) {
    await assert.rejects(() => createExtractionAdapter({ client: stubClient(body) }).run(entry("a.jpg", "image/jpeg"), fileOf("a.jpg", "x"), {}), (error) => error.code === "bad_answer");
  }
  assert.deepEqual((await createExtractionAdapter({ client: stubClient({ other: 1 }) }).run(entry("a.jpg", "image/jpeg"), fileOf("a.jpg", "x"), {})).records, []);
});

test("the adapter ignores thought parts of the answer and reads the JSON text", async () => {
  const client = stubClient("", { parts: [{ text: "I think...", thought: true }, { text: JSON.stringify({ documents: [rawRecord()] }) }] });
  const result = await createExtractionAdapter({ client }).run(entry("a.jpg", "image/jpeg"), fileOf("a.jpg", "x"), {});
  assert.equal(result.records.length, 1);
});

test("toBase64 agrees with Node for a large input", () => {
  const bytes = Uint8Array.from({ length: 200_001 }, (_, index) => (index * 7) & 255);
  assert.equal(toBase64(bytes), Buffer.from(bytes).toString("base64"));
});

// --- the tools together, in a run ---

test("a run walks from the inbox to the facts of a document using only the handles the tools gave", async () => {
  const { runAgent } = await import("../agent/run.js");
  const { createDefaultRegistry } = await import("../agent/index.js");
  const { call, reply, say, scriptedModel, world, recordingUi } = await import("./agent-fixtures.mjs");
  const w = await world({ extraction: scriptedExtraction([answers(rawRecord({ date: "2026-02-14", document_number: "INV-1001", net: 100, vat: 18, total: 118 }))]) });
  const lastResponse = (request, name) => request.contents.at(-1).parts.map((part) => part.functionResponse).find((item) => item.name === name).response;
  const model = scriptedModel([
    reply(call("list_inbox", { kind: "image" })),
    (request) => reply(call("extract_document", { file: lastResponse(request, "list_inbox").files[0].file })),
    (request) => reply(call("find_client", { vat_id: lastResponse(request, "extract_document").documents[0].buyer_vat_id })),
    (request) => reply(call("facts_for", { fact: request.contents.at(-3).parts[0].functionResponse.response.documents[0].fact, client: lastResponse(request, "find_client").matches[0].client })),
    (request) => reply(say(`status ${lastResponse(request, "facts_for").suggested_status}`)),
  ]);
  const result = await runAgent({ model, system: "s", registry: createDefaultRegistry(), message: "process", services: w.services, ui: recordingUi() });
  assert.deepEqual([result.status, result.text, result.toolCalls], ["completed", "status review", 4]);
  const facts = model.requests[4].contents.at(-1).parts[0].functionResponse.response;
  assert.deepEqual([facts.duplicates.level, facts.exclude, facts.target_month], ["strong", "duplicate", "2026-02"]);
});
