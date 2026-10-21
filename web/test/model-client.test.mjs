import test from "node:test";
import assert from "node:assert/strict";
import { createAccess } from "../access.js";
import { MODEL_MESSAGES, ModelError, answerText, checkModelConnection, createModelClient, readEvents } from "../model-client.js";

const API = "https://worker.test";
const T0 = Date.UTC(2026, 10, 1, 8, 0, 0);
const request = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };
const answer = (text) => ({ candidates: [{ content: { parts: [{ text }] } }] });
const reply = (status, body) => ({ ok: status < 300, status, json: async () => body, body: null });

// An access object that is already logged in (the token comes from a fake login answer).
async function loggedIn(fetchImpl, now = () => T0) {
  const access = createAccess({
    api: API,
    now,
    fetchImpl: async () => reply(200, { token: "tok", user: "anna", expiresAt: T0 + 3600_000 }),
  });
  await access.login("K7M2QX");
  return access;
}

test("generate sends the token and a { model, stream, request } body to /v1/model and returns the answer", async () => {
  const calls = [];
  const access = await loggedIn();
  const client = createModelClient({
    api: API,
    access,
    ensureLoggedIn: async () => assert.fail("already logged in"),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return reply(200, answer("OK"));
    },
  });
  assert.equal(answerText(await client.generate({ model: "gemini-3.5-flash-lite", request })), "OK");
  assert.equal(calls[0].url, `${API}/v1/model`);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(calls[0].init.body), { model: "gemini-3.5-flash-lite", stream: false, request });
});

test("without a token the code is asked first, and the request waits for it", async () => {
  const access = createAccess({ api: API, fetchImpl: async () => reply(200, { token: "tok", user: "anna", expiresAt: T0 + 5000 }), now: () => T0 });
  let asked = 0;
  const client = createModelClient({
    api: API,
    access,
    ensureLoggedIn: async () => {
      asked += 1;
      await access.login("K7M2QX");
      return access.user();
    },
    fetchImpl: async () => reply(200, answer("late")),
  });
  assert.equal(answerText(await client.generate({ model: "gemini-3.8-flash", request })), "late");
  assert.equal(asked, 1);
});

test("a person who closes the code dialog gets a login error and nothing is sent", async () => {
  let sent = 0;
  const client = createModelClient({
    api: API,
    access: createAccess({ api: API }),
    ensureLoggedIn: async () => null,
    fetchImpl: async () => {
      sent += 1;
      return reply(200, answer("x"));
    },
  });
  await assert.rejects(client.generate({ model: "gemini-3.8-flash", request }), (error) => error instanceof ModelError && error.code === "login");
  assert.equal(sent, 0);
});

test("a refused token (401) clears it, asks for the code again and repeats the request once", async () => {
  const access = await loggedIn();
  const tokens = [];
  const client = createModelClient({
    api: API,
    access,
    ensureLoggedIn: async () => {
      access.logout();
      await access.login("K7M2QX");
      return access.user();
    },
    fetchImpl: async (url, init) => {
      tokens.push(init.headers.Authorization);
      return tokens.length === 1 ? reply(401, { code: "login" }) : reply(200, answer("again"));
    },
  });
  assert.equal(answerText(await client.generate({ model: "gemini-3.8-flash", request })), "again");
  assert.equal(tokens.length, 2);
});

test("a second 401 is an error, not a loop", async () => {
  const access = await loggedIn();
  let sent = 0;
  const client = createModelClient({
    api: API,
    access,
    ensureLoggedIn: async () => {
      await access.login("K7M2QX");
      return access.user();
    },
    fetchImpl: async () => {
      sent += 1;
      return reply(401, { code: "login" });
    },
  });
  await assert.rejects(client.generate({ model: "gemini-3.8-flash", request }), (error) => error.code === "login");
  assert.equal(sent, 2);
});

test("Worker errors become ModelError with a Hebrew message by their code", async () => {
  const cases = [
    [429, { code: "busy" }, "busy"],
    [502, { code: "unavailable" }, "unavailable"],
    [502, { code: "rejected" }, "rejected"],
    [502, { code: "billing" }, "billing"],
    [413, { code: "too-large" }, "too-large"],
    [400, { error: "x" }, "bad-request"],
    [500, null, "unavailable"],
  ];
  for (const [status, body, code] of cases) {
    const client = createModelClient({ api: API, access: await loggedIn(), ensureLoggedIn: async () => "anna", fetchImpl: async () => reply(status, body) });
    await assert.rejects(client.generate({ model: "gemini-3.8-flash", request }), (error) => error.code === code && error.message === MODEL_MESSAGES[code]);
  }
  const offline = createModelClient({
    api: API,
    access: await loggedIn(),
    ensureLoggedIn: async () => "anna",
    fetchImpl: async () => {
      throw new TypeError("offline");
    },
  });
  await assert.rejects(offline.generate({ model: "gemini-3.8-flash", request }), (error) => error.code === "network");
  const unconfigured = createModelClient({ api: "", access: createAccess({ api: "" }), ensureLoggedIn: async () => "anna" });
  await assert.rejects(unconfigured.generate({ model: "gemini-3.8-flash", request }), (error) => error.code === "unavailable");
});

const sse = (text) =>
  new ReadableStream({
    start(controller) {
      for (const piece of text) controller.enqueue(new TextEncoder().encode(piece));
      controller.close();
    },
  });

test("readEvents yields the JSON of every data: event, also when chunks cut an event in two", async () => {
  const text = 'data: {"a":1}\r\n\r\ndata: {"a":2}\n\ndata: [DONE]\n\ndata: {"a":3}';
  for (const size of [1, 7, 1000]) {
    const pieces = text.match(new RegExp(`[\\s\\S]{1,${size}}`, "g"));
    const seen = [];
    for await (const event of readEvents(sse(pieces))) seen.push(event.a);
    assert.deepEqual(seen, [1, 2, 3], `chunk size ${size}`);
  }
});

test("stream yields the chunks of the answer in order", async () => {
  const body = sse([`data: ${JSON.stringify(answer("Hel"))}\n\n`, `data: ${JSON.stringify(answer("lo"))}\n\n`]);
  const calls = [];
  const client = createModelClient({
    api: API,
    access: await loggedIn(),
    ensureLoggedIn: async () => "anna",
    fetchImpl: async (url, init) => {
      calls.push(JSON.parse(init.body));
      return { ok: true, status: 200, body };
    },
  });
  let text = "";
  for await (const chunk of client.stream({ model: "gemini-3.8-flash", request })) text += answerText(chunk);
  assert.equal(text, "Hello");
  assert.equal(calls[0].stream, true);
});

test("answerText skips thought parts and tolerates an empty answer", () => {
  assert.equal(answerText({ candidates: [{ content: { parts: [{ text: "plan", thought: true }, { text: "A" }, { functionCall: { name: "x" } }, { text: "B" }] } }] }), "AB");
  assert.equal(answerText({}), "");
  assert.equal(answerText(null), "");
});

test("the connection check reports success or the reason in Hebrew", async () => {
  const good = createModelClient({ api: API, access: await loggedIn(), ensureLoggedIn: async () => "anna", fetchImpl: async () => reply(200, answer("OK")) });
  const ok = await checkModelConnection(good, "gemini-3.5-flash-lite");
  assert.equal(ok.ok, true);
  assert.equal(ok.text, "OK");
  assert.match(ok.message, /תקין/);
  const bad = createModelClient({ api: API, access: await loggedIn(), ensureLoggedIn: async () => "anna", fetchImpl: async () => reply(429, { code: "busy" }) });
  assert.deepEqual(await checkModelConnection(bad), { ok: false, message: MODEL_MESSAGES.busy });
});
