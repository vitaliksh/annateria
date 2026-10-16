import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import worker from "../src/index.js";

const ORIGIN = "https://vitaliksh.github.io";
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function makeEnv(overrides = {}) {
  return {
    ALLOWED_ORIGINS: `${ORIGIN},http://localhost:8000`,
    BACKEND_VERSION: "test-version",
    GEMINI_API_KEY: "test-gemini-key",
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

test("health reports the backend version with CORS for an allowed origin", async () => {
  const response = await call("/health", { method: "GET" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, version: "test-version" });
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
});

test("health without a configured version says unknown, and sends no CORS header to a stranger", async () => {
  const response = await call("/health", { method: "GET", origin: "https://evil.example", env: makeEnv({ BACKEND_VERSION: "" }) });
  assert.equal((await response.json()).version, "unknown");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("preflight allows the content-type and authorization headers only for allowed origins", async () => {
  const allowed = await call("/anything", { method: "OPTIONS" });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("access-control-allow-headers"), "content-type, authorization");
  const stranger = await call("/anything", { method: "OPTIONS", origin: "https://evil.example" });
  assert.equal(stranger.headers.get("access-control-allow-origin"), null);
});

test("other routes reject disallowed or missing origins", async () => {
  assert.equal((await call("/v1/model", { origin: "https://evil.example" })).status, 403);
  assert.equal((await call("/v1/model", { origin: "" })).status, 403);
});

test("the routes of the old Telegram / passkey / recognition Worker are gone and never reach Gemini", async () => {
  let geminiCalls = 0;
  globalThis.fetch = async () => {
    geminiCalls += 1;
    return Response.json({});
  };
  const sessionId = "s".repeat(32);
  for (const path of [
    "/telegram/webhook",
    "/v1/sessions",
    `/v1/sessions/${sessionId}/recognize`,
    `/v1/sessions/${sessionId}/bookkeeper`,
    "/v1/bookkeeper/process",
    "/v1/passkeys/authentication-options",
  ]) {
    assert.equal((await call(path, { body: "{}" })).status, 404, path);
  }
  assert.equal(geminiCalls, 0);
});
