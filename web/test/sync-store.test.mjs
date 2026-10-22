import test from "node:test";
import assert from "node:assert/strict";
import { createBackup, keyFromRecoveryCode, newRecoveryCode, readSnapshot, restoreSnapshot } from "../backup-store.js";
import { SYNC_STATE_FILE, createSyncSnapshot, isLocalOnly } from "../sync-store.js";
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
  for (const path of ["common/sync-state.json", "common/backup-state.json", "common/ui-settings.json", "clients/c1/x.json.crswap"]) {
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
