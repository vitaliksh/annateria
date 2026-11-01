// Step 9.5 in the page: client → month → the table or the inbox. The month has its own inbox button and a visible reopen button; the
// way in from the sidebar asks for a client and a month first; "check new documents" works on the month shown, opening it first.
import test from "node:test";
import assert from "node:assert/strict";
import { createDeclaration, finalizeDeclaration, loadDeclaration, saveDraft } from "../declaration-store.js";
import { NO_EXPORT_MARKER } from "../declaration-core.js";
import { loadApp } from "./app-harness.mjs";
import { binaryDirectory } from "./memory-binary-directory.mjs";

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const config = { clientId: "c1", clientName: "Client", businessActivity: "x", businessKind: "office" };

async function closedMonth() {
  const client = binaryDirectory("Client");
  const created = await createDeclaration(client, { clientId: "c1", month: "2026-10" });
  const rows = [{ active: true, values: ["01/10/26"] }];
  await saveDraft(created.directory, created.declaration, rows);
  await finalizeDeclaration({ clientDirectory: client, declarationDirectory: created.directory, declaration: created.declaration, finalExport: NO_EXPORT_MARKER, rows });
  return { client, selected: { workspace: { config, directory: client, parent: {} }, ...(await loadDeclaration(client, "2026-10")) } };
}
const feed = (document) => document.querySelector("#assistant-feed").textContent;

test("the month's top bar has its inbox button and the reopen button outside the menu", async () => {
  const { app, document } = await loadApp();
  const inbox = document.querySelector("#open-month-inbox");
  assert.equal(inbox.textContent, "תיבת קלט");
  assert.ok(inbox.classList.contains("journal-only"));
  const reopen = document.querySelector("#reopen-declaration");
  assert.equal(reopen.closest("#more-menu"), null);
  assert.equal(reopen.hidden, true);
  const { selected } = await closedMonth();
  await app.activateDeclaration(selected);
  assert.equal(reopen.hidden, false, "a closed month shows it");
});

test("check new documents without a month shown says to open one, and runs nothing", async () => {
  const { document } = await loadApp();
  document.querySelector("#assistant-process").click();
  await settle();
  assert.match(feed(document), /יש לפתוח חודש של לקוח לפני בדיקת מסמכים\./);
  assert.doesNotMatch(feed(document), /החיבור לשרת/);
});

test("check new documents in a closed month opens the month first, then starts", async () => {
  const { app, document } = await loadApp();
  const { client, selected } = await closedMonth();
  await app.activateDeclaration(selected);
  document.querySelector("#assistant-process").click();
  await settle();
  assert.equal((await loadDeclaration(client, "2026-10")).declaration.status, "open");
  assert.match(feed(document), /החיבור לשרת ה‑AI אינו מוגדר/, "the run itself starts (no Worker in the tests)");
});

test("the sidebar inbox button outside a month asks for a client and a month; with none it says why and opens nothing", async () => {
  const { document } = await loadApp();
  document.querySelector("#open-inbox").click();
  await settle();
  assert.equal(document.querySelector("#inbox-dialog").open, false);
  assert.match(document.querySelector("#status").textContent, /אין עדיין חודשים ללקוחות/);
});
