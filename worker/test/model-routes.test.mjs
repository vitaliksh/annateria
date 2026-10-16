import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import worker from "../src/index.js";
import { base64url, signToken } from "../src/access.js";
import { MAX_REQUEST_BYTES } from "../src/model.js";

const ORIGIN = "https://vitaliksh.github.io";
const SIGNING_KEY = base64url(crypto.getRandomValues(new Uint8Array(32)));
const GEMINI_KEY = "test-gemini-key-do-not-leak";
const SECRET_TEXT = "SENTINEL-client-document-text";
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const env = (overrides = {}) => ({
  ALLOWED_ORIGINS: ORIGIN,
  GEMINI_API_KEY: GEMINI_KEY,
  TOKEN_SIGNING_KEY: SIGNING_KEY,
  ...overrides,
});
const bearer = async (user = "anna", key = SIGNING_KEY, now = Date.now()) => `Bearer ${(await signToken(user, key, now)).token}`;
const ask = async (body, { authorization, origin = ORIGIN, method = "POST", environment = env(), headers = {} } = {}) =>
  worker.fetch(
    new Request("https://worker.test/v1/model", {
      method,
      headers: {
        ...(origin ? { origin } : {}),
        authorization: authorization === undefined ? await bearer() : authorization,
        ...headers,
      },
      body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
    environment,
  );
const valid = (extra = {}) => ({
  model: "gemini-3.5-flash-lite",
  request: { contents: [{ role: "user", parts: [{ text: SECRET_TEXT }] }] },
  ...extra,
});

function stubGemini(respond) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return respond(url, init);
  };
  return calls;
}
const gemini = (body = { candidates: [{ content: { parts: [{ text: "OK" }] } }], usageMetadata: { totalTokenCount: 7 } }, status = 200) =>
  () => Response.json(body, { status });

test("a logged-in caller gets Gemini's answer; the key goes in a header and never in the URL or the answer", async () => {
  const calls = stubGemini(gemini());
  const response = await ask(valid());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).usageMetadata.totalTokenCount, 7);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
  assert.equal(calls[0].init.headers["x-goog-api-key"], GEMINI_KEY);
  assert.ok(!calls[0].url.includes(GEMINI_KEY) && !calls[0].url.includes("key="));
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.contents[0].parts[0].text, SECRET_TEXT);
  assert.equal(sent.generationConfig.maxOutputTokens, 8192);
  assert.deepEqual(Object.keys(sent).sort(), ["contents", "generationConfig"]);
});

test("without a valid token Gemini is never called: missing, forged, altered, expired, other key", async () => {
  const calls = stubGemini(gemini());
  const other = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const refused = [
    "",
    "Bearer ",
    "Basic abc",
    await bearer("anna", other),
    (await bearer()).slice(0, -3) + "AAA",
    await bearer("anna", SIGNING_KEY, Date.now() - 13 * 3600_000),
  ];
  for (const authorization of refused) {
    const response = await ask(valid(), { authorization });
    assert.equal(response.status, 401, authorization);
    assert.equal((await response.json()).code, "login");
  }
  assert.equal(calls.length, 0);
});

test("only POST from an allowed origin; missing Gemini key or broken signing key is 503", async () => {
  const calls = stubGemini(gemini());
  assert.equal((await ask(valid(), { method: "GET" })).status, 405);
  assert.equal((await ask(valid(), { origin: "https://evil.example" })).status, 403);
  assert.equal((await ask(valid(), { origin: "" })).status, 403);
  assert.equal((await ask(valid(), { environment: env({ GEMINI_API_KEY: "" }) })).status, 503);
  const silence = console.error;
  console.error = () => {};
  try {
    assert.equal((await ask(valid(), { environment: env({ TOKEN_SIGNING_KEY: base64url(new Uint8Array(4)) }) })).status, 503);
  } finally {
    console.error = silence;
  }
  assert.equal(calls.length, 0);
});

test("a request outside the allow-list is 400 and Gemini is not called", async () => {
  const calls = stubGemini(gemini());
  const bad = [
    "not json",
    {},
    valid({ model: "gemini-1.0-pro" }),
    valid({ model: "gemini-3.8-flash:streamGenerateContent" }),
    valid({ apiKey: "x" }),
    { model: "gemini-3.8-flash", request: { contents: [{ parts: [{ fileData: { fileUri: "https://example.com/x.pdf" } }] }] } },
    { model: "gemini-3.8-flash", request: { contents: [{ parts: [{ text: "x" }] }], tools: [{ googleSearch: {} }] } },
    { model: "gemini-3.8-flash", request: { contents: [{ parts: [{ text: "x" }] }], generationConfig: { maxOutputTokens: 10 ** 6 } } },
  ];
  for (const body of bad) assert.equal((await ask(body)).status, 400, JSON.stringify(body).slice(0, 80));
  assert.equal(calls.length, 0);
});

test("a request over 20 MB is 413, whether or not it announces its size", async () => {
  const calls = stubGemini(gemini());
  const huge = JSON.stringify(valid({ request: { contents: [{ parts: [{ text: "x".repeat(MAX_REQUEST_BYTES) }] }] } }));
  assert.equal((await ask(huge)).status, 413);
  assert.equal((await ask("{}", { headers: { "content-length": String(MAX_REQUEST_BYTES + 1) } })).status, 413);
  assert.equal(calls.length, 0);
});

test("stream: true asks for server-sent events and passes the stream through with CORS", async () => {
  const events = 'data: {"candidates":[{"content":{"parts":[{"text":"A"}]}}]}\r\n\r\ndata: {"usageMetadata":{"totalTokenCount":3}}\r\n\r\n';
  const calls = stubGemini(() => new Response(events, { headers: { "content-type": "text/event-stream" } }));
  const response = await ask(valid({ stream: true }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/event-stream/);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(await response.text(), events);
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse");
});

test("Gemini errors become short messages: busy 429, unavailable 502, rejected 502; its own text is not passed on", async () => {
  const quote = { error: { message: `bad input: ${SECRET_TEXT}`, status: "INVALID_ARGUMENT" } };
  const expected = [[429, 429, "busy"], [503, 502, "unavailable"], [500, 502, "unavailable"], [400, 502, "rejected"], [403, 502, "rejected"]];
  const silence = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  try {
    for (const [from, to, code] of expected) {
      stubGemini(gemini(quote, from));
      const response = await ask(valid());
      assert.equal(response.status, to, String(from));
      const body = await response.json();
      assert.equal(body.code, code);
      assert.ok(!JSON.stringify(body).includes(SECRET_TEXT));
    }
  } finally {
    console.error = silence;
  }
  assert.ok(logged.every((line) => !line.includes(SECRET_TEXT) && !line.includes(GEMINI_KEY)));
});

test("an unreachable Gemini or an unreadable answer is 502, not a hang or a crash", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("network");
  };
  assert.equal((await ask(valid())).status, 502);
  stubGemini(() => new Response("<html>not json</html>", { status: 200 }));
  assert.equal((await ask(valid())).status, 502);
});

test("nothing from the request or the answer is written to the log", async () => {
  const lines = [];
  const originals = {};
  for (const method of ["log", "info", "warn", "error", "debug"]) {
    originals[method] = console[method];
    console[method] = (...args) => lines.push(args.map(String).join(" "));
  }
  try {
    stubGemini(gemini({ candidates: [{ content: { parts: [{ text: `answer ${SECRET_TEXT}` }] } }] }));
    await (await ask(valid())).json();
    stubGemini(gemini({ error: { message: SECRET_TEXT } }, 400));
    await ask(valid());
    stubGemini(() => new Response(`data: ${SECRET_TEXT}\n\n`));
    await (await ask(valid({ stream: true }))).text();
  } finally {
    Object.assign(console, originals);
  }
  assert.ok(lines.every((line) => !line.includes(SECRET_TEXT) && !line.includes(GEMINI_KEY)), lines.join("|"));
});
