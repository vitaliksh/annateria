import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { BEAT_MS, IDLE_MS, POLL_MS, setupBaton } from "../baton-ui.js";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const TTL = 3 * 60 * 1000;

// The Worker's rules in a few lines (worker/src/baton.js): live = not released and a beat less than 3 minutes ago.
function fakeServer(clock) {
  const server = { holder: null, snapshot: null, down: null, calls: [] };
  const view = () => ({
    live: Boolean(server.holder && !server.holder.released && clock.ms - server.holder.lastBeat < TTL),
    holder: server.holder,
    snapshot: server.snapshot,
  });
  server.client = {
    async beat(body) {
      server.calls.push({ action: "beat", ...body });
      if (server.down) return { ok: false, reason: server.down };
      const own = server.holder?.device === body.device && !server.holder.released;
      if (!own && view().live && !body.force) return { ok: false, reason: "taken", data: view() };
      server.holder = { device: body.device, deviceName: body.deviceName, user: body.user ?? null, lastBeat: clock.ms, released: false };
      if (body.snapshot) server.snapshot = { name: body.snapshot, at: clock.ms };
      return { ok: true, data: view() };
    },
    async release(body) {
      server.calls.push({ action: "release", ...body });
      if (server.holder?.device !== body.device) return { ok: false, reason: "not-holder", data: view() };
      server.holder = { ...server.holder, released: true };
      if (body.snapshot) server.snapshot = { name: body.snapshot, at: clock.ms };
      return { ok: true, data: view() };
    },
  };
  // Another device takes the baton (or keeps it alive).
  server.other = (deviceName = "ויטליק", user = "vitalik") => {
    server.holder = { device: "other-device-1", deviceName, user, lastBeat: clock.ms, released: false };
  };
  return server;
}

function manualTimers() {
  const pending = new Map();
  let next = 1;
  return {
    pending,
    setTimeout: (fn, ms) => { pending.set(next, { fn, ms }); return next++; },
    clearTimeout: (id) => { pending.delete(id); },
    waits: () => [...pending.values()].map((timer) => timer.ms),
    async fire() {
      const due = [...pending];
      pending.clear();
      for (const [, timer] of due) await timer.fn();
    },
  };
}

async function setup({ user = "anna", answer = true } = {}) {
  const { window } = new JSDOM(html, { url: "https://vitaliksh.github.io/annateria/", pretendToBeVisual: true });
  const document = window.document;
  const plate = document.querySelector("#baton-status");
  const clock = { ms: Date.UTC(2026, 9, 23, 7, 0, 0) };
  const server = fakeServer(clock);
  const timers = manualTimers();
  const changes = [];
  const asked = [];
  const pushes = [];
  let logins = 0;
  const baton = setupBaton({
    plate,
    client: {
      beat: (body) => server.client.beat({ ...body, user }),
      release: (body) => server.client.release(body),
    },
    getDevice: async () => ({ device: "this-device-1", user }),
    pushNow: async () => { pushes.push(clock.ms); return "snap-20261023T070000Z-abc.bin"; },
    ensureLoggedIn: async () => { logins += 1; return user; },
    onChange: (state) => changes.push(state),
    confirm: async (message) => { asked.push(message); return answer; },
    timers,
    now: () => clock.ms,
    activityTarget: document,
  });
  const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 2)); };
  const click = async (target) => { target.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); await settle(); };
  const key = async () => { document.body.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true })); await settle(); };
  const move = async () => { document.body.dispatchEvent(new window.Event("pointermove", { bubbles: true })); await settle(); };
  return { window, document, plate, clock, server, timers, changes, asked, pushes, baton, click, key, move, settle, logins: () => logins };
}

test("a free baton is taken: green plate, a beat every minute, the table stays editable", async () => {
  const { plate, baton, timers, changes, server, clock } = await setup();
  assert.equal(plate.dataset.state, "unknown");
  await baton.check();
  assert.deepEqual([plate.dataset.state, plate.textContent], ["here", "עובדים כאן"]);
  assert.deepEqual(changes, ["here"]);
  assert.deepEqual([baton.blocksEditing(), baton.canPush()], [false, true]);
  assert.deepEqual(timers.waits(), [BEAT_MS]);
  clock.ms += BEAT_MS;
  await timers.fire();
  assert.equal(server.calls.filter((call) => call.action === "beat").length, 2);
  assert.equal(server.holder.lastBeat, clock.ms);
});

test("another device works: red plate with its name, the table read only, no copy; it turns green by itself", async () => {
  const { plate, baton, timers, server, clock, changes } = await setup();
  server.other();
  await baton.check();
  assert.deepEqual([plate.dataset.state, plate.textContent], ["other", "פתוח אצל ויטליק"]);
  assert.match(plate.title, /לקריאה בלבד/);
  assert.deepEqual([baton.blocksEditing(), baton.canPush()], [true, false]);
  assert.deepEqual(timers.waits(), [POLL_MS]);
  clock.ms += TTL;
  await timers.fire();
  assert.equal(plate.dataset.state, "here");
  assert.deepEqual(changes, ["other", "here"]);
});

test("the same person on another device: the plate says another computer", async () => {
  const { plate, baton, server } = await setup({ user: "vitalik" });
  server.other("ויטליק", "vitalik");
  await baton.check();
  assert.equal(plate.textContent, "פתוח במחשב אחר");
});

test("ten minutes without a click or a key: the last copy goes, the baton is given back, a key takes it again", async () => {
  const { plate, baton, timers, server, clock, pushes, key, move } = await setup();
  await baton.check();
  clock.ms += IDLE_MS - BEAT_MS;
  await move();
  clock.ms += BEAT_MS;
  await timers.fire();
  assert.equal(plate.dataset.state, "here");
  clock.ms += IDLE_MS;
  await timers.fire();
  assert.equal(plate.dataset.state, "paused");
  assert.equal(pushes.length, 1);
  const release = server.calls.find((call) => call.action === "release");
  assert.equal(release.snapshot, "snap-20261023T070000Z-abc.bin");
  assert.deepEqual(timers.waits(), []);
  assert.equal(baton.blocksEditing(), false);
  await move();
  assert.equal(plate.dataset.state, "paused");
  await key();
  assert.equal(plate.dataset.state, "here");
});

test("while paused the other device may start; a key then shows the red plate", async () => {
  const { plate, baton, server, key } = await setup();
  await baton.check();
  await baton.pause();
  server.other();
  await key();
  assert.equal(plate.dataset.state, "other");
});

test("a click on the green plate asks and finishes the work; no answer, no change", async () => {
  const yes = await setup();
  await yes.baton.check();
  await yes.click(yes.plate);
  assert.match(yes.asked[0], /לסיים את העבודה/);
  assert.equal(yes.plate.dataset.state, "paused");
  assert.equal(yes.server.holder.released, true);
  const no = await setup({ answer: false });
  await no.baton.check();
  await no.click(no.plate);
  assert.equal(no.plate.dataset.state, "here");
});

test("a click on the red plate asks and starts anyway", async () => {
  const { plate, baton, server, click, asked } = await setup();
  server.other();
  await baton.check();
  await click(plate);
  assert.match(asked[0], /אצל ויטליק/);
  assert.equal(plate.dataset.state, "here");
  assert.equal(server.calls.at(-1).force, true);
});

test("no connection or no code: grey plate, work allowed, retried; a click asks for the code first", async () => {
  const { plate, baton, server, timers, click, logins } = await setup();
  server.down = "network";
  await baton.check();
  assert.deepEqual([plate.dataset.state, plate.textContent, baton.blocksEditing()], ["unknown", "לא נבדק", false]);
  assert.match(plate.title, /אין חיבור/);
  assert.deepEqual(timers.waits(), [POLL_MS]);
  server.down = "login";
  await baton.check();
  assert.match(plate.title, /קוד גישה/);
  server.down = null;
  await click(plate);
  assert.equal(logins(), 1);
  assert.equal(plate.dataset.state, "here");
});

test("a new snapshot is reported with a beat; the tab coming back asks again", async () => {
  const { baton, server, document, window, settle } = await setup();
  await baton.check();
  await baton.reportPushed("snap-20261023T071000Z-def.bin");
  assert.equal(server.snapshot.name, "snap-20261023T071000Z-def.bin");
  const before = server.calls.length;
  document.dispatchEvent(new window.Event("visibilitychange"));
  await settle();
  assert.equal(server.calls.length, before + 1);
});
