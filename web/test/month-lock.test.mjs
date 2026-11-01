// Step 9.3: one sweep closes every open month of the data root but the one the user is in; the first sweep copies before it closes.
import test from "node:test";
import assert from "node:assert/strict";
import { createDeclaration, finalizeDeclaration, loadDeclaration, readClosedHistory, saveDraft } from "../declaration-store.js";
import { NO_EXPORT_MARKER } from "../declaration-core.js";
import { DECLARATION_COPY, HISTORY_COPY, MONTH_LOCK_FILE, closeOpenMonths } from "../month-lock.js";
import { binaryDirectory } from "./memory-binary-directory.mjs";

const row = (active) => ({ active, values: ["01/02/26"] });
const text = async (directory, name) => (await (await directory.getFileHandle(name)).getFile()).text();
const exists = (directory, name) => directory.getFileHandle(name).then(() => true, () => false);
const where = ({ client, month }) => `${client} ${month}`;

// months: [[month, rows, "closed"?]]; resolves with the client folder inside root/clients/.
async function client(root, id, months) {
  const directory = await (await root.getDirectoryHandle("clients", { create: true })).getDirectoryHandle(id, { create: true });
  for (const [month, rows, state = "open"] of months) {
    const created = await createDeclaration(directory, { clientId: id, month });
    await saveDraft(created.directory, created.declaration, rows);
    if (state === "closed") {
      await finalizeDeclaration({ clientDirectory: directory, declarationDirectory: created.directory, declaration: created.declaration, finalExport: NO_EXPORT_MARKER, rows });
    }
  }
  return directory;
}
const declarationOf = async (directory, month) => (await loadDeclaration(directory, month)).declaration;

test("every open month is closed but the kept one, closed months stay as they are, the active rows go into the history", async () => {
  const root = binaryDirectory("root");
  const a = await client(root, "a", [["2026-01", [row(true)], "closed"], ["2026-02", [row(true), row(false)]], ["2026-03", []]]);
  const b = await client(root, "b", [["2026-02", [row(true)]]]);
  const before = await declarationOf(a, "2026-01");
  const keep = (await declarationOf(b, "2026-02")).declarationId;
  const { closed, failed } = await closeOpenMonths({ root, keep });
  assert.deepEqual(failed, []);
  assert.deepEqual(closed.map(where).sort(), ["a 2026-02", "a 2026-03"]);
  const states = [await declarationOf(a, "2026-02"), await declarationOf(a, "2026-03"), await declarationOf(b, "2026-02")].map((item) => item.status);
  assert.deepEqual(states, ["closed", "closed", "open"]);
  assert.deepEqual(await declarationOf(a, "2026-01"), before, "a closed month is not touched");
  const history = await readClosedHistory(a);
  assert.deepEqual(history.map((entry) => entry.declarationMonth), ["2026-01", "2026-02"], "an empty month closes too, adding nothing");
  assert.equal(history.length, 2, "only the active row of 2026-02");
});

test("the first sweep copies each month and the history once, then records the migration and copies no more", async () => {
  const root = binaryDirectory("root");
  const a = await client(root, "a", [["2026-01", [row(true)], "closed"], ["2026-02", [row(true)]]]);
  const historyBefore = await text(a, "history.jsonl");
  const monthDirectory = (await loadDeclaration(a, "2026-02")).directory;
  const declarationBefore = await text(monthDirectory, "declaration.json");
  await closeOpenMonths({ root, now: "2026-11-01T10:00:00.000Z" });
  assert.equal(await text(monthDirectory, DECLARATION_COPY), declarationBefore);
  assert.equal(await text(a, HISTORY_COPY), historyBefore);
  const marker = JSON.parse(await text(await root.getDirectoryHandle("common"), MONTH_LOCK_FILE));
  assert.deepEqual(marker, { version: 1, migratedAt: "2026-11-01T10:00:00.000Z" });
  const later = await createDeclaration(a, { clientId: "a", month: "2026-03" });
  const { closed } = await closeOpenMonths({ root });
  assert.deepEqual(closed.map(where), ["a 2026-03"]);
  assert.equal(await exists(later.directory, DECLARATION_COPY), false, "after the migration a month is closed without a copy");
  assert.equal(await text(a, HISTORY_COPY), historyBefore, "the copy of the history is never overwritten");
});

test("a month that fails is reported, the rest is closed, and the migration stays open", async () => {
  const root = binaryDirectory("root");
  const a = await client(root, "a", [["2026-02", [row(true)]], ["2026-03", [row(true)]]]);
  const broken = (await loadDeclaration(a, "2026-03")).directory;
  const writable = await (await broken.getFileHandle("draft-table.json")).createWritable();
  await writable.write("{ not json");
  await writable.close();
  await client(root, "b", [["2026-02", [row(true)]]]);
  const { closed, failed } = await closeOpenMonths({ root });
  assert.deepEqual(failed.map(where), ["a 2026-03"]);
  assert.deepEqual(closed.map(where).sort(), ["a 2026-02", "b 2026-02"]);
  assert.equal(await exists(root, "common"), false, "no marker while a month failed");
});

test("a data root without clients is swept without an error", async () => {
  assert.deepEqual(await closeOpenMonths({ root: binaryDirectory("root") }), { closed: [], failed: [] });
});
