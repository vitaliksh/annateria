// Step 9.6: a run of the assistant writes only into the month shown in the journal. A bug report of 6 November 2026: the page computed this
// from a name that did not exist, so every run stopped with "view is not defined".
import test from "node:test";
import assert from "node:assert/strict";
import { createDeclaration, loadDeclaration } from "../declaration-store.js";
import { loadApp } from "./app-harness.mjs";
import { binaryDirectory } from "./memory-binary-directory.mjs";

const config = { clientId: "c1", clientName: "Client", businessActivity: "x", businessKind: "office" };

test("the assistant works on the open client and month while the journal is on screen, and only reads anywhere else", async () => {
  const { app, document } = await loadApp();
  document.body.dataset.view = "clients";
  assert.equal(app.assistantScope(), null, "no month is open");
  const client = binaryDirectory("client");
  await createDeclaration(client, { clientId: "c1", month: "2026-10" });
  await app.activateDeclaration({ workspace: { config, directory: client, parent: {} }, ...(await loadDeclaration(client, "2026-10")) });
  document.body.dataset.view = "journal";
  assert.equal(JSON.stringify(app.assistantScope()), JSON.stringify({ clientId: "c1", month: "2026-10" }));
  document.body.dataset.view = "reports";
  assert.equal(app.assistantScope(), null, "another page writes nothing");
});
