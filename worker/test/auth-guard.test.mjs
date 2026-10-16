import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthGuard,
  GLOBAL_MAX_ATTEMPTS,
  GLOBAL_WINDOW_MS,
  IP_LOCK_MS,
  IP_MAX_ATTEMPTS,
  IP_WINDOW_MS,
} from "../src/auth-guard.js";

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
// A Durable Object handles one request at a time while it only waits for its own storage (input gate); the test double
// does the same with a queue.
function makeGuard() {
  const guard = new AuthGuard({ storage: memoryStorage() });
  const fetchOne = guard.fetch.bind(guard);
  let queue = Promise.resolve();
  guard.fetch = (request) => {
    const result = queue.then(() => fetchOne(request));
    queue = result.catch(() => {});
    return result;
  };
  return guard;
}
const call = async (guard, action, body) =>
  (await guard.fetch(new Request(`https://guard/${action}`, { method: "POST", body: JSON.stringify(body) }))).json();
const begin = (guard, ipKey, now) => call(guard, "begin", { ipKey, now });
const T0 = Date.UTC(2026, 9, 16, 9, 0, 0);

test("an address may fail five times; the sixth attempt is locked out, even if it would be right", async () => {
  const guard = makeGuard();
  for (let attempt = 1; attempt <= IP_MAX_ATTEMPTS; attempt += 1) assert.equal((await begin(guard, "a", T0 + attempt)).allowed, true);
  const locked = await begin(guard, "a", T0 + 10);
  assert.equal(locked.allowed, false);
  assert.equal(locked.scope, "ip");
  assert.equal(locked.retryAfterSeconds, IP_LOCK_MS / 1000);
  assert.equal((await begin(guard, "a", T0 + 60_000)).allowed, false);
});

test("the lock-out ends after 15 minutes, and another address is not affected by it", async () => {
  const guard = makeGuard();
  for (let attempt = 0; attempt <= IP_MAX_ATTEMPTS; attempt += 1) await begin(guard, "a", T0);
  assert.equal((await begin(guard, "b", T0 + 1000)).allowed, true);
  const early = await begin(guard, "a", T0 + IP_LOCK_MS - 1000);
  assert.equal(early.allowed, false);
  assert.equal(early.retryAfterSeconds, 1);
  assert.equal((await begin(guard, "a", T0 + IP_LOCK_MS + 1)).allowed, true);
});

test("old failures are forgotten after the window, so slow typos never lock anybody out", async () => {
  const guard = makeGuard();
  for (let attempt = 0; attempt < IP_MAX_ATTEMPTS; attempt += 1) await begin(guard, "a", T0);
  assert.equal((await begin(guard, "a", T0 + IP_WINDOW_MS + 1)).allowed, true);
});

test("a correct code clears the failures of that address and gives the attempt back", async () => {
  const guard = makeGuard();
  for (let attempt = 0; attempt < IP_MAX_ATTEMPTS - 1; attempt += 1) await begin(guard, "a", T0 + attempt);
  const last = await begin(guard, "a", T0 + 100);
  await call(guard, "finish", { ipKey: "a", stamp: last.stamp });
  for (let attempt = 0; attempt < IP_MAX_ATTEMPTS; attempt += 1) assert.equal((await begin(guard, "a", T0 + 200 + attempt)).allowed, true);
  assert.equal((await begin(guard, "a", T0 + 300)).allowed, false);
});

test("all addresses together get 20 attempts per hour, then even a new address is locked out", async () => {
  const guard = makeGuard();
  for (let attempt = 0; attempt < GLOBAL_MAX_ATTEMPTS; attempt += 1) assert.equal((await begin(guard, `ip${attempt}`, T0 + attempt)).allowed, true);
  const refused = await begin(guard, "fresh", T0 + 1000);
  assert.equal(refused.allowed, false);
  assert.equal(refused.scope, "global");
  assert.equal(refused.retryAfterSeconds, Math.ceil((T0 + GLOBAL_WINDOW_MS - (T0 + 1000)) / 1000));
  assert.equal((await begin(guard, "fresh", T0 + GLOBAL_WINDOW_MS + 1)).allowed, true);
});

test("a successful login does not use up the global allowance", async () => {
  const guard = makeGuard();
  for (let login = 0; login < 3 * GLOBAL_MAX_ATTEMPTS; login += 1) {
    const started = await begin(guard, `ip${login}`, T0 + login);
    assert.equal(started.allowed, true);
    await call(guard, "finish", { ipKey: `ip${login}`, stamp: started.stamp });
  }
});

test("parallel guesses are counted when they start, before any of them has failed", async () => {
  const guard = makeGuard();
  const started = await Promise.all(Array.from({ length: 12 }, () => begin(guard, "a", T0)));
  assert.equal(started.filter((item) => item.allowed).length, IP_MAX_ATTEMPTS);
});

test("bad requests to the guard are refused", async () => {
  const guard = makeGuard();
  assert.equal((await guard.fetch(new Request("https://guard/begin", { method: "POST", body: JSON.stringify({}) }))).status, 400);
  assert.equal((await guard.fetch(new Request("https://guard/other", { method: "POST", body: JSON.stringify({ ipKey: "a" }) }))).status, 404);
});
