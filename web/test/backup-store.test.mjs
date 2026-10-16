import test from "node:test";
import assert from "node:assert/strict";
import {
  STORE_DIR,
  createBackup,
  importBackupKey,
  keyFromRecoveryCode,
  listSnapshots,
  newRecoveryCode,
  parseRecoveryCode,
  readSnapshot,
  restoreSnapshot,
  snapshotsToKeep,
  verifyStore,
} from "../backup-store.js";
import { binaryDirectory, listPaths, putFile, readFileBytes } from "./memory-binary-directory.mjs";

const noDelay = async () => {};
const bytes = (size, seed) => Uint8Array.from({ length: size }, (_, i) => (i * 31 + seed) & 255);
const at = (minute) => `2026-10-03T10:${String(minute).padStart(2, "0")}:00.000Z`;

async function sampleRoot() {
  const root = binaryDirectory("data");
  await putFile(root, "common/ui-settings.json", '{"a":1}');
  await putFile(root, "clients/c1/workspace.json", '{"name":"synthetic"}');
  await putFile(root, "clients/c1/history.jsonl", "{}\n{}\n");
  await putFile(root, "clients/c1/reports/vat_01-2026.pdf", bytes(70000, 1));
  await putFile(root, "clients/c1/declarations/2026-01/declaration.json", '{"status":"open"}');
  await putFile(root, "clients/c1/declarations/2026-01/draft-table.json", '{"rows":[]}');
  await putFile(root, "clients/c1/declarations/2026-01/images/page-1.jpg", bytes(5000, 2));
  await putFile(root, "clients/c1/declarations/2026-01/exports/2026-01-05_10-00/import.txt", "legacy");
  return root;
}

const newKey = () => keyFromRecoveryCode(newRecoveryCode());

test("recovery code: round trip, groups of four, typos and bad length are rejected", () => {
  const code = newRecoveryCode();
  assert.match(code, /^([0-9A-Z]{4}-){13}[0-9A-Z]{4}$/);
  assert.equal(parseRecoveryCode(code).length, 32);
  assert.deepEqual(parseRecoveryCode(code), parseRecoveryCode(code.toLowerCase().replaceAll("-", " ")));
  const typo = code.slice(0, 2) + (code[2] === "A" ? "B" : "A") + code.slice(3);
  assert.throws(() => parseRecoveryCode(typo), { code: "BACKUP_BAD_CODE" });
  assert.throws(() => parseRecoveryCode(code.slice(0, -5)), { code: "BACKUP_BAD_CODE" });
  assert.throws(() => parseRecoveryCode(""), { code: "BACKUP_BAD_CODE" });
});

test("backup and restore give back the same files; images and exports stay out by default", async () => {
  const source = await sampleRoot();
  const destination = binaryDirectory("usb");
  const key = await newKey();
  const result = await createBackup({ source, destination, key, now: at(0) });
  assert.equal(result.files, 6);
  assert.deepEqual(result.skipped, []);
  const target = binaryDirectory("restored");
  await restoreSnapshot({ destination, key, name: result.name, target });
  assert.deepEqual(await listPaths(target), [
    "clients/c1/declarations/2026-01/declaration.json",
    "clients/c1/declarations/2026-01/draft-table.json",
    "clients/c1/history.jsonl",
    "clients/c1/reports/vat_01-2026.pdf",
    "clients/c1/workspace.json",
    "common/ui-settings.json",
  ]);
  assert.deepEqual(await readFileBytes(target, "clients/c1/reports/vat_01-2026.pdf"), bytes(70000, 1));
  assert.equal(new TextDecoder().decode(await readFileBytes(target, "clients/c1/workspace.json")), '{"name":"synthetic"}');
});

test("backup: images and exports are included only when asked", async () => {
  const source = await sampleRoot();
  const destination = binaryDirectory("usb");
  const key = await newKey();
  const { name, files } = await createBackup({ source, destination, key, images: true, exports: true, now: at(0) });
  assert.equal(files, 8);
  const snapshot = await readSnapshot(destination, key, name);
  assert.ok("clients/c1/declarations/2026-01/images/page-1.jpg" in snapshot.files);
  assert.ok("clients/c1/declarations/2026-01/exports/2026-01-05_10-00/import.txt" in snapshot.files);
});

test("backup: a client folder named images is not mistaken for a heavy declaration folder", async () => {
  const source = binaryDirectory("data");
  await putFile(source, "clients/images/workspace.json", "{}");
  const result = await createBackup({ source, destination: binaryDirectory("usb"), key: await newKey(), now: at(0) });
  assert.equal(result.files, 1);
});

test("backup: nothing is stored in plain text and the store never holds the source folder name or contents", async () => {
  const source = await sampleRoot();
  const destination = binaryDirectory("usb");
  await createBackup({ source, destination, key: await newKey(), now: at(0) });
  for (const path of await listPaths(destination)) {
    const text = new TextDecoder("latin1").decode(await readFileBytes(destination, path));
    assert.ok(!text.includes("synthetic"), path);
    assert.ok(!text.includes("workspace.json"), path);
  }
});

test("second backup without changes writes only a snapshot; a changed file adds only its own blob", async () => {
  const source = await sampleRoot();
  const destination = binaryDirectory("usb");
  const key = await newKey();
  await createBackup({ source, destination, key, now: at(0) });
  const packsBefore = (await listPaths(destination)).filter((p) => p.includes("/packs/"));
  const again = await createBackup({ source, destination, key, now: at(1) });
  assert.deepEqual([again.newBlobs, again.packs], [0, 0]);
  assert.deepEqual((await listPaths(destination)).filter((p) => p.includes("/packs/")), packsBefore);
  await putFile(source, "clients/c1/history.jsonl", "{}\n{}\n{}\n");
  const changed = await createBackup({ source, destination, key, now: at(2) });
  assert.deepEqual([changed.newBlobs, changed.packs], [1, 1]);
  assert.equal((await listSnapshots(destination)).length, 3);
});

test("identical files inside one run are stored once", async () => {
  const source = binaryDirectory("data");
  await putFile(source, "a.json", "same");
  await putFile(source, "b.json", "same");
  const result = await createBackup({ source, destination: binaryDirectory("usb"), key: await newKey(), now: at(0) });
  assert.deepEqual([result.files, result.newBlobs], [2, 1]);
});

test("packs are cut at the pack size", async () => {
  const source = binaryDirectory("data");
  for (let i = 0; i < 6; i += 1) await putFile(source, `f${i}.bin`, bytes(1000, i));
  const destination = binaryDirectory("usb");
  const result = await createBackup({ source, destination, key: await newKey(), now: at(0), packBytes: 2500 });
  assert.equal(result.packs, 2);
});

test("a wrong key is refused before anything is written or read", async () => {
  const source = await sampleRoot();
  const destination = binaryDirectory("usb");
  const { name } = await createBackup({ source, destination, key: await newKey(), now: at(0) });
  const other = await newKey();
  await assert.rejects(createBackup({ source, destination, key: other, now: at(1) }), { code: "BACKUP_WRONG_KEY" });
  await assert.rejects(restoreSnapshot({ destination, key: other, name, target: binaryDirectory("t") }), { code: "BACKUP_WRONG_KEY" });
  assert.equal((await listSnapshots(destination)).length, 1);
});

test("Drive-style write errors are retried, other write errors surface", async () => {
  const source = await sampleRoot();
  const destination = binaryDirectory("usb");
  destination.state.failures.push({ match: /^pack-.*\.bin$/, name: "InvalidStateError", times: 2 });
  const key = await newKey();
  const result = await createBackup({ source, destination, key, now: at(0), delay: noDelay });
  assert.equal(result.packs, 1);
  assert.equal(destination.state.failures[0].times, 0);
  destination.state.failures.push({ match: /^snap-/, name: "TypeError", times: 1 });
  await assert.rejects(createBackup({ source, destination, key, now: at(1), delay: noDelay }), { name: "TypeError" });
});

test("a file that cannot be read is reported, not silently dropped", async () => {
  const source = await sampleRoot();
  const real = source.getDirectoryHandle.bind(source);
  const common = await real("common");
  const handle = await common.getFileHandle("ui-settings.json");
  const broken = { ...handle, getFile: async () => { throw Object.assign(new Error("locked"), { name: "NotReadableError" }); } };
  common.entries = async function* () { yield ["ui-settings.json", broken]; };
  const destination = binaryDirectory("usb");
  const result = await createBackup({ source, destination, key: await newKey(), now: at(0) });
  assert.deepEqual(result.skipped, [{ path: "common/ui-settings.json", error: "NotReadableError" }]);
  assert.equal(result.files, 5);
});

test("the store folder itself can be picked as well as the folder that holds it", async () => {
  const source = await sampleRoot();
  const destination = binaryDirectory("usb");
  const key = await newKey();
  const { name } = await createBackup({ source, destination, key, now: at(0) });
  const store = await destination.getDirectoryHandle(STORE_DIR);
  assert.equal((await listSnapshots(store)).length, 1);
  const target = binaryDirectory("restored");
  await restoreSnapshot({ destination: store, key, name, target });
  assert.equal((await listPaths(target)).length, 6);
  assert.deepEqual(await listSnapshots(binaryDirectory("elsewhere")), []);
  await assert.rejects(restoreSnapshot({ destination: binaryDirectory("elsewhere"), key, name, target: binaryDirectory("t") }), { code: "BACKUP_NO_STORE" });
});

test("restore refuses a folder that is not empty and an unknown snapshot", async () => {
  const source = await sampleRoot();
  const destination = binaryDirectory("usb");
  const key = await newKey();
  const { name } = await createBackup({ source, destination, key, now: at(0) });
  const busy = binaryDirectory("busy");
  await putFile(busy, "x.txt", "x");
  await assert.rejects(restoreSnapshot({ destination, key, name, target: busy }), { code: "BACKUP_NOT_EMPTY" });
  await assert.rejects(restoreSnapshot({ destination, key, name: "snap-nope.bin", target: binaryDirectory("t") }), { code: "BACKUP_NO_SNAPSHOT" });
});

test("listing: snapshots carry their time and are readable without a key; an empty folder has none", async () => {
  const destination = binaryDirectory("usb");
  assert.deepEqual(await listSnapshots(destination), []);
  const source = await sampleRoot();
  const key = await newKey();
  await createBackup({ source, destination, key, now: at(7) });
  const [only] = await listSnapshots(destination);
  assert.equal(only.at, "2026-10-03T10:07:00Z");
  assert.match(only.name, /^snap-20261003T100700Z-[0-9a-f]{6}\.bin$/);
});

test("verify: a good store passes; a missing pack and a damaged blob are reported", async () => {
  const source = await sampleRoot();
  const destination = binaryDirectory("usb");
  const key = await newKey();
  await createBackup({ source, destination, key, now: at(0) });
  assert.equal((await verifyStore({ destination, key, deep: true })).ok, true);

  const store = await destination.getDirectoryHandle(STORE_DIR);
  const packs = await store.getDirectoryHandle("packs");
  const packName = [...packs.children.keys()].find((n) => n.endsWith(".bin"));
  const original = packs.children.get(packName).bytes;
  const damaged = original.slice();
  damaged[damaged.length - 5] ^= 0xff;
  packs.children.get(packName).bytes = damaged;
  const deep = await verifyStore({ destination, key, deep: true });
  assert.equal(deep.ok, false);
  assert.ok(deep.corrupt.length >= 1);
  assert.equal((await verifyStore({ destination, key })).ok, true, "shallow check does not read blobs");
  await assert.rejects(restoreSnapshot({ destination, key, name: (await listSnapshots(destination))[0].name, target: binaryDirectory("t") }), { code: "BACKUP_CORRUPT" });

  packs.children.delete(packName);
  const missing = await verifyStore({ destination, key });
  assert.equal(missing.ok, false);
  assert.ok(missing.missing.length >= 1);
});

test("a blob moved to another hash position fails authentication", async () => {
  const source = binaryDirectory("data");
  await putFile(source, "a.json", "first file");
  await putFile(source, "b.json", "second file!");
  const destination = binaryDirectory("usb");
  const key = await newKey();
  await createBackup({ source, destination, key, now: at(0), packBytes: 1 });
  const packs = await (await destination.getDirectoryHandle(STORE_DIR)).getDirectoryHandle("packs");
  const [one, two] = [...packs.children.keys()].filter((n) => n.endsWith(".bin"));
  const swap = packs.children.get(one).bytes;
  packs.children.get(one).bytes = packs.children.get(two).bytes;
  packs.children.get(two).bytes = swap;
  const report = await verifyStore({ destination, key, deep: true });
  assert.equal(report.ok, false);
});

test("a key made from the code can be non-extractable", async () => {
  const key = await importBackupKey(parseRecoveryCode(newRecoveryCode()));
  assert.equal(key.extractable, false);
});

test("retention: the last 30 days stay, then one snapshot per month, the newest is always kept", () => {
  const list = [
    ["a", "2026-10-03T10:00:00Z"], ["b", "2026-10-02T10:00:00Z"], ["c", "2026-09-20T10:00:00Z"],
    ["d", "2026-08-30T10:00:00Z"], ["e", "2026-08-10T10:00:00Z"], ["f", "2026-08-01T10:00:00Z"],
    ["g", "2020-01-15T10:00:00Z"],
  ].map(([name, when]) => ({ name, at: when }));
  const { keep, drop } = snapshotsToKeep(list, "2026-10-03T12:00:00Z");
  assert.deepEqual(keep.sort(), ["a", "b", "c", "d"]);
  assert.deepEqual(drop.sort(), ["e", "f", "g"]);
  assert.deepEqual(snapshotsToKeep([{ name: "old", at: "2019-01-01T00:00:00Z" }], "2026-10-03T12:00:00Z").keep, ["old"]);
});
