import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import worker from "../src/index.js";
import { RIVHIT_MAPPING } from "../src/rivhit-mapping.js";

const ORIGIN = "https://vitaliksh.github.io";
const SESSION = "s".repeat(32);
const [FORM_CODE, [RIVHIT_CODE, RIVHIT_NAME]] = Object.entries(RIVHIT_MAPPING)[0];
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stub(handler) {
  return { idFromName: (name) => name, get: (id) => ({ fetch: (url, init) => handler(id, url, init) }) };
}
function makeEnv(overrides = {}) {
  return {
    ALLOWED_ORIGINS: `${ORIGIN},http://localhost:8000`,
    BACKEND_VERSION: "test-version",
    BOT_USERNAME: "TestBot",
    GEMINI_API_KEY: "test-gemini-key",
    UPLOAD_SESSION: stub(async () => new Response("{}", { status: 200 })),
    DEVICE_REGISTRY: stub(async () => new Response("{}", { status: 200 })),
    ...overrides,
  };
}
const call = (path, { method = "POST", origin = ORIGIN, headers = {}, body, env = makeEnv() } = {}) =>
  worker.fetch(
    new Request(`https://worker.test${path}`, {
      method,
      headers: { ...(origin ? { origin } : {}), ...headers },
      body: method === "GET" || method === "OPTIONS" ? undefined : body,
    }),
    env,
  );

function mockGemini(records, { status = 200, raw = null } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const text = raw ?? JSON.stringify({ records });
    return Response.json(status === 200 ? { candidates: [{ content: { parts: [{ text }] } }] } : { error: { message: "boom" } }, { status });
  };
  return calls;
}
const recognize = (records, { headers = {}, env, body = new Uint8Array([1, 2, 3]) } = {}) =>
  call(`/v1/sessions/${SESSION}/recognize`, {
    env,
    body,
    headers: { "content-type": "image/jpeg", "x-business-activity": encodeURIComponent("graphic design"), ...headers },
  });
const invoice = (overrides = {}) => ({
  document_kind: "expense_invoice", confidence: 88, agent_opinion: "fine", date: "2026-09-03",
  supplier_name: "Supplier", supplier_vat_id: "514000001", invoice_number: "42", purpose: "work",
  total_amount: 118, currency: "ILS", form_6111_code: FORM_CODE, rivhit_code: null,
  net_amount: 100, vat_amount: 18, vat_percent: 18, recognized_percent: 100, vat_recognized_percent: 100,
  ...overrides,
});

test("health reports the backend version with CORS for an allowed origin", async () => {
  const response = await call("/health", { method: "GET" });
  assert.deepEqual(await response.json(), { ok: true, version: "test-version" });
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
});

test("preflight allows the custom headers only for allowed origins", async () => {
  const allowed = await call("/v1/sessions", { method: "OPTIONS" });
  assert.match(allowed.headers.get("access-control-allow-headers"), /x-custom-rivhit-codes/);
  assert.match(allowed.headers.get("access-control-allow-headers"), /x-form-6111-mapping/);
  const denied = await call("/v1/sessions", { method: "OPTIONS", origin: "https://evil.example" });
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
});

test("API routes reject disallowed or missing origins", async () => {
  assert.equal((await call("/v1/sessions", { origin: "https://evil.example" })).status, 403);
  assert.equal((await call("/v1/sessions", { origin: null })).status, 403);
});

test("unknown paths are 404 and wrong methods are 405", async () => {
  assert.equal((await call("/nope", { method: "GET" })).status, 404);
  assert.equal((await call(`/v1/sessions/${SESSION}/events`)).status, 405);
  assert.equal((await call(`/v1/sessions/${SESSION}/recognize`, { method: "GET" })).status, 405);
});

test("session creation returns opaque credentials and a Telegram deep link", async () => {
  const response = await call("/v1/sessions", { body: JSON.stringify({ purpose: "passkey-enrollment" }) });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.ok(body.sessionId.length >= 30 && body.clientToken.length >= 30);
  assert.equal(body.telegramUrl, `https://t.me/TestBot?start=${body.sessionId}`);
});

test("session creation forwards the purpose, defaulting to upload", async () => {
  const purposes = [];
  const env = makeEnv({
    UPLOAD_SESSION: stub(async (_id, _url, init) => {
      purposes.push(JSON.parse(init.body).purpose);
      return new Response("{}");
    }),
  });
  await call("/v1/sessions", { env, body: JSON.stringify({ purpose: "passkey-enrollment" }) });
  await call("/v1/sessions", { env, body: JSON.stringify({ purpose: "something else" }) });
  await call("/v1/sessions", { env, body: "not json" });
  assert.deepEqual(purposes, ["passkey-enrollment", "upload", "upload"]);
});

test("recognize passes the session authorisation failure through with CORS", async () => {
  const env = makeEnv({ UPLOAD_SESSION: stub(async () => Response.json({ error: "expired" }, { status: 401 })) });
  const response = await recognize([], { env });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
});

test("recognize validates configuration, content type, activity, model and size", async () => {
  mockGemini([]);
  assert.equal((await recognize([], { env: makeEnv({ GEMINI_API_KEY: "" }) })).status, 503);
  assert.equal((await recognize([], { headers: { "content-type": "image/gif" } })).status, 415);
  assert.equal((await recognize([], { headers: { "x-business-activity": "" } })).status, 400);
  assert.equal((await recognize([], { headers: { "x-gemini-model": "gpt-4" } })).status, 400);
  assert.equal((await recognize([], { headers: { "x-target-record": "{bad" } })).status, 400);
  assert.equal((await recognize([], { body: new Uint8Array(0) })).status, 413);
  assert.equal((await recognize([], { body: new Uint8Array(12 * 1024 * 1024 + 1) })).status, 413);
});

test("an approved Form 6111 code is mapped to its Rivhit code and included", async () => {
  mockGemini([invoice()]);
  const [record] = (await (await recognize()).json()).records;
  assert.equal(record.form_6111_code, FORM_CODE);
  assert.equal(record.rivhit_code, RIVHIT_CODE);
  assert.equal(record.classification_name, RIVHIT_NAME);
  assert.equal(record.include, true);
  assert.equal(record.net_amount, 100);
});

test("a Gemini request carries the API key in a header, never in the URL or the response", async () => {
  const calls = mockGemini([invoice()]);
  const response = await recognize();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers["x-goog-api-key"], "test-gemini-key");
  assert.ok(!calls[0].url.includes("test-gemini-key"));
  assert.ok(!(await response.text()).includes("test-gemini-key"));
});

test("an invented classification code is discarded and the row is not exported", async () => {
  mockGemini([invoice({ form_6111_code: "9999", rivhit_code: "555" })]);
  const [record] = (await (await recognize()).json()).records;
  assert.equal(record.rivhit_code, null);
  assert.equal(record.form_6111_code, null);
  assert.equal(record.include, false);
  assert.match(record.agent_opinion, /fine/);
  assert.ok(record.agent_opinion.length > "fine".length);
});

test("a supplied custom code is accepted, a built-in or unlisted one is not", async () => {
  mockGemini([invoice({ form_6111_code: null, rivhit_code: "950" })]);
  const custom = encodeURIComponent(JSON.stringify({ 950: "Local code", [RIVHIT_CODE]: "Hijack", "12": "short" }));
  const accepted = (await (await recognize([], { headers: { "x-custom-rivhit-codes": custom } })).json()).records[0];
  assert.equal(accepted.rivhit_code, "950");
  assert.equal(accepted.classification_name, "Local code");
  assert.equal(accepted.form_6111_code, null);
  assert.equal(accepted.include, true);

  mockGemini([invoice({ form_6111_code: null, rivhit_code: RIVHIT_CODE })]);
  const hijack = (await (await recognize([], { headers: { "x-custom-rivhit-codes": custom } })).json()).records[0];
  assert.equal(hijack.rivhit_code, null);
  assert.equal(hijack.include, false);

  mockGemini([invoice({ form_6111_code: null, rivhit_code: "951" })]);
  const unlisted = (await (await recognize([], { headers: { "x-custom-rivhit-codes": custom } })).json()).records[0];
  assert.equal(unlisted.rivhit_code, null);
});

test("custom codes are listed in the Gemini prompt", async () => {
  const calls = mockGemini([invoice()]);
  const custom = encodeURIComponent(JSON.stringify({ 950: "Local code" }));
  await recognize([], { headers: { "x-custom-rivhit-codes": custom } });
  assert.match(JSON.parse(calls[0].init.body).system_instruction.parts[0].text, /Rivhit 950: Local code/);
});

test("a Form 6111 override only replaces codes that already exist", async () => {
  const override = encodeURIComponent(JSON.stringify({ [FORM_CODE]: ["777", "Overridden"], "0001": ["778", "New"] }));
  mockGemini([invoice(), invoice({ form_6111_code: "0001" })]);
  const records = (await (await recognize([], { headers: { "x-form-6111-mapping": override } })).json()).records;
  assert.equal(records[0].rivhit_code, "777");
  assert.equal(records[0].classification_name, "Overridden");
  assert.equal(records[1].rivhit_code, null);
});

test("a payment confirmation keeps the facts read from it but gets no classification and is never exported", async () => {
  mockGemini([invoice({ document_kind: "payment_confirmation", period_from: "2026-10-01", period_to: "2027-09-30" })]);
  const [record] = (await (await recognize()).json()).records;
  assert.equal(record.document_kind, "payment_confirmation");
  assert.deepEqual(
    [record.supplier_name, record.date, record.invoice_number, record.total_amount, record.period_from, record.period_to],
    ["Supplier", "2026-09-03", "42", 118, "2026-10-01", "2027-09-30"],
  );
  for (const field of ["form_6111_code", "rivhit_code", "classification_name", "recognized_percent", "vat_recognized_percent"])
    assert.equal(record[field], null, field);
  assert.equal(record.include, false);
});

test("an 'other' document loses its facts and its period", async () => {
  mockGemini([invoice({ document_kind: "other", period_from: "2026-10-01", period_to: "2027-09-30", document_title: "x" })]);
  const [record] = (await (await recognize()).json()).records;
  for (const field of ["supplier_name", "date", "net_amount", "total_amount", "period_from", "period_to", "document_title"])
    assert.equal(record[field], null, field);
  assert.equal(record.include, false);
});

test("the period and the printed title are passed on; a period that is not YYYY-MM-DD is dropped", async () => {
  mockGemini([
    invoice({ period_from: "2026-10-01", period_to: "2027-09-30", document_title: "  אישור תשלום לפוליסה " }),
    invoice({ period_from: "01/10/2026", period_to: "2027-13-40" }),
    invoice(),
  ]);
  const records = (await (await recognize()).json()).records;
  assert.deepEqual([records[0].period_from, records[0].period_to, records[0].document_title], ["2026-10-01", "2027-09-30", "אישור תשלום לפוליסה"]);
  assert.deepEqual([records[1].period_from, records[1].period_to], [null, null]);
  assert.deepEqual([records[2].period_from, records[2].period_to, records[2].document_title], [null, null, null]);
});

test("the prompt carries today's date and does not tell the model to judge a payment confirmation", async () => {
  const calls = mockGemini([invoice()]);
  await recognize([]);
  const prompt = JSON.parse(calls[0].init.body).system_instruction.parts[0].text;
  assert.match(prompt, new RegExp(`Today is ${new Date().toISOString().slice(0, 10)}`));
  assert.doesNotMatch(prompt, /payment confirmation is not an expense invoice/i);
  assert.match(prompt, /period_from and period_to/);
});

test("income reports keep their source facts but get no classification", async () => {
  mockGemini([invoice({ document_kind: "income_report" })]);
  const [record] = (await (await recognize()).json()).records;
  assert.equal(record.supplier_name, "Supplier");
  assert.equal(record.rivhit_code, null);
  assert.equal(record.include, false);
});

test("an unknown document kind becomes other", async () => {
  mockGemini([invoice({ document_kind: "poem" })]);
  assert.equal((await (await recognize()).json()).records[0].document_kind, "other");
});

test("an empty 'other' record is dropped when an expense invoice is present", async () => {
  mockGemini([invoice(), { document_kind: "other", confidence: 10 }]);
  const records = (await (await recognize()).json()).records;
  assert.deepEqual(records.map((record) => record.document_kind), ["expense_invoice"]);
});

test("source-value boxes are clamped, rounded and discarded when degenerate", async () => {
  mockGemini([
    invoice({
      document_number_box: [-5, 10.4, 50.6, 2000],
      total_amount_box: [100, 100, 100, 200],
      vat_amount_box: [1, 2, 3],
    }),
  ]);
  const [record] = (await (await recognize()).json()).records;
  assert.deepEqual(record.highlight_regions, [{ field: "document_number", box_2d: [0, 10, 51, 1000] }]);
});

test("percentages are clamped to 0-100 and text is trimmed to 500 characters", async () => {
  mockGemini([invoice({ confidence: 250, recognized_percent: -4, purpose: ` ${"x".repeat(900)} ` })]);
  const [record] = (await (await recognize()).json()).records;
  assert.equal(record.confidence, 100);
  assert.equal(record.recognized_percent, 0);
  assert.equal(record.purpose.length, 500);
});

test("Gemini client errors and malformed output become 502 with a safe message", async () => {
  mockGemini([], { status: 400 });
  const rejected = await recognize();
  assert.equal(rejected.status, 502);
  assert.ok(!JSON.stringify(await rejected.json()).includes("boom"));

  mockGemini([], { raw: "not json" });
  assert.equal((await recognize()).status, 502);
  mockGemini([], { raw: JSON.stringify({ nothing: true }) });
  assert.equal((await recognize()).status, 502);
});

const PASSKEY = { "x-passkey-credential-id": "id", "x-passkey-token": "token" };
const bookkeeper = (body, { headers = {}, env, method } = {}) =>
  call("/v1/bookkeeper/process", { env, method, headers: { ...PASSKEY, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const bkRow = (n, extra = {}) => ({ n, document_kind: "expense_invoice", supplier_name: "Supplier", date: "03/09/2026", total: 118, net: 100, vat: 18, ...extra });
const CHART = [
  { code: "204", name: "חשמל", type: "expense" },
  { code: "206", name: "ביטוח עסק", type: "outsideVatBase" },
  { code: "110", name: "הכנסה חייבת", type: "income" },
];
const bkAnswer = (results) => mockGemini([], { raw: JSON.stringify({ results }) });

test("the bookkeeper route needs a passkey authorisation and a POST", async () => {
  const deny = makeEnv({ DEVICE_REGISTRY: stub(async () => new Response("{}", { status: 401 })) });
  assert.equal((await call("/v1/bookkeeper/process")).status, 401);
  assert.equal((await bookkeeper({ rows: [bkRow(1)] }, { env: deny })).status, 401);
  assert.equal((await call("/v1/bookkeeper/process", { method: "GET" })).status, 405);
});

test("the bookkeeper route validates its input", async () => {
  mockGemini([]);
  assert.equal((await bookkeeper("{bad")).status, 400);
  assert.equal((await bookkeeper({})).status, 400);
  assert.equal((await bookkeeper({ rows: [] })).status, 400);
  assert.equal((await bookkeeper({ rows: Array.from({ length: 81 }, (_, index) => bkRow(index + 1)) })).status, 400);
  assert.equal((await bookkeeper({ rows: [bkRow(1), bkRow(1)] })).status, 400);
  assert.equal((await bookkeeper({ rows: [bkRow(1)] }, { headers: { "x-gemini-model": "nope" } })).status, 400);
  assert.equal((await bookkeeper({ rows: [bkRow(1)] }, { env: makeEnv({ GEMINI_API_KEY: "" }) })).status, 503);
});

test("the bookkeeper answer is matched to the rows and only codes of the client's chart survive", async () => {
  bkAnswer([
    { n: 1, decision: "expense", rivhit_code: "204", needs_review: false, reason: "חשמל" },
    { n: 2, decision: "expense", rivhit_code: "110", needs_review: false, reason: "חשבון הכנסה" },
    { n: 3, decision: "expense", rivhit_code: "818", needs_review: false, reason: "קוד כללי" },
    { n: 4, decision: "not_expense", rivhit_code: "204", needs_review: false, reason: "תשלום מס" },
    { n: 5, decision: "poem", rivhit_code: "204", needs_review: false, reason: "" },
    { n: 99, decision: "expense", rivhit_code: "204", needs_review: false, reason: "no such row" },
  ]);
  const response = await bookkeeper({ chart: CHART, rows: [1, 2, 3, 4, 5, 6].map((n) => bkRow(n)) });
  assert.equal(response.status, 200);
  const { results } = await response.json();
  assert.deepEqual(results.map((result) => result.n), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(results.map((result) => [result.decision, result.rivhit_code, result.needs_review]), [
    ["expense", "204", false],
    ["expense", null, true],
    ["expense", null, true],
    ["not_expense", null, true],
    ["unclear", null, true],
    ["unclear", null, true],
  ]);
  assert.equal(results[0].reason, "חשמל");
  assert.equal(results[4].reason, "לא נמסר הסבר מהסוכן.");
  assert.match(results[5].reason, /לא החזיר תשובה/);
});

test("without a chart the built-in codes are allowed; a payload that is not JSON gives a 502", async () => {
  bkAnswer([{ n: 1, decision: "expense", rivhit_code: RIVHIT_CODE, needs_review: false, reason: "x" }]);
  const [first] = (await (await bookkeeper({ rows: [bkRow(1)] })).json()).results;
  assert.equal(first.rivhit_code, RIVHIT_CODE);
  mockGemini([], { raw: "not json" });
  assert.equal((await bookkeeper({ rows: [bkRow(1)] })).status, 502);
  mockGemini([], { status: 400 });
  assert.equal((await bookkeeper({ rows: [bkRow(1)] })).status, 502);
});

test("the bookkeeper prompt carries the client's accounts, the rules and the software facts, and no recognition percentages", async () => {
  const calls = mockGemini([], { raw: JSON.stringify({ results: [] }) });
  await bookkeeper({
    chart: CHART,
    client: { activity: "pilates", kind: "home" },
    declarationMonth: "2026-09",
    rows: [bkRow(1, { facts: { exclude: "duplicate", duplicate: "strong", year: "ok", deduction: "late", junk: 1 } })],
  });
  const body = JSON.parse(calls[0].init.body);
  const prompt = body.system_instruction.parts[0].text;
  assert.match(prompt, /- 206 ביטוח עסק \(outsideVatBase\)/);
  assert.doesNotMatch(prompt, /- 110 /);
  assert.match(prompt, /insurance policy, a policy renewal/);
  assert.match(prompt, /Never decide recognition percentages/);
  assert.match(prompt, /Client activity: pilates/);
  const rows = JSON.parse(body.contents[0].parts[0].text);
  assert.deepEqual(rows[0].facts, { duplicate: "strong", exclude: "duplicate", deduction: "late" });
  assert.equal(body.generationConfig.temperature, 0);
});

const bookkeeperCall = (env, { method = "POST", body = { rows: [{ n: 1, supplier_name: "Acme", total: 118, net: 100, vat: 18, date: "2026-09-03" }] }, headers = {} } = {}) =>
  call(`/v1/sessions/${SESSION}/bookkeeper`, { method, env, body: JSON.stringify(body), headers: { "content-type": "application/json", "x-upload-token": "t".repeat(32), ...headers } });

test("the session bookkeeper route needs the session authorisation, passes its refusal through with CORS and sends nothing to Gemini", async () => {
  const gemini = mockGemini([]);
  const env = makeEnv({ UPLOAD_SESSION: stub(async () => Response.json({ error: "AI access is unauthorized." }, { status: 403 })) });
  const response = await bookkeeperCall(env);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(gemini.length, 0);
  assert.equal((await bookkeeperCall(makeEnv(), { method: "GET" })).status, 405);
});

test("the session bookkeeper route forwards the session token to the authorisation and then answers like the Windows Hello route", async () => {
  const seen = [];
  const env = makeEnv({
    UPLOAD_SESSION: stub(async (id, url, init) => {
      seen.push([id, url, init.headers["X-Upload-Token"]]);
      return Response.json({ ok: true });
    }),
  });
  const gemini = mockGemini(null, { raw: JSON.stringify({ results: [{ n: 1, decision: "expense", rivhit_code: null, needs_review: false, reason: "ok" }] }) });
  const response = await bookkeeperCall(env);
  assert.deepEqual(seen, [[SESSION, "https://session/client/ai-authorize", "t".repeat(32)]]);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(gemini.length, 1);
  assert.ok(Array.isArray((await response.json()).results));
});

test("the session bookkeeper route still validates the request after the authorisation", async () => {
  const gemini = mockGemini([]);
  assert.equal((await bookkeeperCall(makeEnv(), { body: { rows: [] } })).status, 400);
  assert.equal((await bookkeeperCall(makeEnv({ GEMINI_API_KEY: "" }))).status, 503);
  assert.equal(gemini.length, 0);
});

test("the Windows Hello bookkeeper route is unchanged: no passkey grant, no answer", async () => {
  const response = await call("/v1/bookkeeper/process", { body: JSON.stringify({ rows: [{ n: 1 }] }) });
  assert.equal(response.status, 401);
});

// An image sent as a file reaches the session as the original; anything else gets an explanation.
function webhookCase({ document, sessionId = SESSION }) {
  const sent = [], forwarded = [];
  globalThis.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return Response.json({ ok: true });
  };
  const env = makeEnv({
    TELEGRAM_BOT_TOKEN: "t",
    TELEGRAM_WEBHOOK_SECRET: "secret",
    UPLOAD_SESSION: stub(async (id, url, init) => {
      if (String(url).endsWith("/telegram/lookup")) return new Response(sessionId);
      forwarded.push(JSON.parse(init.body));
      return Response.json({ ok: true });
    }),
  });
  const run = () =>
    call("/telegram/webhook", {
      origin: null,
      env,
      headers: { "X-Telegram-Bot-Api-Secret-Token": "secret" },
      body: JSON.stringify({ update_id: 7, message: { chat: { id: 5 }, from: { id: 9 }, document } }),
    });
  return { run, sent, forwarded };
}

test("an image sent as a file is forwarded to the upload session with its own type", async () => {
  const { run, sent, forwarded } = webhookCase({ document: { file_id: "F1", mime_type: "image/png", file_size: 5000000 } });
  assert.equal((await run()).status, 200);
  assert.deepEqual(forwarded, [{ userId: 9, chatId: 5, updateId: 7, photos: [{ file_id: "F1", file_size: 5000000 }], contentType: "image/png" }]);
  assert.deepEqual(sent, []);
});

test("a file that is not a JPG or PNG, or is over 20 MB, is refused with an explanation", async () => {
  for (const [document, pattern] of [
    [{ file_id: "F2", mime_type: "image/heic", file_size: 100 }, /JPG and PNG/],
    [{ file_id: "F3", mime_type: "application/pdf", file_size: 100 }, /JPG and PNG/],
    [{ file_id: "F4", mime_type: "image/jpeg", file_size: 21 * 1024 * 1024 }, /20 MB/],
  ]) {
    const { run, sent, forwarded } = webhookCase({ document });
    await run();
    assert.equal(forwarded.length, 0);
    assert.match(sent[0].text, pattern);
  }
});

test("an image file without an open upload session is answered, not stored", async () => {
  const { run, sent, forwarded } = webhookCase({ document: { file_id: "F5", mime_type: "image/jpeg", file_size: 100 }, sessionId: "" });
  await run();
  assert.equal(forwarded.length, 0);
  assert.match(sent[0].text, /No active upload session/);
});
