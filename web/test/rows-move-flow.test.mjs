import test from "node:test";
import assert from "node:assert/strict";
import { createDeclaration, finalizeDeclaration, loadDeclaration, saveDraft, saveSourceImage } from "../declaration-store.js";
import { commitMove, prepareMove } from "../rows-move-flow.js";
import { binaryDirectory, listPaths, readFileBytes } from "./memory-binary-directory.mjs";

const today = new Date(2026, 9, 7);
const NOW = "2026-10-07T10:00:00.000Z";
const client = () => ({ directory: binaryDirectory("client"), config: { clientId: "c1" } });
const bytes = (...values) => new Uint8Array(values);

// A photo row as the intake creates it (documentId without the "import-" prefix).
const photoRow = (id, date, gross, imageFile, imageIndex, extra = {}) => ({
  documentId: id,
  imageIndex,
  imageFile,
  receivedAt: NOW,
  values: [date, "202", "ספק לדוגמה", "ספק לדוגמה", "", "123", "", gross.toFixed(2), (gross / 1.18).toFixed(2), (gross - gross / 1.18).toFixed(2), "100", "100"],
  active: true,
  ...extra,
});
const excelRow = (id, date, gross) => ({ ...photoRow(id, date, gross, "", 0), documentId: id });

async function setup({ closed = ["2026-08"], rows = [], extraDeclarations = [] } = {}) {
  const c = client();
  for (const month of closed) {
    const created = await createDeclaration(c.directory, { clientId: "c1", month });
    await saveDraft(created.directory, created.declaration, [excelRow(`import-${month}`, `10/${month.slice(5)}/26`, 118)], NOW);
    await finalizeDeclaration({ clientDirectory: c.directory, declarationDirectory: created.directory, declaration: created.declaration, finalExport: "excel-import", rows: [excelRow(`import-${month}`, "10/08/26", 118)], now: NOW });
  }
  const current = await createDeclaration(c.directory, { clientId: "c1", month: "2026-09" });
  await saveDraft(current.directory, current.declaration, rows, NOW);
  for (const extra of extraDeclarations) {
    const created = await createDeclaration(c.directory, { clientId: "c1", month: extra.month });
    await saveDraft(created.directory, created.declaration, extra.rows, NOW);
  }
  await saveSourceImage(current.directory, "001.jpg", bytes(1, 1, 1));
  await saveSourceImage(current.directory, "002.jpg", bytes(2, 2, 2));
  return { c, current };
}

const sampleRows = () => [
  photoRow("doc-a", "23/09/26", 118, "001.jpg", 1),
  photoRow("doc-b", "26/08/26", 236, "002.jpg", 2),
  photoRow("doc-b", "26/08/26", 59, "002.jpg", 2),
  photoRow("doc-c", "05/10/26", 118, "", 0),
  excelRow("import-1-x", "14/05/26", 100),
  photoRow("doc-d", "", 50, "", 0),
];

test("prepare proposes a month for photo rows by their date, past filed months, and none for Excel rows or missing dates", async () => {
  const { c } = await setup({ rows: sampleRows() });
  const prepared = await prepareMove({ client: c, month: "2026-09", today });
  assert.equal(prepared.lockedThrough, "2026-08");
  assert.deepEqual(prepared.lines.map((line) => [line.proposed, line.reason]), [
    ["2026-09", "date"], ["2026-09", "after-locked"], ["2026-09", "after-locked"], ["2026-10", "date"], [null, "none"], [null, "no-date"],
  ]);
  assert.deepEqual(prepared.months.map((option) => [option.month, option.exists]), [["2026-09", true], ["2026-10", false], ["2026-11", false]]);
  assert.deepEqual(prepared.lines.map((line) => prepared.suggested(line)), ["2026-09", "2026-09", "2026-09", "2026-10", "2026-09", "2026-09"]);
  assert.equal(prepared.deduction(prepared.lines[1], "2027-04"), "late");
});

test("a locked declaration cannot be a source", async () => {
  const { c } = await setup({ rows: [] });
  await assert.rejects(() => prepareMove({ client: c, month: "2026-08", today }), /נעולה/);
});

test("moving rows to a month that does not exist creates it, copies the shared image once and keeps the source image and a copy of the old table", async () => {
  const { c, current } = await setup({ rows: sampleRows() });
  const prepared = await prepareMove({ client: c, month: "2026-09", today });
  const result = await commitMove(prepared, { assignments: new Map([[1, "2026-10"], [2, "2026-10"], [3, "2026-10"]]), client: c, now: NOW });
  assert.deepEqual(result, { moved: 3, months: ["2026-10"] });
  const target = await loadDeclaration(c.directory, "2026-10");
  assert.equal(target.declaration.status, "open");
  assert.deepEqual(target.draft.rows.map((row) => [row.documentId, row.imageFile, row.imageIndex]), [["doc-b", "001.jpg", 1], ["doc-b", "001.jpg", 1], ["doc-c", "", 0]]);
  assert.deepEqual([...(await readFileBytes(target.directory, "images/001.jpg"))], [2, 2, 2]);
  assert.deepEqual((await listPaths(target.directory)).filter((path) => path.startsWith("images/")), ["images/001.jpg"]);
  const source = await loadDeclaration(c.directory, "2026-09");
  assert.deepEqual(source.draft.rows.map((row) => row.documentId), ["doc-a", "import-1-x", "doc-d"]);
  assert.deepEqual([...(await readFileBytes(current.directory, "images/002.jpg"))], [2, 2, 2]);
  const files = await listPaths(source.directory);
  assert.ok(files.some((path) => path.startsWith("draft-table.before-move-")));
});

test("rows moved to an existing open month are appended after its rows with the next free image number, after a copy of its table", async () => {
  const existing = [photoRow("old", "02/10/26", 118, "001.jpg", 1), photoRow("old2", "03/10/26", 118, "004.jpg", 4)];
  const { c } = await setup({ rows: sampleRows(), extraDeclarations: [{ month: "2026-10", rows: existing }] });
  const target0 = await loadDeclaration(c.directory, "2026-10");
  await saveSourceImage(target0.directory, "001.jpg", bytes(9));
  await saveSourceImage(target0.directory, "005.jpg", bytes(9, 9));
  const prepared = await prepareMove({ client: c, month: "2026-09", today });
  await commitMove(prepared, { assignments: new Map([[0, "2026-10"]]), client: c, now: NOW });
  const target = await loadDeclaration(c.directory, "2026-10");
  assert.deepEqual(target.draft.rows.map((row) => [row.documentId, row.imageFile, row.imageIndex]), [["old", "001.jpg", 1], ["old2", "004.jpg", 4], ["doc-a", "006.jpg", 6]]);
  assert.deepEqual([...(await readFileBytes(target.directory, "images/006.jpg"))], [1, 1, 1]);
  assert.deepEqual([...(await readFileBytes(target.directory, "images/001.jpg"))], [9]);
  assert.ok((await listPaths(target.directory)).some((path) => path.startsWith("draft-table.before-move-")));
});

test("rows can be moved to several months in one commit", async () => {
  const { c } = await setup({ rows: sampleRows() });
  const prepared = await prepareMove({ client: c, month: "2026-09", today });
  const result = await commitMove(prepared, { assignments: new Map([[0, "2026-10"], [3, "2026-11"]]), client: c, now: NOW });
  assert.deepEqual(result, { moved: 2, months: ["2026-10", "2026-11"] });
  assert.equal((await loadDeclaration(c.directory, "2026-10")).draft.rows[0].documentId, "doc-a");
  assert.equal((await loadDeclaration(c.directory, "2026-11")).draft.rows[0].documentId, "doc-c");
});

test("a filed month is not a valid target and nothing is written", async () => {
  const { c } = await setup({ rows: sampleRows() });
  const prepared = await prepareMove({ client: c, month: "2026-09", today });
  await assert.rejects(() => commitMove(prepared, { assignments: new Map([[0, "2026-08"]]), client: c, now: NOW }), /נעול/);
  assert.equal((await loadDeclaration(c.directory, "2026-09")).draft.rows.length, 6);
});

test("a table that changed after the dialog was prepared is refused", async () => {
  const { c, current } = await setup({ rows: sampleRows() });
  const prepared = await prepareMove({ client: c, month: "2026-09", today });
  const loaded = await loadDeclaration(c.directory, "2026-09");
  await saveDraft(current.directory, loaded.declaration, loaded.draft.rows.slice(1), NOW);
  await assert.rejects(() => commitMove(prepared, { assignments: new Map([[0, "2026-10"]]), client: c, now: NOW }), /הטבלה השתנתה/);
});

test("a missing image stops the move before any file is written", async () => {
  const { c, current } = await setup({ rows: [photoRow("doc-x", "05/10/26", 118, "009.jpg", 9)] });
  const prepared = await prepareMove({ client: c, month: "2026-09", today });
  await assert.rejects(() => commitMove(prepared, { assignments: new Map([[0, "2026-10"]]), client: c, now: NOW }), /009\.jpg/);
  assert.equal((await loadDeclaration(c.directory, "2026-09")).draft.rows.length, 1);
  await assert.rejects(() => loadDeclaration(c.directory, "2026-10"), { name: "NotFoundError" });
  assert.ok(!(await listPaths(current.directory)).some((path) => path.startsWith("draft-table.before-move-")));
});

test("lines left on the current month change nothing", async () => {
  const { c } = await setup({ rows: sampleRows() });
  const prepared = await prepareMove({ client: c, month: "2026-09", today });
  assert.deepEqual(await commitMove(prepared, { assignments: new Map([[0, "2026-09"]]), client: c, now: NOW }), { moved: 0, months: [] });
});

test("prepare tells which target months already hold a row with the same date, code and amount", async () => {
  const twin = photoRow("twin", "05/10/26", 118, "", 0);
  const { c } = await setup({ rows: [photoRow("doc-c", "05/10/26", 118, "", 0), photoRow("doc-e", "06/10/26", 75, "", 0)], extraDeclarations: [{ month: "2026-10", rows: [twin] }] });
  const prepared = await prepareMove({ client: c, month: "2026-09", today });
  assert.equal(prepared.similar(prepared.lines[0], "2026-10"), true);
  assert.equal(prepared.similar(prepared.lines[0], "2026-11"), false);
  assert.equal(prepared.similar(prepared.lines[1], "2026-10"), false);
});

test("a document for a period of a year is proposed for the month of receipt and has no VAT deduction window of its own", async () => {
  const policy = { ...photoRow("ins", "07/09/25", 941, "", 0), periodFrom: "2025-10-01", periodTo: "2026-09-30", receivedAt: "2026-10-05T10:00:00.000Z" };
  const { c } = await setup({ rows: [policy, photoRow("plain", "07/09/25", 941, "", 0)] });
  const prepared = await prepareMove({ client: c, month: "2026-09", today });
  assert.deepEqual(prepared.lines.map((line) => [line.proposed, line.reason, line.docMonth]), [["2026-10", "period-received", null], ["2026-09", "after-locked", "2025-09"]]);
  assert.equal(prepared.deduction(prepared.lines[0], "2026-10"), "ok");
  assert.equal(prepared.deduction({ ...prepared.lines[1], vat: 1 }, "2026-10"), "late");
});
