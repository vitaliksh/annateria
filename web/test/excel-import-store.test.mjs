import test from "node:test";
import assert from "node:assert/strict";
import { SEED_CHART_OF_ACCOUNTS, matchClassNames, normaliseChart } from "../chart-of-accounts.js";
import { buildImportedRows } from "../excel-import.js";
import { importRowsIntoDeclaration, inspectImportTarget } from "../excel-import-store.js";
import { parseJournalGrid } from "../excel-journal.js";
import { createDeclaration, listDeclarations, loadDeclaration, finalizeDeclaration, reopenLockedDeclaration } from "../declaration-store.js";
import { buildJournalGrid } from "./excel-journal-fixture.mjs";
import { memoryDirectory } from "./memory-directory.mjs";

const accounts = normaliseChart({ accounts: SEED_CHART_OF_ACCOUNTS });
const parsed = parseJournalGrid(buildJournalGrid()).rows;
const rows = () => buildImportedRows(parsed, matchClassNames(parsed.map((r) => r.classificationName), accounts).codes);
const now = "2026-10-02T10:00:00.000Z";

test("импорт в декларацию: новая открытая декларация получает строки черновика", async () => {
  const client = memoryDirectory("client");
  const declaration = await importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-01", rows: rows(), now });
  assert.equal(declaration.status, "open");
  const loaded = await loadDeclaration(client, "2026-01");
  assert.equal(loaded.draft.rows.length, 8);
  assert.equal(loaded.draft.rows[0].values[1], "203");
});

test("импорт в декларацию: пустая открытая декларация используется, а не создаётся заново", async () => {
  const client = memoryDirectory("client");
  const { declaration } = await createDeclaration(client, { clientId: "c1", month: "2026-02" });
  const result = await importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-02", rows: rows(), now });
  assert.equal(result.declarationId, declaration.declarationId);
  assert.equal((await loadDeclaration(client, "2026-02")).draft.rows.length, 8);
});

test("импорт в декларацию: «закрыть сразу» закрывает без папки экспорта и пишет историю один раз", async () => {
  const client = memoryDirectory("client");
  const closed = await importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-03", rows: rows(), closeNow: true, now });
  assert.deepEqual([closed.status, closed.finalExport], ["closed", "excel-import"]);
  const history = client.children.get("history.jsonl").text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(history.length, 8);
  assert.ok(history.every((entry) => entry.declarationId === closed.declarationId && entry.declarationMonth === "2026-03"));
  assert.equal((await listDeclarations(client))[0].directory.children.get("exports").children.size, 0);
});

test("импорт в декларацию: непустая или закрытая декларация не перезаписывается", async () => {
  const client = memoryDirectory("client");
  await importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-04", rows: rows(), now });
  await assert.rejects(
    importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-04", rows: rows(), now }),
    /כבר מכילה שורות/,
  );
  await importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-05", rows: rows(), closeNow: true, now });
  await assert.rejects(
    importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-05", rows: rows(), now }),
    /נעולה/,
  );
  assert.equal((await loadDeclaration(client, "2026-04")).draft.rows.length, 8);
});

test("импорт в декларацию: пустой набор строк отвергается", async () => {
  await assert.rejects(
    importRowsIntoDeclaration({ clientDirectory: memoryDirectory("c"), clientId: "c1", month: "2026-06", rows: [], now }),
    /אין שורות/,
  );
});

test("импорт в декларацию: осмотр месяца различает отсутствует, пустая, со строками и закрыта", async () => {
  const client = memoryDirectory("client");
  assert.deepEqual(await inspectImportTarget(client, "2026-01"), { state: "missing", count: 0 });
  await createDeclaration(client, { clientId: "c1", month: "2026-02" });
  assert.deepEqual(await inspectImportTarget(client, "2026-02"), { state: "empty", count: 0 });
  await importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-03", rows: rows(), now });
  assert.deepEqual(await inspectImportTarget(client, "2026-03"), { state: "rows", count: 8 });
  await importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-04", rows: rows(), closeNow: true, now });
  assert.equal((await inspectImportTarget(client, "2026-04")).state, "closed");
});

test("импорт в декларацию: замена сохраняет копию старой таблицы, закрытая декларация не заменяется", async () => {
  const client = memoryDirectory("client");
  await importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-05", rows: rows(), now });
  const fewer = rows().slice(0, 3);
  await importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-05", rows: fewer, replace: true, now });
  assert.equal((await loadDeclaration(client, "2026-05")).draft.rows.length, 3);
  const directory = (await client.getDirectoryHandle("declarations")).children.get("2026-05");
  const [backup] = [...directory.children.keys()].filter((name) => name.startsWith("draft-table.before-import-"));
  assert.equal(JSON.parse(directory.children.get(backup).text).rows.length, 8);
  await importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-06", rows: rows(), closeNow: true, now });
  await assert.rejects(
    importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-06", rows: rows(), replace: true, now }),
    /נעולה/,
  );
});

test("reopen removes the history of the declaration and locking again does not duplicate it", async () => {
  const client = memoryDirectory("client");
  const closed = await importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-05", rows: rows(), closeNow: true, now });
  const other = await importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-06", rows: rows(), closeNow: true, now });
  const entries = () => client.children.get("history.jsonl").text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(entries().length, 16);
  const directory = (await listDeclarations(client)).find((item) => item.declaration.declarationId === closed.declarationId).directory;
  const reopened = await reopenLockedDeclaration({ clientDirectory: client, declarationDirectory: directory, declaration: closed, reason: "fix", now });
  assert.equal(reopened.status, "open");
  assert.deepEqual(entries().map((entry) => entry.declarationId), Array(8).fill(other.declarationId));
  const draft = (await loadDeclaration(client, "2026-05")).draft;
  await finalizeDeclaration({ clientDirectory: client, declarationDirectory: directory, declaration: reopened, finalExport: "no-export", rows: draft.rows.map((row) => ({ ...row, active: true })), now });
  assert.equal(entries().filter((entry) => entry.declarationId === closed.declarationId).length, 8);
  assert.equal(entries().length, 16);
});
