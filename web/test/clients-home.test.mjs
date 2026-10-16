import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createClientsHome } from "../clients-home.js";

const page = () => new JSDOM(`<body><nav id="breadcrumb"></nav><section id="clients-view"></section><section id="client-view" hidden></section><div id="journal-view" hidden></div>
<button id="nav-clients"></button><button id="show-new-client"></button><button id="select-data-root"></button></body>`).window.document;
const declaration = (month) => ({ declaration: { declarationId: `d-${month}`, month, status: "open", archived: false } });
const clientA = { id: "a", clientName: "Alpha", config: { businessActivity: "x", businessKind: "home" }, directory: {}, declarations: [declaration("2026-03")] };
const controls = (calls) => ({
  getClients: () => ({ active: [clientA], archived: [], activeClientId: null, activeDeclarationId: null, hasRoot: true }),
  openDeclaration: async (id, month) => calls.push(["open", id, month]),
  newDeclaration: async (id) => calls.push(["new", id]),
  editClient: (id) => calls.push(["edit", id]),
});
const crumb = (doc) => [...doc.querySelector("#breadcrumb").children].map((node) => node.textContent);
const visible = (doc) => ["clients-view", "client-view", "journal-view"].filter((id) => !doc.getElementById(id).hidden);

test("the start view is the clients list with a one-item breadcrumb", () => {
  const doc = page(), home = createClientsHome(doc);
  home.bind(controls([]));
  assert.deepEqual(visible(doc), ["clients-view"]);
  assert.equal(doc.body.dataset.view, "clients");
  assert.deepEqual(crumb(doc), ["לקוחות"]);
  assert.equal(doc.querySelectorAll("#clients-view tbody tr").length, 1);
});

test("opening a client shows its card; its declaration opens through the workspace controls", () => {
  const doc = page(), calls = [], home = createClientsHome(doc);
  home.bind(controls(calls));
  doc.querySelector("#clients-view tbody button").click();
  assert.deepEqual(visible(doc), ["client-view"]);
  assert.deepEqual(crumb(doc), ["לקוחות", "›", "Alpha"]);
  doc.querySelector(".declaration-card").click();
  assert.deepEqual(calls, [["open", "a", "2026-03"]]);
});

test("the journal view shows client and month in the breadcrumb and links back to the card and the list", () => {
  const doc = page(), home = createClientsHome(doc);
  home.bind(controls([]));
  home.showJournal({ clientId: "a", month: "2026-03" });
  assert.deepEqual(visible(doc), ["journal-view"]);
  assert.deepEqual(crumb(doc), ["לקוחות", "›", "Alpha", "›", "03/2026"]);
  doc.querySelectorAll("#breadcrumb .crumb-link")[1].click();
  assert.deepEqual(visible(doc), ["client-view"]);
  doc.querySelector("#breadcrumb .crumb-link").click();
  assert.deepEqual(visible(doc), ["clients-view"]);
});

test("a client that disappeared sends the card back to the list", () => {
  const doc = page(), home = createClientsHome(doc);
  let clients = [clientA];
  home.bind({ ...controls([]), getClients: () => ({ active: clients, archived: [], hasRoot: true }) });
  doc.querySelector("#clients-view tbody button").click();
  clients = [];
  home.refresh();
  assert.deepEqual(visible(doc), ["clients-view"]);
});

test("the new-client button of the list triggers the sidebar new-client button", () => {
  const doc = page(), home = createClientsHome(doc);
  let opened = 0;
  doc.querySelector("#show-new-client").addEventListener("click", () => { opened += 1; });
  home.bind(controls([]));
  [...doc.querySelectorAll("#clients-view button")].find((node) => node.textContent === "+ לקוח חדש").click();
  assert.equal(opened, 1);
});

test("the sidebar all-clients item returns to the list and refreshes it from disk", () => {
  const doc = page(), calls = [], home = createClientsHome(doc);
  home.bind({ ...controls(calls), refresh: async () => calls.push(["refresh"]) });
  home.showJournal({ clientId: "a", month: "2026-03" });
  doc.querySelector("#nav-clients").click();
  assert.deepEqual(visible(doc), ["clients-view"]);
  assert.deepEqual(calls, [["refresh"]]);
});

test("a data root that needs permission shows a grant button that refreshes the list", () => {
  const doc = page(), calls = [], home = createClientsHome(doc);
  home.bind({ ...controls(calls), getClients: () => ({ active: [], archived: [], hasRoot: true, needsPermission: true }), refresh: async () => calls.push(["refresh"]) });
  assert.match(doc.querySelector("#clients-view").textContent, /נדרש אישור גישה/);
  [...doc.querySelectorAll("#clients-view button")].find((node) => node.textContent === "אישור גישה").click();
  assert.deepEqual(calls, [["refresh"]]);
});

test("declaration actions of the card go to the workspace controls and errors are reported", async () => {
  const doc = page(), calls = [], errors = [], home = createClientsHome(doc);
  home.bind({ ...controls(calls), setDeclarationArchived: async (...args) => calls.push(["archive", ...args]), deleteDeclaration: async () => { throw new Error("denied"); } }, { onError: (message) => errors.push(message) });
  doc.querySelector("#clients-view tbody button").click();
  [...doc.querySelectorAll("#client-view button")].find((node) => node.textContent === "ארכוב").click();
  [...doc.querySelectorAll("#client-view button")].find((node) => node.textContent === "מחיקה").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, [["archive", "a", "2026-03", true]]);
  assert.match(errors[0], /denied/);
});

const reportsPage = () => new JSDOM(`<body><nav id="breadcrumb"></nav><section id="clients-view"></section><section id="client-view" hidden></section><section id="reports-view" hidden></section><div id="journal-view" hidden></div>
<button id="nav-clients"></button><button id="nav-reports" disabled></button><button id="show-new-client"></button><button id="select-data-root"></button></body>`).window.document;

test("the reports view: breadcrumb, sidebar item and the tiles of the client card", () => {
  const doc = reportsPage(), calls = [], home = createClientsHome(doc);
  home.bind(controls([]), { onOpenReports: (...args) => calls.push(args) });
  assert.equal(doc.querySelector("#nav-reports").disabled, true);
  doc.querySelector("#clients-view tbody button").click();
  assert.equal(doc.querySelector("#nav-reports").disabled, false);
  const tiles = [...doc.querySelectorAll("#client-view .report-tile")];
  assert.deepEqual(tiles.map((tile) => tile.textContent), ["דוח מס ערך מוסף", "דוח מקדמות", "דוח רווח והפסד", "כרטסת קודי מיון"]);
  tiles[2].click();
  doc.querySelector("#nav-reports").click();
  assert.deepEqual(calls, [["a", "profitLoss"], ["a"]]);
  home.showReports({ clientId: "a" });
  assert.equal(doc.body.dataset.view, "reports");
  assert.equal(doc.querySelector("#reports-view").hidden, false);
  assert.equal(doc.querySelector("#client-view").hidden, true);
  assert.deepEqual([...doc.querySelector("#breadcrumb").children].map((node) => node.textContent), ["לקוחות", "›", "Alpha", "›", "דוחות"]);
  doc.querySelectorAll("#breadcrumb .crumb-link")[1].click();
  assert.equal(doc.body.dataset.view, "client");
});
