import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { SEED_CHART_OF_ACCOUNTS, matchClassNames, normaliseChart, readClientChart, saveChartOfAccounts } from "../chart-of-accounts.js";
import { loadDeclaration } from "../declaration-store.js";
import { buildImportedRows } from "../excel-import.js";
import { importRowsIntoDeclaration } from "../excel-import-store.js";
import { parseJournalGrid } from "../excel-journal.js";
import { commitLedger, prepareLedger, remapImportedRows } from "../ledger-codes-flow.js";
import { buildJournalGrid } from "./excel-journal-fixture.mjs";
import { ledgerGrid } from "./ledger-fixture.mjs";
import { memoryDirectory } from "./memory-directory.mjs";

const NOW = "2026-10-06T10:00:00.000Z";
const loadLibrary = async () => XLSX;
function ledgerFile(sections) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(ledgerGrid(sections)), "גיליון2");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return { name: "כרטסת.xlsx", size: bytes.byteLength, arrayBuffer: async () => bytes };
}
// The sample journal classes under the shared chart (203 אחזקה, 204 חשמל, ...), imported into a client folder.
async function importMonth(client, month, { closeNow = false } = {}) {
  const parsed = parseJournalGrid(buildJournalGrid()).rows;
  const chart = normaliseChart({ accounts: SEED_CHART_OF_ACCOUNTS });
  const rows = buildImportedRows(parsed, matchClassNames(parsed.map((row) => row.classificationName), chart).codes);
  await importRowsIntoDeclaration({ clientDirectory: client.directory, clientId: client.config.clientId, month, rows, closeNow, now: NOW });
}
// A ledger that gives some of those classes other codes than the shared chart does.
const SECTIONS = [
  { title: "הכנסות", accounts: [["110", "הכנסות"]] },
  { title: "הוצאות הנהלה וכלליות", accounts: [["301", "אחזקה"], ["302", "חשמל"], ["303", "חניה פנגו"], ["304", "טלפון סלולרי"], ["305", "ארנונה"]] },
  { title: "לא משתתף", accounts: [["900", "רכישת ציוד/רכוש קבוע"]] },
];
const codesOf = async (client, month) => (await loadDeclaration(client.directory, month)).draft.rows.map((row) => row.values[1]);

test("קודי כרטסת: שורות מיובאות עוברות לקודי הלקוח לפי שם הסיווג, שורות אחרות לא נוגעים", () => {
  const rows = [{ documentId: "import-1-a", values: ["", "203"] }, { documentId: "import-2-b", values: ["", "999"] }, { documentId: "ai-1", values: ["", "203"] }, { documentId: "import-3-c", values: ["", "160"] }];
  const result = remapImportedRows(rows, { 203: { name: "אחזקה" }, 160: { name: "הכנסות" } }, { 301: { name: "אחזקה" }, 160: { name: "הכנסות" } });
  assert.deepEqual(result.rows.map((row) => row.values[1]), ["301", "999", "203", "160"]);
  assert.deepEqual([result.changed, result.unresolved], [1, ["999"]]);
});

test("קודי כרטסת: טעינה כותבת תרשים ללקוח, מעדכנת הצהרות פתוחות עם גיבוי, נעולות רק מדווחות, ושוב — בלי שינוי", async () => {
  const dataRoot = memoryDirectory("root");
  await saveChartOfAccounts(dataRoot, SEED_CHART_OF_ACCOUNTS);
  const client = { directory: memoryDirectory("client"), config: { clientId: "c1" } };
  await importMonth(client, "2026-01");
  await importMonth(client, "2026-02", { closeNow: true });
  const before = await codesOf(client, "2026-01");
  const prepared = await prepareLedger(ledgerFile(SECTIONS), { dataRoot, client, loadLibrary });
  assert.equal(prepared.hadOwnChart, false);
  assert.deepEqual([prepared.plan.months, prepared.plan.locked, prepared.plan.changed], [["2026-01"], ["2026-02"], 7]);
  assert.deepEqual(prepared.plan.unresolved, []);
  assert.equal(prepared.accounts[305].type, "outsideVatBase", "known type of the class carries over");
  assert.deepEqual(await codesOf(client, "2026-01"), before, "preparing writes nothing");
  const result = await commitLedger(prepared, { types: { 304: "equipment" }, client, now: NOW });
  assert.equal(result.chart[304].type, "equipment");
  const after = await codesOf(client, "2026-01");
  assert.ok(after.every((code) => ["110", "301", "302", "303", "304", "305", "900"].includes(code)), after.join());
  assert.deepEqual(await codesOf(client, "2026-02"), before, "a locked declaration keeps its codes");
  const folder = (await (await client.directory.getDirectoryHandle("declarations")).getDirectoryHandle("2026-01")).children;
  const backups = [...folder.keys()].filter((name) => name.startsWith("draft-table.before-codes-"));
  assert.equal(backups.length, 1);
  assert.deepEqual(JSON.parse(folder.get(backups[0]).text).rows.map((row) => row.values[1]), before);
  assert.deepEqual((await readClientChart(client.directory))[301], { name: "אחזקה", type: "expense" });
  const again = await prepareLedger(ledgerFile(SECTIONS), { dataRoot, client, loadLibrary });
  assert.deepEqual([again.hadOwnChart, again.plan.changed, again.plan.months], [true, 0, []]);
});

test("קודי כרטסת: תרשים של לקוח אחר לא משתנה, ובלי שורות מיובאות אין מה לעדכן", async () => {
  const dataRoot = memoryDirectory("root");
  const client = { directory: memoryDirectory("client"), config: { clientId: "c1" } };
  const prepared = await prepareLedger(ledgerFile(SECTIONS), { dataRoot, client, loadLibrary });
  assert.deepEqual(prepared.plan, { declarations: [], changed: 0, unresolved: [], locked: [], months: [] });
  await commitLedger(prepared, { client, now: NOW });
  assert.equal(await readClientChart(memoryDirectory("other")), null);
  assert.equal((await readClientChart(client.directory))[900].type, "equipment");
});
