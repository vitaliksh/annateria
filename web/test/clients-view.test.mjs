import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { archivedDeclarationCount, clientSummary, declarationGroups, filterClients, renderClientCard, renderClientsHome } from "../clients-view.js";

const declaration = (month, status = "open", archived = false) => ({ declaration: { declarationId: `d-${month}`, month, status, archived } });
const client = (name, declarations = [], extra = {}) => ({ id: name, clientName: name, config: { businessActivity: `${name} activity`, businessKind: "office", ...extra }, declarations });
const root = () => new JSDOM("<main></main>").window.document.querySelector("main");
const buttonByText = (container, label) => [...container.querySelectorAll("button")].find((node) => node.textContent === label);

test("clientSummary counts open and locked declarations and finds the last month, ignoring archived ones", () => {
  const summary = clientSummary(client("A", [declaration("2026-01", "closed"), declaration("2026-03"), declaration("2026-04", "open", true), declaration("2025-12", "closed")]));
  assert.deepEqual([summary.open, summary.locked, summary.last], [1, 2, "2026-03"]);
  assert.equal(clientSummary(client("B")).last, null);
});

test("filterClients searches name and activity case-insensitively", () => {
  const clients = [client("Alpha", [], { businessActivity: "Plumbing" }), client("Beta", [], { businessActivity: "Design" })];
  assert.deepEqual(filterClients(clients, "plumb").map((item) => item.id), ["Alpha"]);
  assert.deepEqual(filterClients(clients, "BE").map((item) => item.id), ["Beta"]);
  assert.equal(filterClients(clients, "  ").length, 2);
});

test("declarationGroups groups by year, newest first, and separates archived declarations", () => {
  const item = client("A", [declaration("2025-11"), declaration("2026-02"), declaration("2026-05"), declaration("2026-01", "open", true)]);
  assert.deepEqual(declarationGroups(item).map((group) => [group.year, group.declarations.map((d) => d.month)]), [["2026", ["2026-05", "2026-02"]], ["2025", ["2025-11"]]]);
  assert.deepEqual(declarationGroups(item, { archived: true })[0].declarations.map((d) => d.month), ["2026-01"]);
  assert.equal(archivedDeclarationCount(item), 1);
});

test("the clients home shows a table, opens a client by its name and reports search input", () => {
  const container = root(), calls = [];
  const handlers = { onOpen: (id) => calls.push(["open", id]), onNew: () => calls.push(["new"]), onSearch: (value) => calls.push(["search", value]), onToggleArchived: () => calls.push(["archive"]), onChooseRoot: () => {} };
  renderClientsHome(container, { clients: [client("Alpha", [declaration("2026-03")]), client("Beta")], archivedCount: 2, showingArchived: false, query: "", hasRoot: true }, handlers);
  const rows = [...container.querySelectorAll("tbody tr")];
  assert.equal(rows.length, 2);
  assert.deepEqual([...rows[0].cells].map((cell) => cell.textContent), ["Alpha", "Alpha activity", "03/2026", "1", "0"]);
  assert.equal(rows[1].cells[2].textContent, "—");
  rows[0].querySelector("button").click();
  container.querySelector("#clients-search").dispatchEvent(new container.ownerDocument.defaultView.Event("input"));
  buttonByText(container, "ארכיון (2)").click();
  buttonByText(container, "+ לקוח חדש").click();
  assert.deepEqual(calls, [["open", "Alpha"], ["search", ""], ["archive"], ["new"]]);
});

test("the clients home explains an empty state: no data root, no clients, no search result", () => {
  const container = root(), handlers = { onOpen() {}, onNew() {}, onSearch() {}, onToggleArchived() {}, onChooseRoot() {} };
  renderClientsHome(container, { clients: [], archivedCount: 0, showingArchived: false, query: "", hasRoot: false }, handlers);
  assert.match(container.textContent, /לא נבחרה תיקיית נתונים/);
  assert.equal(buttonByText(container, "+ לקוח חדש"), undefined);
  renderClientsHome(container, { clients: [], archivedCount: 0, showingArchived: false, query: "", hasRoot: true }, handlers);
  assert.match(container.textContent, /אין לקוחות בתיקייה זו/);
  renderClientsHome(container, { clients: [], archivedCount: 0, showingArchived: false, query: "zzz", hasRoot: true }, handlers);
  assert.match(container.textContent, /לא נמצאו לקוחות/);
});

test("the client card shows the facts, declaration cards with badges, and lazy row counts", async () => {
  const container = root(), calls = [];
  const item = client("Alpha", [declaration("2026-03", "closed"), declaration("2026-02"), declaration("2025-12")]);
  renderClientCard(container, { client: item, settings: { vatPeriod: "bimonthly", advancePercent: 12 }, showingArchived: false }, {
    onOpenDeclaration: (month) => calls.push(["open", month]), onNewDeclaration: () => calls.push(["new"]), onEdit: () => calls.push(["edit"]), onToggleArchived() {},
    countRows: async (month) => (month === "2026-02" ? 7 : Promise.reject(new Error("unreadable"))),
  });
  assert.match(container.querySelector(".facts").textContent, /דו‑חודשי/);
  assert.match(container.querySelector(".facts").textContent, /12%/);
  const cards = [...container.querySelectorAll(".declaration-card")];
  assert.deepEqual(cards.map((card) => card.querySelector("strong").textContent), ["03/2026", "02/2026", "12/2025"]);
  assert.deepEqual(cards.map((card) => card.querySelector(".badge").textContent), ["נעולה", "פתוחה", "פתוחה"]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(cards.map((card) => card.querySelector(".muted").textContent), ["—", "7 שורות", "—"]);
  cards[1].click();
  buttonByText(container, "+ הצהרה חדשה").click();
  buttonByText(container, "עריכת פרטי לקוח").click();
  assert.deepEqual(calls, [["open", "2026-02"], ["new"], ["edit"]]);
});

test("an archived client cannot get a new declaration or open one", () => {
  const container = root();
  renderClientCard(container, { client: client("Old", [declaration("2026-01")], { archived: true }), settings: null, showingArchived: false }, { onOpenDeclaration() {}, onNewDeclaration() {}, onEdit() {}, onToggleArchived() {} });
  assert.equal(container.querySelector(".declaration-card").disabled, true);
  assert.equal(buttonByText(container, "+ הצהרה חדשה").disabled, true);
  assert.match(container.textContent, /בארכיון/);
});

test("each declaration card has an export button for that month", () => {
  const container = root();
  const exported = [];
  renderClientCard(container, { client: client("A", [declaration("2026-02"), declaration("2026-01", "closed")]), settings: null, showingArchived: false }, {
    onOpenDeclaration() {}, onNewDeclaration() {}, onEdit() {}, onToggleArchived() {}, onExport: (month) => exported.push(month),
  });
  const buttons = [...container.querySelectorAll("button")].filter((node) => node.textContent === "ייצוא");
  assert.equal(buttons.length, 2);
  buttons.forEach((node) => node.click());
  assert.deepEqual(exported, ["2026-02", "2026-01"]);
});

test("the client card shows the VAT and the advances period separately, from the client properties first", () => {
  const container = root();
  const item = client("Alpha", [declaration("2026-02")], { vatPeriod: "bimonthly", advancesPeriod: "monthly" });
  renderClientCard(container, { client: item, settings: { vatPeriod: "monthly", advancePercent: 12 }, showingArchived: false }, { onOpenDeclaration() {}, onNewDeclaration() {}, onEdit() {}, onToggleArchived() {} });
  const facts = [...container.querySelectorAll(".fact")].map((fact) => fact.textContent);
  assert.ok(facts.some((fact) => /דיווח מע״מ.*דו‑חודשי/.test(fact)), facts.join("|"));
  assert.ok(facts.some((fact) => /דיווח מקדמות.*חד‑חודשי/.test(fact)), facts.join("|"));
});

test("the client card shows the tax profile; a client without one shows dashes and no PCN duty", () => {
  const container = root();
  const handlers = { onOpenDeclaration() {}, onNewDeclaration() {}, onEdit() {}, onToggleArchived() {}, countRows: async () => 0 };
  const withProfile = client("Alpha", [declaration("2026-03")]);
  const profile = { vatId: "123456782", incomeTaxFileId: "987654321", address: "Herzl 1", pcnRequired: true };
  withProfile.config = { ...withProfile.config, ...profile };
  renderClientCard(container, { client: withProfile, settings: null, showingArchived: false }, handlers);
  const facts = () => [...container.querySelectorAll(".fact")].map((fact) => fact.textContent);
  assert.ok(facts().some((fact) => /מספר עוסק מורשה.*123456782/.test(fact)), facts().join("|"));
  assert.ok(facts().some((fact) => /כתובת העסק.*Herzl 1/.test(fact)), facts().join("|"));
  assert.ok(facts().some((fact) => /מספר מס הכנסה.*987654321/.test(fact)), facts().join("|"));
  assert.ok(facts().some((fact) => /קובץ PCN.*חובה/.test(fact)), facts().join("|"));
  renderClientCard(container, { client: client("Beta", [declaration("2026-03")]), settings: null, showingArchived: false }, handlers);
  assert.ok(facts().some((fact) => /מספר עוסק מורשה.*—/.test(fact)), facts().join("|"));
  assert.ok(facts().some((fact) => /כתובת העסק.*—/.test(fact)), facts().join("|"));
  assert.ok(facts().some((fact) => /קובץ PCN.*לא נדרש/.test(fact)), facts().join("|"));
});
