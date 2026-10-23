import test from "node:test";
import assert from "node:assert/strict";
import { keyFromRecoveryCode, listSnapshots, newRecoveryCode } from "../backup-store.js";
import {
  BEFORE_PREFIX, SYNC_DIR, SYNC_STATE_FILE, copyToTake, firstCopyHeld, isLocalOnly, pendingPull, pullSnapshot, pushSnapshot, readSyncState,
  saveSyncState, syncStoreId,
} from "../sync-store.js";
import { binaryDirectory, listPaths, putFile, readFileBytes } from "./memory-binary-directory.mjs";

const text = (bytes) => new TextDecoder().decode(bytes);
const at = (minute) => `2026-10-23T09:${String(minute).padStart(2, "0")}:00.000Z`;
const newKey = () => keyFromRecoveryCode(newRecoveryCode());
const DRAFT = "clients/c1/declarations/2026-10/draft-table.json";
const IMAGE = "clients/c1/declarations/2026-10/images/002.jpg";

// Device A edited a row and filed a new image; device B still has the day before, plus a file A has moved away,
// its own settings, a legacy export and the copies of an earlier pull.
async function twoDevices() {
  const a = binaryDirectory("A");
  const b = binaryDirectory("B");
  for (const root of [a, b]) {
    await putFile(root, "clients/c1/workspace.json", '{"name":"synthetic"}');
    await putFile(root, "clients/c1/declarations/2026-10/declaration.json", '{"status":"open"}');
  }
  await putFile(a, DRAFT, '{"rows":[1,2]}');
  await putFile(a, IMAGE, Uint8Array.from({ length: 3000 }, (_, i) => i & 255));
  await putFile(a, "common/ui-settings.json", '{"folderPath":"A"}');
  await putFile(b, DRAFT, '{"rows":[1]}');
  await putFile(b, "inbox/_unsorted/scan.pdf", "moved away on A");
  await putFile(b, "common/ui-settings.json", '{"folderPath":"B"}');
  await putFile(b, "clients/c1/declarations/2026-10/exports/2026-10-01_10-00/import.txt", "legacy");
  await putFile(b, "common/sync-before-20261001T000000Z/old.json", "kept");
  const shared = binaryDirectory("drive");
  const key = await newKey();
  const pushed = await pushSnapshot({ source: a, shared, key, now: at(0) });
  return { a, b, shared, key, name: pushed.name };
}

test("pull: B becomes A's data; local settings, exports and earlier copies stay; replaced and removed files are kept", async () => {
  const { a, b, shared, key, name } = await twoDevices();
  const result = await pullSnapshot({ root: b, shared, key, name, now: at(5) });
  assert.deepEqual([result.applied, result.written, result.removed], [true, 2, 1]);
  assert.equal(result.before, `${BEFORE_PREFIX}20261023T090500Z`);
  for (const path of [DRAFT, IMAGE, "clients/c1/workspace.json"]) {
    assert.deepEqual(await readFileBytes(b, path), await readFileBytes(a, path), path);
  }
  const paths = await listPaths(b);
  assert.ok(!paths.includes("inbox/_unsorted/scan.pdf"));
  assert.equal(text(await readFileBytes(b, "common/ui-settings.json")), '{"folderPath":"B"}');
  assert.ok(paths.includes("clients/c1/declarations/2026-10/exports/2026-10-01_10-00/import.txt"));
  assert.equal(text(await readFileBytes(b, "common/sync-before-20261001T000000Z/old.json")), "kept");
  assert.equal(text(await readFileBytes(b, `${result.before}/${DRAFT}`)), '{"rows":[1]}');
  assert.equal(text(await readFileBytes(b, `${result.before}/inbox/_unsorted/scan.pdf`)), "moved away on A");
  const state = await readSyncState(b);
  assert.deepEqual([state.lastPush.name, state.applying], [name, null]);
});

test("pull: afterwards B's next push writes nothing, and a real edit on B is pushed", async () => {
  const { b, shared, key, name } = await twoDevices();
  await pullSnapshot({ root: b, shared, key, name, now: at(5) });
  const again = await pushSnapshot({ source: b, shared, key, now: at(6) });
  assert.equal(again.unchanged, true);
  await putFile(b, DRAFT, '{"rows":[1,2,3]}');
  assert.equal((await pushSnapshot({ source: b, shared, key, now: at(7) })).unchanged, false);
  assert.equal((await listSnapshots(await shared.getDirectoryHandle(SYNC_DIR))).length, 2);
});

test("pull: a copy that has not fully arrived changes nothing and says why", async () => {
  const { b, shared, key, name } = await twoDevices();
  const packs = await (await (await shared.getDirectoryHandle(SYNC_DIR)).getDirectoryHandle("annateria-backup")).getDirectoryHandle("packs");
  const packName = [...packs.children.keys()].find((item) => item.endsWith(".bin"));
  const full = packs.children.get(packName).bytes;
  packs.children.get(packName).bytes = full.slice(0, 100);
  const before = await listPaths(b);
  assert.deepEqual(await pullSnapshot({ root: b, shared, key, name, now: at(5) }), { applied: false, reason: "incomplete" });
  packs.children.delete(packName);
  assert.deepEqual(await pullSnapshot({ root: b, shared, key, name, now: at(6) }), { applied: false, reason: "missing" });
  assert.deepEqual(await pullSnapshot({ root: b, shared: binaryDirectory("empty"), key, name, now: at(6) }), {
    applied: false, reason: "missing",
  });
  assert.deepEqual(await listPaths(b), before);
  assert.equal((await readSyncState(b)).applying, null);
  packs.children.set(packName, { kind: "file", bytes: full });
  assert.equal((await pullSnapshot({ root: b, shared, key, name, now: at(7) })).applied, true);
});

test("pull: another recovery key is told apart from a copy on its way", async () => {
  const { b, shared, name } = await twoDevices();
  assert.deepEqual(await pullSnapshot({ root: b, shared, key: await newKey(), name, now: at(5) }), { applied: false, reason: "key" });
});

test("pull: an interrupted pull is finished with the same folder of copies, and the first copy is never overwritten", async () => {
  const { a, b, shared, key, name } = await twoDevices();
  const before = `${BEFORE_PREFIX}20261023T090100Z`;
  await saveSyncState(b, { applying: { name, before } });
  await putFile(b, `${before}/${DRAFT}`, '{"rows":["the true old version"]}');
  await putFile(b, DRAFT, '{"rows":["half written"]}');
  const result = await pullSnapshot({ root: b, shared, key, name, now: at(9) });
  assert.equal(result.before, before);
  assert.deepEqual(await readFileBytes(b, DRAFT), await readFileBytes(a, DRAFT));
  assert.equal(text(await readFileBytes(b, `${before}/${DRAFT}`)), '{"rows":["the true old version"]}');
  assert.equal((await readSyncState(b)).applying, null);
});

test("pendingPull: an interrupted pull first, then another device's copy this PC does not have yet", () => {
  const empty = { lastPush: null, applying: null };
  assert.equal(pendingPull(empty, null, "me"), null);
  assert.equal(pendingPull(empty, { name: "snap-a.bin", device: "me" }, "me"), null);
  assert.equal(pendingPull(empty, { name: "snap-a.bin", device: "other" }, "me"), "snap-a.bin");
  assert.equal(pendingPull({ lastPush: { name: "snap-a.bin" }, applying: null }, { name: "snap-a.bin", device: "other" }, "me"), null);
  assert.equal(pendingPull({ lastPush: null, applying: { name: "snap-b.bin" } }, { name: "snap-a.bin", device: "me" }, "me"), "snap-b.bin");
});

test("the copies of a pull and the sync state never travel", () => {
  assert.equal(isLocalOnly(`${BEFORE_PREFIX}20261023T090000Z/clients/c1/x.json`), true);
  assert.equal(isLocalOnly(`common/${SYNC_STATE_FILE}`), true);
  assert.equal(isLocalOnly("common/sync-before.json"), false);
});

// The owner's PC, 23 October 2026: the page saved its open table (loaded before the copy arrived) over the new files.
test("pull: the page closes its open table before the first write, and only when the copy is whole", async () => {
  const { a, b, shared, key, name } = await twoDevices();
  const seen = [];
  const beforeWrite = async () => { seen.push(text(await readFileBytes(b, DRAFT))); };
  const packs = await (await (await shared.getDirectoryHandle(SYNC_DIR)).getDirectoryHandle("annateria-backup")).getDirectoryHandle("packs");
  const packName = [...packs.children.keys()].find((item) => item.endsWith(".bin"));
  const full = packs.children.get(packName).bytes;
  packs.children.get(packName).bytes = full.slice(0, 50);
  assert.equal((await pullSnapshot({ root: b, shared, key, name, now: at(5), beforeWrite })).applied, false);
  assert.deepEqual(seen, []);
  packs.children.get(packName).bytes = full;
  assert.equal((await pullSnapshot({ root: b, shared, key, name, now: at(6), beforeWrite })).applied, true);
  assert.deepEqual(seen, ['{"rows":[1]}']);
  assert.deepEqual(await readFileBytes(b, DRAFT), await readFileBytes(a, DRAFT));
});

// 7.4, before the visit to Anna: the baton named a copy of the test folder, and a PC with a new shared folder waited for it.
test("copyToTake: a copy of another store, or no store here, is nothing to wait for; an unreadable folder is", () => {
  const state = { lastPush: { name: "snap-mine.bin" }, applying: null };
  const copy = { name: "snap-theirs.bin", device: "other", store: "aaaaaaaaaaaaaaaa" };
  const take = (where, extra = {}) => copyToTake({ state, snapshot: copy, device: "me", where, ...extra });
  assert.equal(take({ ok: true, id: "aaaaaaaaaaaaaaaa" }), "snap-theirs.bin");
  assert.equal(take({ ok: true, id: "bbbbbbbbbbbbbbbb" }), null);
  assert.equal(take({ ok: true, id: null }), null);
  assert.equal(take({ ok: false }), "snap-theirs.bin");
  assert.equal(copyToTake({ state, snapshot: { ...copy, store: undefined }, device: "me", where: { ok: true, id: "aaaaaaaaaaaaaaaa" } }), null,
    "a record from before the store id names no store");
  assert.equal(copyToTake({ state: null, snapshot: copy, device: "me", where: { ok: false } }), "snap-theirs.bin");
  assert.equal(copyToTake({ state: { lastPush: null, applying: { name: "snap-half.bin" } }, snapshot: null, device: "me", where: { ok: true, id: null } }),
    "snap-half.bin");
});

test("firstCopyHeld: the first copy waits while the other device's store has not reached this folder, unless clicked", () => {
  const copy = { name: "snap-theirs.bin", device: "other", store: "aaaaaaaaaaaaaaaa" };
  assert.equal(firstCopyHeld({ snapshot: copy, device: "me", where: { ok: true, id: null }, interactive: false }), true);
  assert.equal(firstCopyHeld({ snapshot: copy, device: "me", where: { ok: true, id: null }, interactive: true }), false);
  assert.equal(firstCopyHeld({ snapshot: copy, device: "me", where: { ok: true, id: "aaaaaaaaaaaaaaaa" }, interactive: false }), false);
  assert.equal(firstCopyHeld({ snapshot: { ...copy, store: null }, device: "me", where: { ok: true, id: null }, interactive: false }), false);
  assert.equal(firstCopyHeld({ snapshot: { ...copy, device: "me" }, device: "me", where: { ok: true, id: null }, interactive: false }), false);
});

test("syncStoreId: null for an empty shared folder, the store's id after the first push", async () => {
  const { a, key } = await twoDevices();
  const shared = binaryDirectory("new-folder");
  assert.equal(await syncStoreId(shared), null);
  await pushSnapshot({ source: a, shared, key, now: at(1) });
  assert.match(await syncStoreId(shared), /^[0-9a-f]{16}$/);
});

// The rollout on 23 October 2026: Anna's PC began with an empty data folder and sent an empty copy; taking it would have
// emptied Vitalik's PC (everything into sync-before). An empty copy carries nothing: it is never written, only counted as taken.
test("pull: an empty copy is never written; it counts as taken and the next push sends this PC's data", async () => {
  const { a, shared, key } = await twoDevices();
  const empty = binaryDirectory("Anna-new");
  await empty.getDirectoryHandle("clients", { create: true });
  const emptyCopy = await pushSnapshot({ source: empty, shared, key, now: at(2) });
  assert.equal(emptyCopy.files, 0);
  const before = await listPaths(a);
  let closed = 0;
  const result = await pullSnapshot({ root: a, shared, key, name: emptyCopy.name, now: at(3), beforeWrite: async () => { closed += 1; } });
  assert.deepEqual([result.applied, result.empty, result.written, result.removed, closed], [true, true, 0, 0, 0]);
  assert.deepEqual(await listPaths(a), before);
  assert.equal(pendingPull(await readSyncState(a), { name: emptyCopy.name, device: "anna" }, "vitalik"), null);
  const pushed = await pushSnapshot({ source: a, shared, key, now: at(4) });
  assert.equal(pushed.unchanged, false);
  assert.ok(pushed.files > 0);
});
