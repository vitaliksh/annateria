import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";
import { base64url, signToken } from "../src/access.js";
import { Baton } from "../src/baton.js";

const ORIGIN = "https://vitaliksh.github.io";
const SIGNING_KEY = base64url(crypto.getRandomValues(new Uint8Array(32)));
const ANNA = { device: "anna-pc-0001", deviceName: "ANNA-PC" };

function memoryStorage() {
  const values = new Map();
  return {
    async get(key) {
      return structuredClone(values.get(key));
    },
    async put(key, value) {
      values.set(key, structuredClone(value));
    },
  };
}
// A namespace with one real Baton behind it; `calls` records what the Worker forwarded.
function batonNamespace({ broken = false } = {}) {
  const baton = new Baton({ storage: memoryStorage() });
  const calls = [];
  return {
    calls,
    idFromName: (name) => name,
    get: () => ({
      fetch: async (url, init) => {
        if (broken) throw Object.assign(new Error("unreachable"), { name: "TypeError" });
        calls.push({ url, body: JSON.parse(init.body) });
        return baton.fetch(new Request(url, init));
      },
    }),
  };
}
const env = (overrides = {}) => ({ ALLOWED_ORIGINS: ORIGIN, TOKEN_SIGNING_KEY: SIGNING_KEY, BATON: batonNamespace(), ...overrides });
const bearer = async (user = "anna") => `Bearer ${(await signToken(user, SIGNING_KEY)).token}`;
async function send(path, { body, method = body === undefined ? "GET" : "POST", authorization, origin = ORIGIN, environment } = {}) {
  const headers = { ...(origin ? { origin } : {}), authorization: authorization === undefined ? await bearer() : authorization };
  const request = new Request(`https://worker.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const response = await worker.fetch(request, environment ?? env());
  return { status: response.status, headers: response.headers, body: await response.json() };
}

test("a logged-in device takes the baton, and anybody logged in can see who works", async () => {
  const environment = env();
  const taken = await send("/v1/baton/beat", { body: ANNA, environment });
  assert.equal(taken.status, 200);
  assert.equal(taken.headers.get("access-control-allow-origin"), ORIGIN);
  assert.deepEqual([taken.body.took, taken.body.holder.deviceName, taken.body.holder.user], [true, "ANNA-PC", "anna"]);
  const seen = await send("/v1/baton", { authorization: await bearer("vitalik"), environment });
  assert.deepEqual([seen.status, seen.body.live, seen.body.holder.device], [200, true, ANNA.device]);
  const other = await send("/v1/baton/beat", {
    body: { device: "vitalik-pc-0002", deviceName: "VITALIK-PC" },
    authorization: await bearer("vitalik"),
    environment,
  });
  assert.deepEqual([other.status, other.body.code], [409, "taken"]);
});

test("the user comes from the token and the time from the Worker, never from the body", async () => {
  const environment = env();
  const before = Date.now();
  const taken = await send("/v1/baton/beat", { body: { ...ANNA, user: "vitalik", now: 0 }, environment });
  assert.equal(taken.body.holder.user, "anna");
  assert.ok(taken.body.holder.since >= before);
  assert.deepEqual(Object.keys(environment.BATON.calls[0].body).sort(), ["device", "deviceName", "user"]);
});

test("release goes through to the record", async () => {
  const environment = env();
  await send("/v1/baton/beat", { body: ANNA, environment });
  const snapshot = "snap-20261023T070100Z-a1b2c3.bin";
  const released = await send("/v1/baton/release", { body: { device: ANNA.device, snapshot }, environment });
  assert.deepEqual([released.status, released.body.live, released.body.snapshot.name], [200, false, snapshot]);
});

test("no token, a forged token, a foreign origin and a wrong method are refused before the record", async () => {
  const environment = env();
  assert.equal((await send("/v1/baton", { authorization: "", environment })).status, 401);
  assert.equal((await send("/v1/baton/beat", { body: ANNA, authorization: "Bearer v1.forged.token", environment })).status, 401);
  assert.equal((await send("/v1/baton", { origin: "https://evil.example", environment })).status, 403);
  assert.equal((await send("/v1/baton", { method: "POST", body: ANNA, environment })).status, 405);
  assert.equal((await send("/v1/baton/beat", { method: "GET", environment })).status, 405);
  assert.equal(environment.BATON.calls.length, 0);
});

test("a big or broken body, a missing binding and an unreachable record give clear errors", async () => {
  assert.equal((await send("/v1/baton/beat", { body: { ...ANNA, deviceName: "x".repeat(2000) } })).status, 413);
  assert.equal((await send("/v1/baton/beat", { body: "{not json" })).status, 400);
  assert.equal((await send("/v1/baton", { environment: env({ BATON: undefined }) })).status, 503);
  assert.equal((await send("/v1/baton", { environment: env({ BATON: batonNamespace({ broken: true }) }) })).status, 503);
});

test("the store id goes through to the record", async () => {
  const environment = env();
  await send("/v1/baton/beat", { body: ANNA, environment });
  const snapshot = "snap-20261023T070100Z-a1b2c3.bin";
  const pushed = await send("/v1/baton/beat", { body: { ...ANNA, snapshot, store: "0123456789abcdef" }, environment });
  assert.deepEqual([pushed.status, pushed.body.snapshot.store], [200, "0123456789abcdef"]);
});
