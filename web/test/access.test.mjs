import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createAccess, cleanCode } from "../access.js";
import { ACCESS_MESSAGES, lockedMessage, setupAccess } from "../access-ui.js";

const API = "https://worker.test";
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const dialogHtml = html.slice(html.indexOf('<dialog id="access-dialog"'), html.indexOf("</dialog>", html.indexOf('<dialog id="access-dialog"')) + 9);
const T0 = Date.UTC(2026, 10, 1, 8, 0, 0);

function reply(status, body, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: (name) => headers[name.toLowerCase()] ?? null }, json: async () => body };
}

function setup({ answers = [], now = () => T0 } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${dialogHtml}</body>`, { url: "https://vitaliksh.github.io/annateria/" });
  const { window } = dom;
  const dialog = window.document.querySelector("#access-dialog");
  // The real browser sends "close" a moment after close(); jsdom has no dialog support, so the worst case is used: at once.
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new window.Event("close")); };
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return answers.shift() ?? reply(503, {});
  };
  const ui = setupAccess({ dialog, api: API, access: createAccess({ api: API, fetchImpl, now }) });
  const type = async (code) => {
    window.document.querySelector("#access-code").value = code;
    window.document.querySelector("#access-submit").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { window, dialog, ui, calls, type, error: () => dialog.querySelector("#access-error").textContent };
}

test("the dialog markup has the fields the script needs", () => {
  const { dialog } = setup();
  for (const id of ["#access-code", "#access-error", "#access-submit"]) assert.ok(dialog.querySelector(id), id);
  assert.equal(dialog.querySelector("#access-error").getAttribute("role"), "alert");
});

test("the code is cleaned before it is sent: case, spaces and dashes", () => {
  assert.equal(cleanCode(" k7m-2qx "), "K7M2QX");
});

test("a right code logs in; the token is kept in memory only and sent as a Bearer header", async () => {
  const { window, dialog, ui, calls, type } = setup({ answers: [reply(200, { token: "v1.a.b", user: "anna", expiresAt: T0 + 3600_000 })] });
  const user = ui.ensureLoggedIn();
  assert.equal(dialog.open, true);
  await type("k7m-2qx");
  assert.equal(await user, "anna");
  assert.equal(dialog.open, false);
  assert.deepEqual(calls.map((call) => [call.url, call.init.method, JSON.parse(call.init.body)]), [[`${API}/v1/auth`, "POST", { code: "K7M2QX" }]]);
  assert.deepEqual(ui.access.authHeaders(), { Authorization: "Bearer v1.a.b" });
  assert.equal(ui.access.user(), "anna");
  assert.equal(window.localStorage.length + window.sessionStorage.length, 0);
  assert.equal(window.document.cookie, "");
  assert.equal(window.document.querySelector("#access-code").value, "");
});

test("a reload asks for the code again: a new page has no token, and the dialog opens", async () => {
  const first = setup({ answers: [reply(200, { token: "v1.a.b", user: "anna", expiresAt: T0 + 3600_000 })] });
  const login = first.ui.ensureLoggedIn();
  await first.type("K7M2QX");
  await login;
  assert.equal(first.ui.access.isLoggedIn(), true);
  const reloaded = setup();
  assert.equal(reloaded.ui.access.isLoggedIn(), false);
  assert.equal(reloaded.ui.access.authHeaders(), null);
  reloaded.ui.ensureLoggedIn();
  assert.equal(reloaded.dialog.open, true);
});

test("while the token is valid nothing is asked; after it expires the dialog comes back", async () => {
  let clock = T0;
  const { dialog, ui, type } = setup({ now: () => clock, answers: [reply(200, { token: "v1.a.b", user: "anna", expiresAt: T0 + 1000 })] });
  const first = ui.ensureLoggedIn();
  await type("K7M2QX");
  await first;
  assert.equal(await ui.ensureLoggedIn(), "anna");
  assert.equal(dialog.open, false);
  clock = T0 + 1000;
  assert.equal(ui.access.isLoggedIn(), false);
  assert.equal(ui.access.authHeaders(), null);
  ui.ensureLoggedIn();
  assert.equal(dialog.open, true);
});

test("each failure has its own message in Hebrew and the dialog stays open", async () => {
  const cases = [
    [reply(401, { error: "Wrong code." }), ACCESS_MESSAGES.wrong],
    [reply(429, { retryAfterSeconds: 900 }, { "retry-after": "900" }), lockedMessage(900)],
    [reply(503, { error: "Login is not available." }), ACCESS_MESSAGES.unavailable],
    [reply(400, { error: "Invalid code format." }), ACCESS_MESSAGES.format],
  ];
  for (const [answer, message] of cases) {
    const { dialog, ui, type, error } = setup({ answers: [answer] });
    ui.ensureLoggedIn();
    await type("K7M2QX");
    assert.equal(error(), message);
    assert.equal(dialog.open, true);
    assert.equal(ui.access.isLoggedIn(), false);
  }
  assert.match(lockedMessage(900), /15 דקות/);
  assert.match(lockedMessage(30), /1 דקות/);
});

test("a network failure is reported, and a too short code is refused without calling the Worker", async () => {
  const access = createAccess({ api: API, fetchImpl: async () => { throw new TypeError("offline"); } });
  assert.deepEqual(await access.login("K7M2QX"), { ok: false, reason: "network" });
  const { ui, calls, type, error } = setup();
  ui.ensureLoggedIn();
  await type("K7M");
  assert.equal(error(), ACCESS_MESSAGES.format);
  assert.equal(calls.length, 0);
  assert.deepEqual(await createAccess({ api: "" }).login("K7M2QX"), { ok: false, reason: "unavailable" });
});

test("closing the dialog gives null (the journal works without the assistant); two askers share one dialog", async () => {
  const { dialog, ui, window } = setup();
  const first = ui.ensureLoggedIn();
  const second = ui.ensureLoggedIn();
  dialog.close();
  assert.deepEqual([await first, await second], [null, null]);
  assert.equal(window.document.querySelectorAll("#access-dialog").length, 1);
});

test("Enter in the field submits, and the code is not echoed anywhere in the page", async () => {
  const { window, dialog, ui, calls } = setup({ answers: [reply(200, { token: "t", user: "vitalik", expiresAt: T0 + 5000 })] });
  const login = ui.ensureLoggedIn();
  const input = window.document.querySelector("#access-code");
  input.value = "K7M2QX";
  input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(await login, "vitalik");
  assert.equal(calls.length, 1);
  assert.ok(!window.document.body.textContent.includes("K7M2QX"));
  assert.equal(dialog.open, false);
});
