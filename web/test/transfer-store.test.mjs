import test from "node:test";
import assert from "node:assert/strict";
import { keyFromRecoveryCode, newRecoveryCode } from "../backup-store.js";
import { createDeclaration, finalizeDeclaration, listDeclarations, loadDeclaration, readClosedHistory, saveDraft, saveSourceImage } from "../declaration-store.js";
import { collectClient, createClient, decodeTransfer, describeTransfer, encodeTransfer, imagesSize, importTransfer } from "../transfer-store.js";
import { binaryDirectory, readFileBytes } from "./memory-binary-directory.mjs";

const newKey = () => keyFromRecoveryCode(newRecoveryCode());
const jpeg = (seed, size = 3000) => Uint8Array.from({ length: size }, (_, i) => (i * 7 + seed) & 255);
const row = (id, index, file) => ({ documentId: id, imageIndex: index, imageFile: file, values: ["2026-01-05", "203", id], active: true });
const config = { schemaVersion: 1, clientId: "c1", clientName: "Synthetic", businessActivity: "consulting", businessKind: "office", archived: false };
const at = (minute) => `2026-10-03T10:${String(minute).padStart(2, "0")}:00.000Z`;

// A client folder; each spec is { month, rows, images, locked }.
async function clientWith(specs) {
  const client = binaryDirectory("client");
  for (const { month, rows = [], images = {}, locked = false } of specs) {
    const { directory, declaration } = await createDeclaration(client, { clientId: "c1", month });
    for (const [name, bytes] of Object.entries(images)) await saveSourceImage(directory, name, bytes);
    await saveDraft(directory, declaration, rows, at(0));
    if (locked) await finalizeDeclaration({ clientDirectory: client, declarationDirectory: directory, declaration, finalExport: "no-export", rows, now: at(2) });
  }
  return client;
}

const sample = () => clientWith([
  { month: "2026-01", rows: [row("d1", 1, "001.jpg"), row("d1b", 1, "001.jpg"), row("x1", 0, "")], images: { "001.jpg": jpeg(1) }, locked: true },
  { month: "2026-02", rows: [row("e1", 1, "001.png"), row("e2", 2, "002.jpg")], images: { "001.png": jpeg(2, 500), "002.jpg": jpeg(3) } },
]);

const roundTrip = async (client, options, key) => decodeTransfer(key, await encodeTransfer(key, await collectClient({ clientDirectory: client, config, now: at(5), ...options })));

test("one month with images: rows and image bytes survive, the kind is month", async () => {
  const key = await newKey();
  const decoded = await roundTrip(await sample(), { months: ["2026-02"], includeImages: true }, key);
  assert.equal(decoded.meta.kind, "month");
  assert.deepEqual(decoded.meta.client, { clientName: "Synthetic", businessActivity: "consulting", businessKind: "office" });
  assert.deepEqual(decoded.meta.months.map((m) => [m.month, m.status, m.rows.length]), [["2026-02", "open", 2]]);
  assert.deepEqual(decoded.images.get("2026-02/001.png"), jpeg(2, 500));
  assert.deepEqual(decoded.images.get("2026-02/002.jpg"), jpeg(3));
  assert.deepEqual(describeTransfer(decoded), { kind: "month", clientName: "Synthetic", months: [{ month: "2026-02", status: "open", rows: 2, images: 2 }], rows: 2, images: 2 });
});

test("the whole client: every month oldest first, the locked month carries only its own history", async () => {
  const key = await newKey();
  const decoded = await roundTrip(await sample(), {}, key);
  assert.equal(decoded.meta.kind, "client");
  assert.deepEqual(decoded.meta.months.map((m) => [m.month, m.status]), [["2026-01", "closed"], ["2026-02", "open"]]);
  assert.equal(decoded.meta.months[0].history.length, 3);
  assert.deepEqual(decoded.meta.months[1].history, []);
  assert.equal(decoded.images.size, 0, "no images unless asked");
});

test("the file is sealed: wrong key, a foreign file and a damaged file are refused, nothing is in plain text", async () => {
  const key = await newKey();
  const bytes = await encodeTransfer(key, await collectClient({ clientDirectory: await sample(), config, now: at(5) }));
  assert.ok(!new TextDecoder("latin1").decode(bytes).includes("Synthetic"));
  await assert.rejects(decodeTransfer(await newKey(), bytes), { code: "TRANSFER_WRONG_KEY" });
  await assert.rejects(decodeTransfer(key, new TextEncoder().encode("hello")), { code: "TRANSFER_NOT_FILE" });
  const damaged = bytes.slice();
  damaged[damaged.length - 3] ^= 0xff;
  await assert.rejects(decodeTransfer(key, damaged), { code: "TRANSFER_WRONG_KEY" });
});

test("exporting a month that does not exist is refused", async () => {
  await assert.rejects(collectClient({ clientDirectory: await sample(), config, months: ["2030-01"] }), { code: "TRANSFER_EMPTY" });
});

test("import into an empty client: the open month is created, the locked month is copied as it was with its history", async () => {
  const key = await newKey();
  const source = await sample();
  const decoded = await roundTrip(source, { includeImages: true }, key);
  const receiver = binaryDirectory("receiver");
  const results = await importTransfer({ clientDirectory: receiver, clientId: "c9", decoded, now: at(6) });
  assert.deepEqual(results.map((r) => [r.month, r.action, r.added]), [["2026-01", "copied-locked", 3], ["2026-02", "created", 2]]);
  const locked = await loadDeclaration(receiver, "2026-01");
  const original = (await loadDeclaration(source, "2026-01")).declaration;
  assert.equal(locked.declaration.status, "closed");
  assert.equal(locked.declaration.declarationId, original.declarationId, "same declaration id");
  assert.equal(locked.declaration.clientId, "c9", "belongs to the receiving client");
  assert.deepEqual(locked.draft.rows.map((r) => r.documentId), ["d1", "d1b", "x1"]);
  assert.deepEqual(await readFileBytes(receiver, "declarations/2026-01/images/001.jpg"), jpeg(1));
  assert.equal((await readClosedHistory(receiver)).filter((e) => e.declarationId === original.declarationId).length, 3);
  const open = await loadDeclaration(receiver, "2026-02");
  assert.equal(open.declaration.status, "open");
  assert.deepEqual(await readFileBytes(receiver, "declarations/2026-02/images/002.jpg"), jpeg(3));
  assert.equal((await listDeclarations(receiver)).length, 2);
});

test("importing the same file again adds nothing, keeps the locked month and does not repeat its history", async () => {
  const key = await newKey();
  const decoded = await roundTrip(await sample(), { includeImages: true }, key);
  const receiver = binaryDirectory("receiver");
  await importTransfer({ clientDirectory: receiver, clientId: "c9", decoded, now: at(6) });
  const again = await importTransfer({ clientDirectory: receiver, clientId: "c9", decoded, now: at(7) });
  assert.deepEqual(again.map((r) => [r.month, r.action, r.added, r.duplicates]), [["2026-01", "skipped-locked", undefined, undefined], ["2026-02", "appended", 0, 2]]);
  assert.equal((await loadDeclaration(receiver, "2026-02")).draft.rows.length, 2);
  assert.equal((await readClosedHistory(receiver)).length, 3);
});

test("an open month gets only the rows it lacks, images continue its numbering, existing rows and files stay", async () => {
  const key = await newKey();
  const decoded = await roundTrip(await sample(), { months: ["2026-02"], includeImages: true }, key);
  const receiver = await clientWith([{ month: "2026-02", rows: [row("mine", 1, "001.jpg"), row("e1", 2, "002.jpg")], images: { "001.jpg": jpeg(50), "002.jpg": jpeg(51) } }]);
  const [result] = await importTransfer({ clientDirectory: receiver, clientId: "c1", decoded, now: at(8) });
  assert.deepEqual([result.action, result.added, result.duplicates, result.images], ["appended", 1, 1, 1]);
  const { draft } = await loadDeclaration(receiver, "2026-02");
  assert.deepEqual(draft.rows.map((r) => [r.documentId, r.imageIndex, r.imageFile]), [["mine", 1, "001.jpg"], ["e1", 2, "002.jpg"], ["e2", 3, "003.jpg"]]);
  assert.deepEqual(await readFileBytes(receiver, "declarations/2026-02/images/001.jpg"), jpeg(50));
  assert.deepEqual(await readFileBytes(receiver, "declarations/2026-02/images/003.jpg"), jpeg(3));
});

test("a locked month here is never touched; a locked month in the file meeting an open month here only adds rows", async () => {
  const key = await newKey();
  const decoded = await roundTrip(await sample(), { includeImages: true }, key);
  const receiver = await clientWith([
    { month: "2026-01", rows: [row("mine", 0, "")] },
    { month: "2026-02", rows: [row("keep", 0, "")], locked: true },
  ]);
  const results = await importTransfer({ clientDirectory: receiver, clientId: "c1", decoded, now: at(9) });
  assert.deepEqual(results.map((r) => [r.month, r.action]), [["2026-01", "appended"], ["2026-02", "skipped-locked"]]);
  assert.deepEqual((await loadDeclaration(receiver, "2026-01")).draft.rows.map((r) => r.documentId), ["mine", "d1", "d1b", "x1"]);
  assert.deepEqual((await loadDeclaration(receiver, "2026-02")).draft.rows.map((r) => r.documentId), ["keep"]);
});

test("without images in the file the rows lose their image reference instead of pointing at nothing", async () => {
  const key = await newKey();
  const decoded = await roundTrip(await sample(), { months: ["2026-02"] }, key);
  const receiver = binaryDirectory("receiver");
  await importTransfer({ clientDirectory: receiver, clientId: "c9", decoded, now: at(6) });
  assert.deepEqual((await loadDeclaration(receiver, "2026-02")).draft.rows.map((r) => r.imageFile), ["", ""]);
});

test("createClient writes a valid workspace, avoids existing folder names and rejects bad details", async () => {
  const root = binaryDirectory("data");
  const first = await createClient(root, { clientName: "A/B: Ltd.", businessActivity: "x", businessKind: "home" });
  const second = await createClient(root, { clientName: "A/B: Ltd.", businessActivity: "x", businessKind: "home" });
  assert.notEqual(first.config.clientId, second.config.clientId);
  assert.deepEqual([...(await root.getDirectoryHandle("clients")).children.keys()], ["A-B- Ltd", "A-B- Ltd (2)"]);
  assert.equal(JSON.parse(new TextDecoder().decode(await readFileBytes(root, "clients/A-B- Ltd/workspace.json"))).clientName, "A/B: Ltd.");
  await assert.rejects(createClient(root, { clientName: "", businessActivity: "x", businessKind: "home" }), { code: "TRANSFER_BAD_CLIENT" });
  await assert.rejects(createClient(root, { clientName: "x", businessActivity: "x", businessKind: "castle" }), { code: "TRANSFER_BAD_CLIENT" });
});

test("the tax profile (numbers, PCN duty) travels with the client and survives createClient", async () => {
  const key = await newKey();
  const profile = { vatId: "123456782", incomeTaxFileId: "987654321", pcnRequired: true };
  const bytes = await encodeTransfer(key, await collectClient({ clientDirectory: await sample(), config: { ...config, ...profile }, now: at(5) }));
  const { meta } = await decodeTransfer(key, bytes);
  assert.deepEqual(meta.client, { clientName: "Synthetic", businessActivity: "consulting", businessKind: "office", ...profile });
  const created = await createClient(binaryDirectory("data"), meta.client);
  assert.deepEqual([created.config.vatId, created.config.incomeTaxFileId, created.config.pcnRequired], ["123456782", "987654321", true]);
});

test("imagesSize adds up the image files of the chosen months", async () => {
  const client = await sample();
  assert.equal(await imagesSize(client), 3000 + 500 + 3000);
  assert.equal(await imagesSize(client, ["2026-02"]), 3500);
  assert.equal(await imagesSize(binaryDirectory("empty")), 0);
});
