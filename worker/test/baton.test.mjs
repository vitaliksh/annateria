import assert from "node:assert/strict";
import test from "node:test";
import { BATON_TTL_MS, Baton, cleanDeviceName } from "../src/baton.js";

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
// One request at a time, as a Durable Object's input gate does (see auth-guard.test.mjs).
function makeBaton() {
  const baton = new Baton({ storage: memoryStorage() });
  const fetchOne = baton.fetch.bind(baton);
  let queue = Promise.resolve();
  baton.fetch = (request) => {
    const result = queue.then(() => fetchOne(request));
    queue = result.catch(() => {});
    return result;
  };
  return baton;
}
const call = async (baton, action, body = {}) => {
  const response = await baton.fetch(new Request(`https://baton/${action}`, { method: "POST", body: JSON.stringify(body) }));
  return { status: response.status, ...(await response.json()) };
};
const T0 = Date.UTC(2026, 9, 23, 7, 0, 0);
const ANNA = { device: "anna-pc-0001", deviceName: "ANNA-PC", user: "anna" };
const VITALIK = { device: "vitalik-pc-0002", deviceName: "VITALIK-PC", user: "vitalik" };
const SNAP = "snap-20261023T070100Z-a1b2c3.bin";

test("a free baton is taken, and its holder keeps it with beats", async () => {
  const baton = makeBaton();
  const empty = await call(baton, "get", { now: T0 });
  assert.deepEqual([empty.live, empty.holder, empty.snapshot], [false, null, null]);
  const taken = await call(baton, "beat", { ...ANNA, now: T0 });
  assert.deepEqual([taken.status, taken.took, taken.live, taken.holder.since], [200, true, true, T0]);
  const kept = await call(baton, "beat", { ...ANNA, now: T0 + 60_000 });
  assert.deepEqual([kept.took, kept.holder.since, kept.holder.lastBeat], [false, T0, T0 + 60_000]);
  const seen = await call(baton, "get", { now: T0 + 61_000 });
  assert.deepEqual([seen.live, seen.holder.deviceName, seen.holder.user], [true, "ANNA-PC", "anna"]);
});

test("another device is refused while the holder is live, and gets the baton after 3 minutes of silence", async () => {
  const baton = makeBaton();
  await call(baton, "beat", { ...ANNA, now: T0 });
  const refused = await call(baton, "beat", { ...VITALIK, now: T0 + BATON_TTL_MS - 1 });
  assert.deepEqual([refused.status, refused.code, refused.holder.device], [409, "taken", ANNA.device]);
  const free = await call(baton, "get", { now: T0 + BATON_TTL_MS });
  assert.equal(free.live, false);
  const taken = await call(baton, "beat", { ...VITALIK, now: T0 + BATON_TTL_MS });
  assert.deepEqual([taken.status, taken.took, taken.forced, taken.previous.device], [200, true, false, ANNA.device]);
  const late = await call(baton, "beat", { ...ANNA, now: T0 + BATON_TTL_MS + 1000 });
  assert.equal(late.status, 409);
});

test("a device that was silent but not replaced keeps its baton and its start time", async () => {
  const baton = makeBaton();
  await call(baton, "beat", { ...ANNA, now: T0 });
  const back = await call(baton, "beat", { ...ANNA, now: T0 + 2 * BATON_TTL_MS });
  assert.deepEqual([back.status, back.took, back.holder.since], [200, false, T0]);
});

test("force takes a live baton and names the device that lost it", async () => {
  const baton = makeBaton();
  await call(baton, "beat", { ...ANNA, now: T0 });
  const forced = await call(baton, "beat", { ...VITALIK, force: true, now: T0 + 1000 });
  assert.deepEqual([forced.status, forced.took, forced.forced, forced.previous.deviceName], [200, true, true, "ANNA-PC"]);
  assert.equal(forced.holder.device, VITALIK.device);
  assert.equal((await call(baton, "beat", { ...ANNA, now: T0 + 2000 })).status, 409);
});

test("release frees the baton at once and keeps the last snapshot; only the holder may release", async () => {
  const baton = makeBaton();
  await call(baton, "beat", { ...ANNA, now: T0 });
  const stranger = await call(baton, "release", { device: VITALIK.device, snapshot: SNAP, now: T0 + 1000 });
  assert.deepEqual([stranger.status, stranger.code, stranger.snapshot], [409, "not-holder", null]);
  const released = await call(baton, "release", { device: ANNA.device, snapshot: SNAP, now: T0 + 2000 });
  assert.deepEqual([released.status, released.live, released.holder.released], [200, false, true]);
  assert.deepEqual(released.snapshot, { name: SNAP, at: T0 + 2000, device: ANNA.device, deviceName: "ANNA-PC" });
  const next = await call(baton, "beat", { ...VITALIK, now: T0 + 3000 });
  assert.deepEqual([next.took, next.forced, next.snapshot.name], [true, false, SNAP]);
  assert.equal((await call(baton, "release", { device: ANNA.device, now: T0 + 4000 })).status, 409);
});

test("a beat may carry the snapshot just pushed; a released device that comes back takes the baton anew", async () => {
  const baton = makeBaton();
  await call(baton, "beat", { ...ANNA, now: T0 });
  const pushed = await call(baton, "beat", { ...ANNA, snapshot: SNAP, now: T0 + 5000 });
  assert.deepEqual([pushed.snapshot.name, pushed.snapshot.at, pushed.snapshot.device], [SNAP, T0 + 5000, ANNA.device]);
  await call(baton, "release", { device: ANNA.device, now: T0 + 6000 });
  const again = await call(baton, "beat", { ...ANNA, now: T0 + 7000 });
  assert.deepEqual([again.took, again.holder.since, again.snapshot.name], [true, T0 + 7000, SNAP]);
});

test("bad device ids, names and snapshot names are refused and change nothing", async () => {
  const baton = makeBaton();
  for (const body of [
    { ...ANNA, device: "short" },
    { ...ANNA, device: "Has Spaces 1234" },
    { ...ANNA, deviceName: "   " },
    { ...ANNA, deviceName: 42 },
    { ...ANNA, snapshot: "../store.json" },
  ]) {
    assert.equal((await call(baton, "beat", { ...body, now: T0 })).status, 400, JSON.stringify(body));
  }
  assert.equal((await call(baton, "get", { now: T0 })).holder, null);
});

test("device names are one clean line of at most 40 characters", () => {
  assert.equal(cleanDeviceName("  ANNA\n-PC\t "), "ANNA -PC");
  assert.equal(cleanDeviceName("x".repeat(60)).length, 40);
  assert.equal(cleanDeviceName(""), null);
  assert.equal(cleanDeviceName(null), null);
});
