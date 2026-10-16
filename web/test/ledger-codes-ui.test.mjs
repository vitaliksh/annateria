import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import * as XLSX from "xlsx";
import { SEED_CHART_OF_ACCOUNTS, matchClassNames, normaliseChart, readClientChart, saveChartOfAccounts } from "../chart-of-accounts.js";
import { loadDeclaration } from "../declaration-store.js";
import { buildImportedRows } from "../excel-import.js";
import { importRowsIntoDeclaration } from "../excel-import-store.js";
import { parseJournalGrid } from "../excel-journal.js";
import { buildJournalGrid } from "./excel-journal-fixture.mjs";
import { ledgerGrid } from "./ledger-fixture.mjs";
import { memoryDirectory } from "./memory-directory.mjs";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const settle = () => new Promise((r) => setTimeout(r, 60));

function xlsxFile(grid, name = "כרטסת.xlsx") {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(grid), "גיליון2");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytes };
}

async function setup({ context = true } = {}) {
  const { window } = new JSDOM(html, { url: "https://vitaliksh.github.io/ocr/" });
  Object.assign(globalThis, { document: window.document, window, Option: window.Option });
  const dialog = window.document.querySelector("#ledger-codes-dialog");
  dialog.showModal = () => { dialog.open = true; };
  const dataRoot = memoryDirectory("root");
  await saveChartOfAccounts(dataRoot, SEED_CHART_OF_ACCOUNTS);
  const client = { directory: memoryDirectory("client"), config: { clientId: "c1", clientName: "אווה" } };
  const calls = { errors: [], saved: [], before: [] };
  const { setupLedgerCodes } = await import("../ledger-codes-ui.js");
  const ledger = setupLedgerCodes({
    dialog,
    getContext: () => (context ? { dataRoot, client, reserved: {} } : null),
    onBeforeWrite: async (months) => { calls.before.push(months); return months[0] ?? null; },
    onSaved: async (result, detached) => { calls.saved.push({ result, detached }); },
    onError: (message) => calls.errors.push(message),
    loadLibrary: async () => XLSX,
  });
  const q = (id) => dialog.querySelector(`#${id}`);
  const pick = async (file) => {
    Object.defineProperty(q("ledger-codes-file"), "files", { value: [file], configurable: true });
    q("ledger-codes-file").dispatchEvent(new window.Event("change"));
    for (let i = 0; i < 50 && q("ledger-codes-details").hidden && !q("ledger-codes-error").textContent; i += 1) await settle();
  };
  return { window, dialog, dataRoot, client, calls, ledger, q, pick };
}

const SECTIONS = [
  { title: "הכנסות", accounts: [["110", "הכנסות"]] },
  { title: "הוצאות הנהלה וכלליות", accounts: [["301", "אחזקה"], ["302", "חשמל"], ["303", "חניה פנגו"], ["304", "טלפון סלולרי"], ["305", "ארנונה"]] },
  { title: "לא משתתף", accounts: [["900", "רכישת ציוד/רכוש קבוע"]] },
];

test("диалог כרטסת: без клиента ошибка и диалог не открывается", async () => {
  const { dialog, ledger, calls } = await setup({ context: false });
  ledger.open();
  assert.notEqual(dialog.open, true);
  assert.match(calls.errors[0], /לקוח/);
});

test("диалог כרטסת: список кодов с типами, пересчёт строк импорта, сохранение плана клиента", async () => {
  const { dialog, client, calls, ledger, q, pick, window } = await setup();
  const parsed = parseJournalGrid(buildJournalGrid()).rows;
  const chart = normaliseChart({ accounts: SEED_CHART_OF_ACCOUNTS });
  const rows = buildImportedRows(parsed, matchClassNames(parsed.map((r) => r.classificationName), chart).codes);
  await importRowsIntoDeclaration({ clientDirectory: client.directory, clientId: "c1", month: "2026-01", rows, now: "2026-10-01T10:00:00.000Z" });
  ledger.open();
  assert.equal(dialog.open, true);
  assert.match(q("ledger-codes-client").textContent, /אווה/);
  assert.equal(q("ledger-codes-save").disabled, true);
  await pick(xlsxFile(ledgerGrid(SECTIONS)));
  assert.match(q("ledger-codes-summary").textContent, /נמצאו 7 קודי מיון/);
  assert.match(q("ledger-codes-notes").textContent, /בהצהרות 01\/2026 יעודכנו הקודים של 7 שורות/);
  const list = [...q("ledger-codes-list").children];
  assert.deepEqual(list.map((row) => row.dataset.code), ["110", "301", "302", "303", "304", "305", "900"]);
  assert.equal(list.find((row) => row.dataset.code === "305").querySelector("select").value, "outsideVatBase");
  const electricity = list.find((row) => row.dataset.code === "302").querySelector("select");
  electricity.value = "outsideVatBase";
  electricity.dispatchEvent(new window.Event("change"));
  q("ledger-codes-save").click();
  for (let i = 0; i < 50 && !calls.saved.length; i += 1) await settle();
  assert.deepEqual(calls.before, [["2026-01"]]);
  assert.equal(calls.saved[0].detached, "2026-01");
  assert.equal(calls.saved[0].result.chart[302].type, "outsideVatBase");
  assert.equal((await readClientChart(client.directory))[302].type, "outsideVatBase");
  assert.ok((await loadDeclaration(client.directory, "2026-01")).draft.rows.every((row) => Number(row.values[1]) >= 110));
  assert.match(q("ledger-codes-summary").textContent, /נשמרו 7 קודי מיון של הלקוח, עודכנו 7 שורות/);
  assert.equal(q("ledger-codes-save").disabled, true);
});

test("диалог כרטסת: неверный файл показывает ошибку и не даёт сохранить", async () => {
  const { ledger, q, pick, calls, client } = await setup();
  ledger.open();
  await pick(xlsxFile([["a"], ["b"]]));
  assert.match(q("ledger-codes-error").textContent, /לא נמצאו קודי מיון/);
  assert.equal(q("ledger-codes-save").disabled, true);
  await pick(xlsxFile(ledgerGrid(), "כרטסת.docx"));
  assert.match(q("ledger-codes-error").textContent, /PDF או/);
  assert.equal(await readClientChart(client.directory), null);
  assert.equal(calls.saved.length, 0);
});
