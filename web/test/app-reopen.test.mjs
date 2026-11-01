// Step 9.2: the reopen button opens a locked month with one click, no dialog and no reason asked; reopenLog gets a fixed reason
// and the history entries of the month are removed as before.
import test from "node:test";
import assert from "node:assert/strict";
import { createDeclaration, finalizeDeclaration, loadDeclaration, readClosedHistory } from "../declaration-store.js";
import { CLICK_REOPEN_REASON, NO_EXPORT_MARKER } from "../declaration-core.js";
import { loadApp } from "./app-harness.mjs";
import { binaryDirectory } from "./memory-binary-directory.mjs";

async function lockedMonth() {
  const client = binaryDirectory("Client");
  const created = await createDeclaration(client, { clientId: "c1", month: "2026-02" });
  await finalizeDeclaration({
    clientDirectory: client, declarationDirectory: created.directory, declaration: created.declaration,
    finalExport: NO_EXPORT_MARKER, rows: [{ active: true, values: ["01/02/26"] }],
  });
  const loaded = await loadDeclaration(client, "2026-02");
  const config = { clientId: "c1", clientName: "Client", businessActivity: "x", businessKind: "office" };
  const selected = { workspace: { config, directory: client, parent: {} }, declaration: loaded.declaration, directory: loaded.directory, draft: loaded.draft };
  return { client, selected };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

test("the reopen button opens a locked month at once, with no dialog, and logs the fixed reason", async () => {
  const { app, document } = await loadApp();
  const { client, selected } = await lockedMonth();
  assert.equal((await readClosedHistory(client)).length, 1, "the locked month is in the history");
  await app.activateDeclaration(selected);
  const reopen = document.querySelector("#reopen-declaration");
  assert.equal(reopen.hidden, false);
  assert.equal(document.querySelector("#reopen-dialog"), null, "the reason dialog is gone");
  reopen.click();
  await settle();
  assert.equal([...document.querySelectorAll("dialog")].some((dialog) => dialog.open), false, "nothing asks");
  const saved = (await loadDeclaration(client, "2026-02")).declaration;
  assert.equal(saved.status, "open");
  assert.deepEqual(saved.reopenLog.map((entry) => entry.reason), [CLICK_REOPEN_REASON]);
  assert.equal((await readClosedHistory(client)).length, 0, "the history entries of the month are removed");
  assert.equal(reopen.hidden, true);
  assert.equal(document.querySelector("#close-declaration").hidden, false);
});
