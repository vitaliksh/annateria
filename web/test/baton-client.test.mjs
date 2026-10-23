import test from "node:test";
import assert from "node:assert/strict";
import { DEVICE_KEY, createBatonClient, deviceId, displayName } from "../baton-client.js";

const API = "https://worker.test";
const loggedIn = { authHeaders: () => ({ Authorization: "Bearer t" }) };
const loggedOut = { authHeaders: () => null };

function fakeFetch(respond) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { calls, fetchImpl };
}

test("beat and release send the device, the name, the snapshot and force with the token; get is a GET", async () => {
  const { calls, fetchImpl } = fakeFetch(() => Response.json({ ok: true, live: true }));
  const client = createBatonClient({ api: API, access: loggedIn, fetchImpl });
  const beat = await client.beat({ device: "dev-12345678", deviceName: "אנה", snapshot: "snap-x.bin", force: true });
  assert.deepEqual(beat, { ok: true, data: { ok: true, live: true } });
  assert.equal(calls[0].url, `${API}/v1/baton/beat`);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer t");
  assert.deepEqual(JSON.parse(calls[0].init.body), { device: "dev-12345678", deviceName: "אנה", snapshot: "snap-x.bin", force: true });
  await client.release({ device: "dev-12345678" });
  assert.equal(calls[1].url, `${API}/v1/baton/release`);
  await client.get();
  assert.deepEqual([calls[2].url, calls[2].init.method, calls[2].init.body], [`${API}/v1/baton`, "GET", undefined]);
});

test("without a token or a Worker nothing is sent", async () => {
  const { calls, fetchImpl } = fakeFetch(() => Response.json({}));
  assert.equal((await createBatonClient({ api: API, access: loggedOut, fetchImpl }).get()).reason, "login");
  assert.equal((await createBatonClient({ api: "", access: loggedIn, fetchImpl }).get()).reason, "unavailable");
  assert.equal(calls.length, 0);
});

test("answers: taken and not-holder keep the data, 401 is login, a dead network and 503 are told apart", async () => {
  const answers = [
    () => Response.json({ code: "taken", live: true, holder: { deviceName: "ויטליק" } }, { status: 409 }),
    () => Response.json({ code: "not-holder", live: false }, { status: 409 }),
    () => Response.json({ error: "Login required." }, { status: 401 }),
    () => { throw new TypeError("Failed to fetch"); },
    () => Response.json({ error: "x" }, { status: 503 }),
  ];
  const { fetchImpl } = fakeFetch(() => answers.shift()());
  const client = createBatonClient({ api: API, access: loggedIn, fetchImpl });
  const taken = await client.beat({ device: "d-12345678", deviceName: "x" });
  assert.deepEqual([taken.ok, taken.reason, taken.data.holder.deviceName], [false, "taken", "ויטליק"]);
  assert.equal((await client.release({ device: "d-12345678" })).reason, "not-holder");
  assert.equal((await client.get()).reason, "login");
  assert.equal((await client.get()).reason, "network");
  assert.equal((await client.get()).reason, "unavailable");
});

test("the device id is made once and kept; a damaged one is replaced", async () => {
  const stored = new Map();
  const store = { readSetting: async (key) => stored.get(key), writeSetting: async (key, value) => { stored.set(key, value); } };
  const first = await deviceId({ ...store, random: () => "AAAA1111-2222-3333-4444-555566667777" });
  assert.equal(first, "aaaa1111-2222-3333-4444-555566667777");
  assert.equal(await deviceId({ ...store, random: () => "other-id-0000" }), first);
  stored.set(DEVICE_KEY, "bad id");
  assert.equal(await deviceId({ ...store, random: () => "fresh-id-0000" }), "fresh-id-0000");
  const broken = { readSetting: async () => { throw new Error("no IndexedDB"); }, writeSetting: async () => { throw new Error("no"); } };
  assert.equal(await deviceId({ ...broken, random: () => "memory-id-0000" }), "memory-id-0000");
});

test("names: the people by name, anybody else by the user id", () => {
  assert.equal(displayName("anna"), "אנה");
  assert.equal(displayName("vitalik"), "ויטליק");
  assert.equal(displayName("guest"), "guest");
  assert.equal(displayName(null), "מחשב");
});
