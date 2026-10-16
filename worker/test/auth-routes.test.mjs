import assert from "node:assert/strict";
import test from "node:test";
import worker, { requireUser } from "../src/index.js";
import { base64url, hashCode, signToken, verifyToken } from "../src/access.js";
import { AuthGuard, IP_MAX_ATTEMPTS } from "../src/auth-guard.js";

const ORIGIN = "https://vitaliksh.github.io";
const SIGNING_KEY = base64url(crypto.getRandomValues(new Uint8Array(32)));
const ANNA = "ANNA22";
const VITALIK = "VKT777";
const accessCodes = JSON.stringify({
  anna: await hashCode(ANNA, { iterations: 1000 }),
  vitalik: await hashCode(VITALIK, { iterations: 1000 }),
});

// The guard runs for real; only the Durable Object plumbing is replaced by a queue (one request at a time).
function guardNamespace() {
  const values = new Map();
  const guard = new AuthGuard({
    storage: {
      get: async (key) => structuredClone(values.get(key)),
      put: async (key, value) => void values.set(key, structuredClone(value)),
    },
  });
  let queue = Promise.resolve();
  const fetchOne = (url, init) => {
    const result = queue.then(() => guard.fetch(new Request(url, init)));
    queue = result.catch(() => {});
    return result;
  };
  return { idFromName: (name) => name, get: () => ({ fetch: fetchOne }) };
}

function makeEnv(overrides = {}) {
  return {
    ALLOWED_ORIGINS: `${ORIGIN},http://localhost:8000`,
    BACKEND_VERSION: "test-version",
    ACCESS_CODES: accessCodes,
    TOKEN_SIGNING_KEY: SIGNING_KEY,
    AUTH_GUARD: guardNamespace(),
    ...overrides,
  };
}

const login = (code, { env = makeEnv(), address = "198.51.100.1", origin = ORIGIN, method = "POST", body } = {}) =>
  worker.fetch(
    new Request("https://worker.test/v1/auth", {
      method,
      headers: { ...(origin ? { origin } : {}), "cf-connecting-ip": address },
      body: method === "GET" ? undefined : (body ?? JSON.stringify({ code })),
    }),
    env,
  );

test("the right code gives a token for its user, valid for 12 hours, and nothing secret", async () => {
  const env = makeEnv();
  const before = Date.now();
  const response = await login(ANNA, { env });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.user, "anna");
  assert.ok(body.expiresAt >= before + 12 * 3600_000 && body.expiresAt <= Date.now() + 12 * 3600_000);
  assert.deepEqual(await verifyToken(body.token, SIGNING_KEY), { user: "anna", expiresAt: body.expiresAt });
  assert.ok(!JSON.stringify(body).includes(SIGNING_KEY) && !JSON.stringify(body).includes(accessCodes));
  assert.equal((await (await login(" vkt-777 ", { env })).json()).user, "vitalik");
});

test("a wrong code is 401 and says nothing about which part was wrong", async () => {
  const response = await login("ANNA23");
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Wrong code." });
});

test("a code in the wrong format is 400 and does not count as an attempt", async () => {
  const env = makeEnv();
  const bodies = ["{}", "not json", JSON.stringify({ code: "short" }), JSON.stringify({ code: "ANNA2O" }), JSON.stringify({ code: ANNA, pad: "x".repeat(2000) })];
  for (const body of bodies) assert.equal((await login(null, { env, body })).status, 400, body);
  for (let attempt = 0; attempt < IP_MAX_ATTEMPTS; attempt += 1) assert.equal((await login("ZZZZZZ", { env })).status, 401);
});

test("after five wrong codes the address is locked out: even the right code gets 429 with Retry-After", async () => {
  const env = makeEnv();
  for (let attempt = 0; attempt < IP_MAX_ATTEMPTS; attempt += 1) assert.equal((await login("ZZZZZZ", { env })).status, 401);
  const locked = await login(ANNA, { env });
  assert.equal(locked.status, 429);
  assert.equal(locked.headers.get("retry-after"), "900");
  assert.equal((await locked.json()).retryAfterSeconds, 900);
  assert.equal((await login(ANNA, { env, address: "198.51.100.2" })).status, 200);
});

test("a right code in time clears the failures, so typos do not pile up over days", async () => {
  const env = makeEnv();
  for (let round = 0; round < 3; round += 1) {
    for (let attempt = 0; attempt < IP_MAX_ATTEMPTS - 1; attempt += 1) assert.equal((await login("ZZZZZZ", { env })).status, 401);
    assert.equal((await login(ANNA, { env })).status, 200);
  }
});

test("many addresses guessing together hit the global ceiling, and then the right code is refused too", async () => {
  const env = makeEnv();
  for (let guess = 0; guess < 20; guess += 1) assert.equal((await login("ZZZZZZ", { env, address: `203.0.113.${guess}` })).status, 401);
  const refused = await login(ANNA, { env, address: "203.0.113.200" });
  assert.equal(refused.status, 429);
  assert.ok(Number(refused.headers.get("retry-after")) > 3000);
});

test("login fails closed: missing or broken secrets and an unreachable guard give 503, never a token", async () => {
  const unreachable = {
    idFromName: () => "x",
    get: () => ({
      fetch: async () => {
        throw new Error("down");
      },
    }),
  };
  const broken = [
    { ACCESS_CODES: "" },
    { TOKEN_SIGNING_KEY: "" },
    { AUTH_GUARD: undefined },
    { ACCESS_CODES: "not json" },
    { TOKEN_SIGNING_KEY: base64url(new Uint8Array(4)) },
    { AUTH_GUARD: unreachable },
  ];
  const silence = console.error;
  console.error = () => {};
  try {
    for (const override of broken) {
      const response = await login(ANNA, { env: makeEnv(override) });
      assert.equal(response.status, 503, JSON.stringify(Object.keys(override)));
      assert.ok(!("token" in (await response.json())));
    }
  } finally {
    console.error = silence;
  }
});

test("login needs POST and an allowed origin", async () => {
  assert.equal((await login(ANNA, { method: "GET" })).status, 405);
  assert.equal((await login(ANNA, { origin: "https://evil.example" })).status, 403);
  assert.equal((await login(ANNA, { origin: "" })).status, 403);
});

test("requireUser accepts a genuine token and refuses forged, altered, expired and missing ones", async () => {
  const env = makeEnv();
  const asRequest = (authorization) => new Request("https://worker.test/v1/model", { headers: authorization ? { authorization } : {} });
  const { token } = await signToken("anna", SIGNING_KEY);
  assert.equal((await requireUser(asRequest(`Bearer ${token}`), env)).user, "anna");
  const other = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const refused = [
    `Bearer ${(await signToken("anna", other)).token}`,
    `Bearer ${token.slice(0, -3)}AAA`,
    `Bearer ${(await signToken("anna", SIGNING_KEY, Date.now() - 13 * 3600_000)).token}`,
    token,
    "Bearer ",
    "Basic abc",
    "",
  ];
  for (const header of refused) assert.equal(await requireUser(asRequest(header), env), null, header);
  assert.equal(await requireUser(asRequest(`Bearer ${token}`), env, Date.now() + 13 * 3600_000), null);
});
