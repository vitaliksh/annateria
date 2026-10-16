import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { DEFAULT_WIDTH, MAX_WIDTH, MIN_WIDTH, SIDEBAR_KEY, clampSidebarWidth, readSidebarState, setupSidebar } from "../sidebar.js";
import { renderSidebarClients } from "../sidebar-clients.js";

test("sidebar width is clamped and bad input falls back to the default", () => {
  assert.equal(clampSidebarWidth(10), MIN_WIDTH);
  assert.equal(clampSidebarWidth(9999), MAX_WIDTH);
  assert.equal(clampSidebarWidth("300.4"), 300);
  assert.equal(clampSidebarWidth("abc"), DEFAULT_WIDTH);
});

test("the stored sidebar state is read defensively", () => {
  assert.deepEqual(readSidebarState('{"collapsed":true,"width":333}'), { collapsed: true, width: 333 });
  assert.deepEqual(readSidebarState('{"collapsed":"yes","width":1}'), { collapsed: false, width: MIN_WIDTH });
  assert.deepEqual(readSidebarState("not json"), { collapsed: false, width: DEFAULT_WIDTH });
  assert.deepEqual(readSidebarState(null), { collapsed: false, width: DEFAULT_WIDTH });
});

function page(stored) {
  const dom = new JSDOM('<div class="app-shell"><aside class="sidebar"></aside><button id="toggle"></button><div id="resizer"></div></div>');
  const { document } = dom.window;
  const store = new Map(stored ? [[SIDEBAR_KEY, stored]] : []);
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  return {
    shell: document.querySelector(".app-shell"),
    sidebar: document.querySelector(".sidebar"),
    toggle: document.querySelector("#toggle"),
    resizer: document.querySelector("#resizer"),
    storage,
    store,
    dom,
  };
}

test("toggle collapses the sidebar, updates aria-expanded and remembers the choice", () => {
  const p = page();
  const sidebar = setupSidebar(p);
  assert.equal(p.shell.dataset.sidebar, "expanded");
  p.toggle.click();
  assert.equal(p.shell.dataset.sidebar, "collapsed");
  assert.equal(p.toggle.getAttribute("aria-expanded"), "false");
  assert.equal(JSON.parse(p.store.get(SIDEBAR_KEY)).collapsed, true);
  p.toggle.click();
  assert.equal(p.shell.dataset.sidebar, "expanded");
  assert.equal(sidebar.getState().collapsed, false);
});

test("the saved state is applied on start and the keyboard resizes within limits", () => {
  const p = page('{"collapsed":false,"width":300}');
  const sidebar = setupSidebar(p);
  assert.equal(p.shell.style.getPropertyValue("--sidebar-w"), "300px");
  const key = (name) => p.resizer.dispatchEvent(new p.dom.window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  // jsdom reports no direction, so ArrowRight widens (left-to-right).
  key("ArrowRight");
  assert.equal(sidebar.getState().width, 316);
  for (let i = 0; i < 30; i += 1) key("ArrowRight");
  assert.equal(sidebar.getState().width, MAX_WIDTH);
  for (let i = 0; i < 40; i += 1) key("ArrowLeft");
  assert.equal(sidebar.getState().width, MIN_WIDTH);
  assert.equal(JSON.parse(p.store.get(SIDEBAR_KEY)).width, MIN_WIDTH);
});

const declaration = (month, status = "open", archived = false) => ({ declaration: { declarationId: `d-${month}`, month, status, archived } });
const client = (name, declarations = [], archived = false) => ({ id: name, clientName: name, config: { archived }, declarations });
const root = () => new JSDOM("<div></div>").window.document.querySelector("div");

test("the sidebar list marks the active client, shows declarations of the expanded one only, newest first", () => {
  const container = root(), calls = [];
  renderSidebarClients(container, {
    clients: [client("Alpha", [declaration("2026-01"), declaration("2026-03", "closed"), declaration("2026-02", "open", true)]), client("Beta", [declaration("2026-05")])],
    archivedMode: false, activeClientId: "Alpha", activeDeclarationId: "d-2026-03", expandedClientId: "Alpha",
  }, { onClient: (c) => calls.push(["client", c.id]), onMenu: (c) => calls.push(["menu", c.id]), onDeclaration: (c, m) => calls.push(["declaration", c.id, m]), onNewDeclaration: (c) => calls.push(["new", c.id]) });
  assert.equal(container.querySelectorAll(".client-item").length, 2);
  assert.equal(container.querySelector(".client-choice.active-client .label").textContent, "Alpha");
  assert.equal(container.querySelectorAll(".declaration-list").length, 1);
  const choices = [...container.querySelectorAll(".declaration-choice")];
  assert.deepEqual(choices.map((c) => c.querySelector(".label").textContent), ["03/2026", "01/2026"]);
  assert.deepEqual(choices.map((c) => c.querySelector(".state-dot").dataset.state), ["locked", "open"]);
  assert.equal(choices[0].classList.contains("active-declaration"), true);
  choices[1].click();
  container.querySelector(".new-declaration").click();
  container.querySelectorAll(".client-overflow")[1].click();
  container.querySelectorAll(".client-choice")[1].click();
  assert.deepEqual(calls, [["declaration", "Alpha", "2026-01"], ["new", "Alpha"], ["menu", "Beta"], ["client", "Beta"]]);
});

test("archived clients get no new-declaration button and an empty list explains itself", () => {
  const container = root(), handlers = { onClient() {}, onMenu() {}, onDeclaration() {}, onNewDeclaration() {} };
  renderSidebarClients(container, { clients: [client("Old", [declaration("2026-01")], true)], archivedMode: true, activeClientId: null, activeDeclarationId: null, expandedClientId: "Old" }, handlers);
  assert.equal(container.querySelector(".new-declaration"), null);
  renderSidebarClients(container, { clients: [], archivedMode: true, activeClientId: null, activeDeclarationId: null, expandedClientId: null }, handlers);
  assert.match(container.textContent, /אין לקוחות בארכיון/);
});
