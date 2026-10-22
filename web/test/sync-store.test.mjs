import test from "node:test";
import assert from "node:assert/strict";
import {
  createBackup, keyFromRecoveryCode, listSnapshots, newRecoveryCode, readSnapshot, restoreSnapshot,
} from "../backup-store.js";
import { SYNC_DIR, SYNC_STATE_FILE, createSyncSnapshot, isLocalOnly, pushSnapshot, readSyncState } from "../sync-store.js";
import { binaryDirectory, listPaths, putFile, readFileBytes } from "./memory-binary-directory.mjs";

const bytes = (size, seed) => Uint8Array.from({ length: size }, (_, i) => (i * 31 + seed) & 255);
const at = (minute) => `2026-10-22T10:${String(minute).padStart(2, "0")}:00.000Z`;
const newKey = () => keyFromRecoveryCode(newRecoveryCode());
const IMAGE = "clients/c1/declarations/2026-09/images/001.jpg";
const PDF = "clients/c1/declarations/2026-09/images/002.pdf";

// Synthetic data root: the files of one PC, the shared data and a leftover Chrome swap file.
async function sampleRoot() {
  const root = binaryDirectory("data");
  await putFile(root, "common/ui-settings.json", '{"folderPath":"D:\\\\ANNA"}');
  await putFile(root, "common/backup-state.json", '{"cloud":null}');
  await putFile(root, `common/${SYNC_STATE_FILE}`, '{"base":"snap-x"}');
  await putFile(root, "common/agent-runs/run-1.json", "{}");
  await putFile(root, "clients/c1/workspace.json", '{"name":"synthetic"}');
  await putFile(root, "clients/c1/rules.md", "- rule\n");
  await putFile(root, "clients/c1/declarations/2026-09/declaration.json", '{"status":"open"}');
  await putFile(root, "clients/c1/declarations/2026-09/draft-table.json", '{"rows":[]}');
  await putFile(root, "clients/c1/declarations/2026-09/draft-table.json.crswap", '{"rows":');
  await putFile(root, IMAGE, bytes(30000, 1));
  await putFile(root, PDF, bytes(50000, 2));
  await putFile(root, "clients/c1/declarations/2026-09/exports/2026-09-30_10-00/import.txt", "legacy");
  await putFile(root, "inbox/_unsorted/scan.pdf", bytes(4000, 3));
  return root;
}

test("sync snapshot: images always in, exports and the files of one PC out, the rest as in a backup", async () => {
  const source = await sampleRoot();
  const destination = binaryDirectory("drive");
  const key = await newKey();
  const result = await createSyncSnapshot({ source, destination, key, now: at(0) });
  const paths = Object.keys((await readSnapshot(destination, key, result.name)).files).sort();
  assert.deepEqual(paths, [
    "clients/c1/declarations/2026-09/declaration.json",
    "clients/c1/declarations/2026-09/draft-table.json",
    IMAGE,
    PDF,
    "clients/c1/rules.md",
    "clients/c1/workspace.json",
    "common/agent-runs/run-1.json",
    "inbox/_unsorted/scan.pdf",
  ]);
  assert.equal(result.files, 8);
  assert.deepEqual(result.skipped, []);
});

test("sync snapshot: the other PC restores every image byte for byte", async () => {
  const source = await sampleRoot();
  const destination = binaryDirectory("drive");
  const key = await newKey();
  const { name } = await createSyncSnapshot({ source, destination, key, now: at(0) });
  const target = binaryDirectory("other-pc");
  await restoreSnapshot({ destination, key, name, target });
  assert.deepEqual(await readFileBytes(target, IMAGE), bytes(30000, 1));
  assert.deepEqual(await readFileBytes(target, PDF), bytes(50000, 2));
  assert.ok(!(await listPaths(target)).some((path) => isLocalOnly(path)));
});

test("sync snapshot: an image is written once; a new image adds only its own blob", async () => {
  const source = await sampleRoot();
  const destination = binaryDirectory("drive");
  const key = await newKey();
  const first = await createSyncSnapshot({ source, destination, key, now: at(0) });
  assert.equal(first.newBlobs, 8);
  const again = await createSyncSnapshot({ source, destination, key, now: at(1) });
  assert.deepEqual([again.newBlobs, again.packs], [0, 0]);
  await putFile(source, "clients/c1/declarations/2026-09/images/003.jpg", bytes(20000, 4));
  const added = await createSyncSnapshot({ source, destination, key, now: at(2) });
  assert.deepEqual([added.newBlobs, added.newBytes, added.packs], [1, 20000, 1]);
});

test("sync snapshot: a change in a file of one PC alone adds no blob", async () => {
  const source = await sampleRoot();
  const destination = binaryDirectory("drive");
  const key = await newKey();
  await createSyncSnapshot({ source, destination, key, now: at(0) });
  await putFile(source, "common/ui-settings.json", '{"folderPath":"C:\\\\OTHER"}');
  await putFile(source, `common/${SYNC_STATE_FILE}`, '{"base":"snap-y"}');
  const again = await createSyncSnapshot({ source, destination, key, now: at(1) });
  assert.equal(again.newBlobs, 0);
});

test("isLocalOnly: only the files of one PC and Chrome swap files", () => {
  const local = ["common/sync-state.json", "common/backup-state.json", "common/ui-settings.json", "clients/c1/x.json.crswap"];
  for (const path of local) {
    assert.equal(isLocalOnly(path), true, path);
  }
  for (const path of ["common/agent-runs/r.json", "clients/c1/common/ui-settings.json", "clients/c1/rules.md", IMAGE]) {
    assert.equal(isLocalOnly(path), false, path);
  }
});

test("a plain backup is unchanged: the files of one PC stay in, images only on request", async () => {
  const source = await sampleRoot();
  const destination = binaryDirectory("usb");
  const key = await newKey();
  const { name } = await createBackup({ source, destination, key, now: at(0) });
  const paths = Object.keys((await readSnapshot(destination, key, name)).files);
  assert.ok(paths.includes("common/ui-settings.json"));
  assert.ok(paths.includes("common/backup-state.json"));
  assert.ok(!paths.includes(IMAGE));
});

test("backup with `previous`: the same file list writes no snapshot, a changed one does", async () => {
  const source = await sampleRoot();
  const destination = binaryDirectory("usb");
  const key = await newKey();
  const first = await createBackup({ source, destination, key, now: at(0) });
  assert.equal(first.unchanged, false);
  assert.match(first.digest, /^[0-9a-f]{64}$/);
  const same = await createBackup({ source, destination, key, previous: first.digest, now: at(1) });
  assert.deepEqual([same.unchanged, same.name, same.digest], [true, null, first.digest]);
  assert.equal((await listSnapshots(destination)).length, 1);
  await putFile(source, "clients/c1/rules.md", "- rule\n- another\n");
  const changed = await createBackup({ source, destination, key, previous: first.digest, now: at(2) });
  assert.equal(changed.unchanged, false);
  assert.equal((await listSnapshots(destination)).length, 2);
});

test("push: into annateria-sync of the shared folder, then nothing new until a file changes", async () => {
  const source = await sampleRoot();
  const shared = binaryDirectory("drive");
  const key = await newKey();
  const ticks = [100, 350, 400, 420, 500, 900];
  const clock = () => ticks.shift();
  const first = await pushSnapshot({ source, shared, key, now: at(0), clock });
  assert.deepEqual([first.unchanged, first.files, first.ms], [false, 8, 250]);
  const store = await shared.getDirectoryHandle(SYNC_DIR);
  assert.equal((await listSnapshots(store)).length, 1);
  const state = await readSyncState(source);
  const { lastPush } = state;
  assert.deepEqual([lastPush.name, lastPush.at, lastPush.files, lastPush.ms], [first.name, at(0), 8, 250]);
  const again = await pushSnapshot({ source, shared, key, now: at(1), clock });
  assert.equal(again.unchanged, true);
  assert.equal((await listSnapshots(store)).length, 1);
  assert.equal((await readSyncState(source)).lastPush.at, at(0));
  await putFile(source, "clients/c1/declarations/2026-09/draft-table.json", '{"rows":[1]}');
  const changed = await pushSnapshot({ source, shared, key, now: at(2), clock });
  assert.deepEqual([changed.unchanged, changed.newBytes], [false, 12]);
  assert.equal((await listSnapshots(store)).length, 2);
});

test("push: the state file of the push is not in the snapshot and does not count as a change", async () => {
  const source = await sampleRoot();
  const shared = binaryDirectory("drive");
  const key = await newKey();
  const { name } = await pushSnapshot({ source, shared, key, now: at(0) });
  const files = (await readSnapshot(await shared.getDirectoryHandle(SYNC_DIR), key, name)).files;
  assert.ok(!(`common/${SYNC_STATE_FILE}` in files));
  assert.equal((await pushSnapshot({ source, shared, key, now: at(1) })).unchanged, true);
});

test("push: another shared folder gets its own snapshot although nothing changed", async () => {
  const source = await sampleRoot();
  const key = await newKey();
  await pushSnapshot({ source, shared: binaryDirectory("drive"), key, now: at(0) });
  const other = binaryDirectory("other-drive");
  const result = await pushSnapshot({ source, shared: other, key, now: at(1) });
  assert.equal(result.unchanged, false);
  assert.equal((await listSnapshots(await other.getDirectoryHandle(SYNC_DIR))).length, 1);
});

test("sync state: a damaged or foreign file reads as never pushed", async () => {
  const root = binaryDirectory("data");
  assert.deepEqual(await readSyncState(root), { schemaVersion: 1, lastPush: null });
  await putFile(root, `common/${SYNC_STATE_FILE}`, "{not json");
  assert.equal((await readSyncState(root)).lastPush, null);
  await putFile(root, `common/${SYNC_STATE_FILE}`, '{"lastPush":{"name":"x","at":"yesterday","digest":"d"}}');
  assert.equal((await readSyncState(root)).lastPush, null);
});
