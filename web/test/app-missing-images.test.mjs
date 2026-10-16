import test from "node:test";
import assert from "node:assert/strict";
import { createDeclaration, loadDeclaration, saveDraft } from "../declaration-store.js";
import { binaryDirectory } from "./memory-binary-directory.mjs";
import { loadApp } from "./app-harness.mjs";

// A copy restored without images (the default of the backup) keeps imageFile in the draft table of an open month.
const row = (id, imageFile) => ({
  documentId: id, imageIndex: 1, imageFile, receivedAt: "2026-10-01T10:00:00.000Z",
  values: ["10/09/26", "", "x", "Supplier", "514000001", "1234", "", "118.00", "100.00", "18.00", "100", "100"],
  rawNet: "100", rawVat: "18", vatPercent: 18, reference: "INV-1234", active: true,
  agentOpinion: "—", confidence: "", statusText: "מוכן לייצוא", statusClass: "ready",
});

async function restoredMonth(rows) {
  const client = binaryDirectory("Client");
  const created = await createDeclaration(client, { clientId: "c1", month: "2026-09" });
  await saveDraft(created.directory, created.declaration, rows, "2026-10-11T10:00:00.000Z");
  const loaded = await loadDeclaration(client, "2026-09");
  const config = { clientId: "c1", clientName: "Client", businessActivity: "x", businessKind: "office" };
  return { client, selected: { workspace: { config, directory: client, parent: {} }, declaration: loaded.declaration, directory: loaded.directory, draft: loaded.draft } };
}

test("an open month restored without its images still shows its rows, without photos", async () => {
  const { app, rows } = await loadApp();
  const { selected } = await restoredMonth([row("d1", "001.jpg"), row("d2", "002.jpg")]);
  assert.equal(await app.activateDeclaration(selected), true);
  assert.equal(rows().length, 2);
  assert.equal(rows()[0].cells[6].textContent, "1234");
  assert.equal(rows()[0].dataset.imageFile, "001.jpg", "the reference to the image is kept, so a later copy of the images works");
});

test("opening a month that fails half way must not let the next save empty its table", async () => {
  const { app, rows } = await loadApp();
  const { client, selected } = await restoredMonth([row("d1", "001.jpg"), row("d2", "002.jpg")]);
  // An unreadable image that is not simply missing: the opening fails.
  const images = await client.getDirectoryHandle("declarations").then((d) => d.getDirectoryHandle("2026-09")).then((d) => d.getDirectoryHandle("images", { create: true }));
  const broken = { kind: "file", name: "001.jpg", getFile: async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); } };
  const realGet = images.getFileHandle;
  images.getFileHandle = async (name, options) => (name === "001.jpg" ? broken : realGet.call(images, name, options));
  await assert.rejects(app.activateDeclaration(selected), /001\.jpg/);
  await app.saveCurrentDraft();
  const draft = (await loadDeclaration(client, "2026-09")).draft;
  assert.equal(draft.rows.length, 2, "the saved table is untouched");
  assert.equal(rows().length, 0);
});
