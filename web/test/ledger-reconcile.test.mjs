import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { SEED_CHART_OF_ACCOUNTS, matchClassNames, normaliseChart, saveClientChart } from "../chart-of-accounts.js";
import { loadDeclaration } from "../declaration-store.js";
import { buildImportedRows } from "../excel-import.js";
import { importRowsIntoDeclaration } from "../excel-import-store.js";
import { parseJournalGrid } from "../excel-journal.js";
import { ledgerOperations, reconcile } from "../ledger-reconcile.js";
import { commitReconcile, prepareReconcile } from "../ledger-reconcile-flow.js";
import { buildJournalGrid, SAMPLE_ROWS } from "./excel-journal-fixture.mjs";
import { ledgerRowsGrid } from "./ledger-fixture.mjs";
import { memoryDirectory } from "./memory-directory.mjs";

const NOW = "2026-10-06T10:00:00.000Z";
const chart = normaliseChart({ accounts: SEED_CHART_OF_ACCOUNTS });
const codeOf = Object.fromEntries(Object.entries(chart).map(([code, account]) => [account.name, code]));

// The ledger of the sample journal: one block per class, expenses negative, credits positive, all in declaration 01/2026.
function sampleBlocks(extra = {}) {
  const classes = new Map();
  for (const sample of SAMPLE_ROWS) {
    const iso = new Date(Date.UTC(1899, 11, 30) + sample.date * 86400000).toISOString().slice(0, 10);
    const sign = (sample.kind === "income" ? 1 : -1) * (sample.kind === "credit" ? -1 : 1);
    const net = sign * sample.net;
    const vat = sign * sample.vat;
    if (!classes.has(sample.cls)) classes.set(sample.cls, []);
    const rows = classes.get(sample.cls);
    rows.push({ month: 1, line: String(rows.length + 1), date: iso, details: sample.details, ref1: sample.ref1, gross: Math.round((net + vat) * 100) / 100, net, vat });
  }
  const blocks = [...classes].map(([name, rows]) => {
    const type = chart[codeOf[name]].type;
    return { section: type === "income" ? "הכנסות" : type === "equipment" ? "לא משתתף" : "הוצאות הנהלה וכלליות", code: codeOf[name], name, rows: [...rows, ...(extra[name] ?? [])] };
  });
  return blocks;
}
const MISSING_ROW = { month: 1, line: "99", date: "2026-01-20", details: "Water bill", ref1: "4455", gross: -118, net: -100, vat: -18 };

async function client({ close = false } = {}) {
  const directory = memoryDirectory("client");
  const config = { clientId: "c1", clientName: "Eva" };
  await saveClientChart(directory, chart);
  const parsed = parseJournalGrid(buildJournalGrid()).rows;
  const rows = buildImportedRows(parsed, matchClassNames(parsed.map((r) => r.classificationName), chart).codes);
  await importRowsIntoDeclaration({ clientDirectory: directory, clientId: "c1", month: "2026-01", rows, closeNow: close, now: NOW });
  return { directory, config };
}
function ledgerFile(blocks) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(ledgerRowsGrid(blocks)), "גיליון2");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return { name: "כרטסת.xlsx", size: bytes.byteLength, arrayBuffer: async () => bytes };
}
const options = (c) => ({ dataRoot: memoryDirectory("root"), client: c, loadLibrary: async () => XLSX });

test("сверка: знаки приводятся к знакам деклараций — расход положителен, кредит отрицателен, доход как есть", () => {
  const operations = ledgerOperations({ year: 2026, blocks: sampleBlocks() });
  const byName = (name) => operations.filter((operation) => operation.name === name);
  assert.deepEqual([byName("אחזקה")[0].net, byName("אחזקה")[0].vat, byName("אחזקה")[0].gross], [100, 18, 118]);
  assert.deepEqual([byName("אחזקה")[1].net, byName("אחזקה")[1].vat], [-20, -3.6], "credit note");
  assert.deepEqual([byName("הכנסות")[0].net, byName("הכנסות")[0].income], [10000, true]);
  assert.equal(operations.length, SAMPLE_ROWS.length);
});

test("сверка: пары находятся по месяцу, классу, дате и суммам; повторы считаются; лишнее и недостающее разделяются", () => {
  const operations = ledgerOperations({ year: 2026, blocks: sampleBlocks({ "אחזקה": [MISSING_ROW, { ...MISSING_ROW, line: "100" }] }) });
  const row = (name, date, net, gross, vat = 0) => ({ active: true, values: [date, codeOf[name], "", "", "", "", "", String(gross), String(net), String(vat)] });
  const declarations = [{ month: "2026-01", rows: [row("אחזקה", "01/01/26", 100, 118, 18), row("אחזקה", "20/01/26", 100, 118, 18), row("מים", "05/01/26", 1, 1)] }];
  const result = reconcile(operations, declarations, chart);
  assert.equal(result.matched, 2, "the first of two identical operations is matched, the second is missing");
  assert.equal(result.missing.filter((operation) => operation.details === "Water bill").length, 1);
  assert.deepEqual(result.extra.map((item) => item.name), ["מים"]);
});

test("сверка: пропущенные операции предлагаются и добавляются в открытую декларацию с копией таблицы, повторная сверка чиста", async () => {
  const c = await client();
  const file = ledgerFile(sampleBlocks({ "אחזקה": [MISSING_ROW] }));
  const prepared = await prepareReconcile(file, options(c));
  assert.deepEqual([prepared.operations, prepared.matched, prepared.missing.length, prepared.extra.length], [SAMPLE_ROWS.length + 1, SAMPLE_ROWS.length, 1, 0]);
  assert.equal(prepared.missing[0].problem, null);
  const before = (await loadDeclaration(c.directory, "2026-01")).draft.rows;
  const result = await commitReconcile(prepared, { selected: new Set([0]), client: c, now: NOW });
  assert.deepEqual(result, { added: 1, months: ["2026-01"] });
  const after = (await loadDeclaration(c.directory, "2026-01")).draft.rows;
  assert.equal(after.length, before.length + 1);
  const added = after.at(-1);
  assert.deepEqual([added.values[0], added.values[1], added.values[3], added.values[7], added.values[8], added.values[9]], ["20/01/26", "203", "Water bill", "118.00", "100.00", "18.00"]);
  assert.equal(added.statusText, "נוסף מהכרטסת");
  const folder = (await (await c.directory.getDirectoryHandle("declarations")).getDirectoryHandle("2026-01")).children;
  assert.equal([...folder.keys()].filter((name) => name.startsWith("draft-table.before-ledger-")).length, 1);
  const again = await prepareReconcile(file, options(c));
  assert.deepEqual([again.matched, again.missing.length, again.extra.length], [SAMPLE_ROWS.length + 1, 0, 0]);
});

test("сверка: только выбранные операции добавляются; закрытая декларация и класс без кода блокируются; нет декларации — создаётся", async () => {
  const c = await client();
  const other = { ...MISSING_ROW, line: "98", details: "Other", month: 4, date: "2026-04-10" };
  const blocks = sampleBlocks({ "אחזקה": [MISSING_ROW, other] });
  blocks.push({ section: "הוצאות הנהלה וכלליות", code: "777", name: "ספרים", rows: [{ ...MISSING_ROW, line: "97", details: "Books" }] });
  const prepared = await prepareReconcile(ledgerFile(blocks), options(c));
  assert.deepEqual(prepared.missing.map((operation) => [operation.details, operation.problem, operation.creates]), [["Water bill", null, false], ["Other", null, true], ["Books", "unknown-class", false]]);
  const result = await commitReconcile(prepared, { selected: new Set([1, 2]), client: c, now: NOW });
  assert.deepEqual(result, { added: 1, months: ["2026-04"] }, "the blocked operation is skipped");
  assert.equal((await loadDeclaration(c.directory, "2026-04")).draft.rows.length, 1);
  assert.equal((await loadDeclaration(c.directory, "2026-01")).draft.rows.length, SAMPLE_ROWS.length);
  const locked = await client({ close: true });
  const lockedPrepared = await prepareReconcile(ledgerFile(sampleBlocks({ "אחזקה": [MISSING_ROW] })), options(locked));
  assert.equal(lockedPrepared.missing[0].problem, "locked");
  const none = await commitReconcile(lockedPrepared, { selected: new Set([0]), client: locked, now: NOW });
  assert.deepEqual(none, { added: 0, months: [] });
});

test("сверка: дата входит в ключ — те же суммы с другой датой считаются недостающими", async () => {
  const c = await client();
  const nextDay = (iso) => new Date(Date.parse(iso) + 86400000).toISOString().slice(0, 10);
  const shifted = sampleBlocks().map((block) => ({ ...block, rows: block.rows.map((row) => ({ ...row, date: nextDay(row.date) })) }));
  const prepared = await prepareReconcile(ledgerFile(shifted), options(c));
  assert.deepEqual([prepared.matched, prepared.missing.length, prepared.extra.length], [0, SAMPLE_ROWS.length, SAMPLE_ROWS.length]);
});
