import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { keyFromRecoveryCode, newRecoveryCode } from "../backup-store.js";
import { BACKUP_KEY_NAME } from "../backup-handles.js";
import { createDeclaration, listDeclarations, loadDeclaration, saveDraft, saveSourceImage } from "../declaration-store.js";
import { binaryDirectory, putFile, readFileBytes } from "./memory-binary-directory.mjs";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve, 15));
const settle = async () => { for (let i = 0; i < 10; i += 1) await tick(); };
const jpeg = (seed) => Uint8Array.from({ length: 2000 }, (_, i) => (i * 5 + seed) & 255);
const row = (id, index, file) => ({ documentId: id, imageIndex: index, imageFile: file, values: ["2026-01-05", "203", id], active: true });
const config = { clientId: "c1", clientName: "Synthetic", businessActivity: "x", businessKind: "office" };

// A client entry the way the workspace lists it, with one open declaration holding rows and images.
async function clientEntry(id, name, months = ["2026-01", "2026-02"]) {
  const directory = binaryDirectory(name);
  const declarations = [];
  for (const month of months) {
    const { directory: monthDirectory, declaration } = await createDeclaration(directory, { clientId: id, month });
    await saveSourceImage(monthDirectory, "001.jpg", jpeg(month.length + Number(month.slice(-1))));
    await saveDraft(monthDirectory, declaration, [row(`${month}-a`, 1, "001.jpg"), row(`${month}-b`, 1, "001.jpg")]);
    declarations.push({ declaration });
  }
  return { id, clientName: name, directory, config: { ...config, clientId: id, clientName: name }, declarations };
}

async function setup({ key, clients = [], current = null, confirmAnswer = true } = {}) {
  const dom = new JSDOM(html, { url: "https://vitaliksh.github.io/ocr/" });
  const { window } = dom;
  Object.assign(globalThis, { document: window.document, window });
  const dialog = window.document.querySelector("#transfer-dialog");
  dialog.showModal = () => { dialog.open = true; };
  const root = binaryDirectory("data");
  await putFile(root, "common/ui-settings.json", "{}");
  const stored = new Map();
  if (key) stored.set(BACKUP_KEY_NAME, key);
  const store = { readSetting: async (k) => stored.get(k), writeSetting: async (k, v) => { stored.set(k, v); } };
  const calls = { before: [], after: [], confirms: [], saved: 0 };
  const files = { saved: null, toOpen: null };
  const { setupTransfer } = await import("../transfer-ui.js");
  const transfer = setupTransfer({
    dialog,
    openButton: window.document.querySelector("#open-transfer"),
    getDataRoot: () => root,
    getClients: () => clients,
    getCurrent: () => current,
    saveCurrent: async () => { calls.saved += 1; },
    beforeImport: async (info) => { calls.before.push(info); },
    afterImport: async (info) => { calls.after.push(info); },
    store,
    pickSaveFile: async (options) => {
      const target = { name: options.suggestedName, bytes: null, createWritable: async () => ({ write: async (data) => { target.bytes = data; }, close: async () => {} }) };
      files.saved = target;
      return target;
    },
    pickOpenFile: async () => {
      if (!files.toOpen) throw Object.assign(new Error("cancelled"), { name: "AbortError" });
      return [{ getFile: async () => ({ arrayBuffer: async () => files.toOpen.slice().buffer }) }];
    },
    now: () => "2026-10-03T12:00:00.000Z",
    confirm: async (...args) => { calls.confirms.push(args); return confirmAnswer; },
  });
  await transfer.refresh();
  const q = (selector) => dialog.querySelector(selector);
  const click = async (button) => { button.click(); await settle(); };
  const choose = async (select, value) => { select.value = value; select.dispatchEvent(new window.Event("change")); await settle(); };
  return { window, dialog, root, stored, calls, files, transfer, q, click, choose, plate: () => q("#transfer-summary").textContent, error: () => q("#transfer-error").textContent };
}

test("the page has the transfer dialog and the export entry points", () => {
  for (const id of ["open-transfer", "transfer-dialog", "transfer-summary", "transfer-error", "transfer-export-client", "transfer-export-month", "transfer-images", "transfer-size", "transfer-export", "transfer-open", "transfer-details", "transfer-info", "transfer-client", "transfer-target", "transfer-import", "export-client", "export-declaration"]) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
});

test("export needs a key and a chosen client", async () => {
  const noKey = await setup({ clients: [await clientEntry("c1", "Synthetic")] });
  await noKey.click(noKey.window.document.querySelector("#open-transfer"));
  assert.equal(noKey.q("#transfer-export").disabled, true);
  const key = await keyFromRecoveryCode(newRecoveryCode());
  const ui = await setup({ key, clients: [await clientEntry("c1", "Synthetic")] });
  await ui.click(ui.window.document.querySelector("#open-transfer"));
  assert.equal(ui.q("#transfer-export").disabled, true, "no client chosen yet");
  await ui.choose(ui.q("#transfer-export-client"), "c1");
  assert.equal(ui.q("#transfer-export").disabled, false);
});

test("the menus preselect the client and the month; one month includes images by default, the whole client does not", async () => {
  const key = await keyFromRecoveryCode(newRecoveryCode());
  const ui = await setup({ key, clients: [await clientEntry("c1", "Synthetic")] });
  await ui.transfer.openExport({ clientId: "c1", month: "2026-02" });
  await settle();
  assert.equal(ui.dialog.open, true);
  assert.equal(ui.q("#transfer-export-client").value, "c1");
  assert.equal(ui.q("#transfer-export-month").value, "2026-02");
  assert.equal(ui.q("#transfer-images").checked, true);
  assert.match(ui.q("#transfer-size").textContent, /גודל התמונות/);
  await ui.choose(ui.q("#transfer-export-month"), "");
  assert.equal(ui.q("#transfer-images").checked, false);
  assert.match(ui.q("#transfer-size").textContent, /לא ייכללו/);
  assert.equal(ui.q("#transfer-export-month").options.length, 3, "all months plus two months");
});

test("save a month to a file and import it into a client with the same name on another PC", async () => {
  const key = await keyFromRecoveryCode(newRecoveryCode());
  const sender = await setup({ key, clients: [await clientEntry("c1", "Synthetic")], current: { client: { clientId: "c1" }, declaration: { month: "2026-02" } } });
  await sender.transfer.openExport({ clientId: "c1", month: "2026-02" });
  await settle();
  await sender.click(sender.q("#transfer-export"));
  assert.equal(sender.files.saved.name, "Synthetic_02-2026.annateria");
  assert.match(sender.plate(), /נשמר הקובץ «Synthetic_02-2026.annateria».*1 חודשים, 2 שורות, 1 תמונות/);
  assert.equal(sender.calls.saved, 1, "the open table is saved first when it belongs to the export");

  const receiverClient = await clientEntry("c9", "synthetic ", []);
  const receiver = await setup({ key, clients: [receiverClient] });
  receiver.files.toOpen = sender.files.saved.bytes;
  await receiver.click(receiver.q("#transfer-open"));
  assert.equal(receiver.q("#transfer-details").hidden, false);
  assert.match(receiver.q("#transfer-info").textContent, /1 חודשים · 2 שורות · 1 תמונות/);
  assert.equal(receiver.q("#transfer-client").value, "c9", "same-named client preselected");
  await receiver.click(receiver.q("#transfer-import"));
  assert.match(receiver.plate(), /יובאו 2 שורות ל«synthetic »/);
  assert.match(receiver.plate(), /02\/2026: נוצרה, 2 שורות/);
  assert.deepEqual(receiver.calls.after, [{ clientId: "c9", months: ["2026-02"], kind: "month" }]);
  assert.equal((await loadDeclaration(receiverClient.directory, "2026-02")).draft.rows.length, 2);
  await receiver.click(receiver.q("#transfer-import"));
  assert.match(receiver.plate(), /נוספו 0 שורות \(2 כבר היו\)/);
  assert.equal(receiver.calls.confirms.length, 0);
});

test("a whole client goes to a PC that does not have it: the client is created after a confirmation", async () => {
  const key = await keyFromRecoveryCode(newRecoveryCode());
  const sender = await setup({ key, clients: [await clientEntry("c1", "Synthetic")] });
  await sender.transfer.openExport({ clientId: "c1" });
  await settle();
  await sender.click(sender.q("#transfer-export"));
  assert.equal(sender.files.saved.name, "Synthetic_all.annateria");

  const receiver = await setup({ key, clients: [] });
  receiver.files.toOpen = sender.files.saved.bytes;
  await receiver.click(receiver.q("#transfer-open"));
  assert.equal(receiver.q("#transfer-client").value, "__new__");
  assert.match(receiver.q("#transfer-target").textContent, /ייווצר/);
  await receiver.click(receiver.q("#transfer-import"));
  assert.equal(receiver.calls.confirms.length, 1);
  assert.match(receiver.plate(), /יובאו 4 שורות ל«Synthetic» \(לקוח חדש\)/);
  assert.equal(receiver.calls.after[0].months.length, 2);
  const created = await receiver.root.getDirectoryHandle("clients").then((d) => d.getDirectoryHandle("Synthetic"));
  assert.equal(JSON.parse(new TextDecoder().decode(await readFileBytes(created, "workspace.json"))).businessActivity, "x");
  assert.equal((await listDeclarations(created)).length, 2);
});

test("declining the new client changes nothing", async () => {
  const key = await keyFromRecoveryCode(newRecoveryCode());
  const sender = await setup({ key, clients: [await clientEntry("c1", "Synthetic")] });
  await sender.transfer.openExport({ clientId: "c1" });
  await settle();
  await sender.click(sender.q("#transfer-export"));
  const receiver = await setup({ key, clients: [], confirmAnswer: false });
  receiver.files.toOpen = sender.files.saved.bytes;
  await receiver.click(receiver.q("#transfer-open"));
  await receiver.click(receiver.q("#transfer-import"));
  assert.equal(receiver.calls.after.length, 0);
  await assert.rejects(receiver.root.getDirectoryHandle("clients"), { name: "NotFoundError" });
});

test("a file made with another code is reported and a cancelled picker is not an error", async () => {
  const sender = await setup({ key: await keyFromRecoveryCode(newRecoveryCode()), clients: [await clientEntry("c1", "Synthetic")] });
  await sender.transfer.openExport({ clientId: "c1" });
  await settle();
  await sender.click(sender.q("#transfer-export"));
  const receiver = await setup({ key: await keyFromRecoveryCode(newRecoveryCode()) });
  await receiver.click(receiver.q("#transfer-open"));
  assert.equal(receiver.error(), "", "cancelled");
  receiver.files.toOpen = sender.files.saved.bytes;
  await receiver.click(receiver.q("#transfer-open"));
  assert.match(receiver.error(), /קוד השחזור אינו מתאים/);
  assert.match(receiver.plate(), /קוד השחזור אינו מתאים/);
  assert.equal(receiver.q("#transfer-details").hidden, true);
});
