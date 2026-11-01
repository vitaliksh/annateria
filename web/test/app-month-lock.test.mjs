// Step 9.3 in the page: a month is open only while the user is in it. The start closes every open month (the migration), leaving the
// month or going to another one closes it, and the lock button closes a month whatever its checks say, showing them in red.
import test from "node:test";
import assert from "node:assert/strict";
import { createDeclaration, loadDeclaration, saveDraft } from "../declaration-store.js";
import { MONTH_LOCK_FILE } from "../month-lock.js";
import { loadApp } from "./app-harness.mjs";
import { binaryDirectory } from "./memory-binary-directory.mjs";

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const config = { clientId: "c1", clientName: "Client", businessActivity: "x", businessKind: "office" };

// A data root with one client and open months; rows: the rows of each month.
async function dataRoot(months, rows = [{ active: true, values: ["01/02/26"] }]) {
  const root = binaryDirectory("root");
  const client = await (await root.getDirectoryHandle("clients", { create: true })).getDirectoryHandle("client", { create: true });
  for (const month of months) {
    const created = await createDeclaration(client, { clientId: "c1", month });
    await saveDraft(created.directory, created.declaration, rows);
  }
  return { root, client };
}
const statusOf = async (client, month) => (await loadDeclaration(client, month)).declaration.status;
const selectedOf = async (client, month) => ({ workspace: { config, directory: client, parent: {} }, ...(await loadDeclaration(client, month)) });

async function openApp(months, rows) {
  const loaded = await loadApp();
  const { root, client } = await dataRoot(months, rows);
  loaded.window.confirm = () => true;
  await loaded.app.switchDataRoot(root);
  await loaded.app.sweepMonths();
  return { ...loaded, root, client };
}

// Opens a month in the journal and reopens it with the button, as the user does.
async function workIn({ app, document }, client, month) {
  await app.activateDeclaration(await selectedOf(client, month));
  await app.sweepMonths();
  document.querySelector("#reopen-declaration").click();
  await settle();
}

test("the start closes every open month once and records the migration", async () => {
  const { root, client } = await openApp(["2026-01", "2026-02"]);
  assert.deepEqual([await statusOf(client, "2026-01"), await statusOf(client, "2026-02")], ["closed", "closed"]);
  assert.ok(await (await root.getDirectoryHandle("common")).getFileHandle(MONTH_LOCK_FILE));
});

test("a month opened by the user stays open while the journal shows it and is closed when the user goes to the clients", async () => {
  const opened = await openApp(["2026-02"]);
  const { app, document, client } = opened;
  await workIn(opened, client, "2026-02");
  assert.equal(await statusOf(client, "2026-02"), "open");
  await app.sweepMonths();
  assert.equal(await statusOf(client, "2026-02"), "open", "kept while the journal shows it");
  document.querySelector("#breadcrumb button").click(); // "לקוחות"
  await app.sweepMonths();
  assert.equal(await statusOf(client, "2026-02"), "closed");
  assert.equal(document.querySelector("#declaration-badge").textContent, "נעולה", "the page knows the month on screen is closed");
  assert.equal(document.querySelector("#reopen-declaration").hidden, false);
});

test("going to another month closes the month left and keeps the new one", async () => {
  const opened = await openApp(["2026-02", "2026-03"]);
  const { app, client } = opened;
  await workIn(opened, client, "2026-02");
  await workIn(opened, client, "2026-03");
  await app.sweepMonths();
  assert.deepEqual([await statusOf(client, "2026-02"), await statusOf(client, "2026-03")], ["closed", "open"]);
});

test("the lock button closes a month without an active row and says so in red", async () => {
  const opened = await openApp(["2026-02"], [{ active: false, values: ["01/02/26"] }]);
  const { document, client } = opened;
  await workIn(opened, client, "2026-02");
  document.querySelector("#close-declaration").click();
  await settle();
  assert.equal(await statusOf(client, "2026-02"), "closed");
  const status = document.querySelector("#status");
  assert.match(status.textContent, /ההצהרה ננעלה\. ההיסטוריה עודכנה\. אין בהצהרה שורה פעילה\./);
});
