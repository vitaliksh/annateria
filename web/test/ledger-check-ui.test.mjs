import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import * as XLSX from "xlsx";
import { SEED_CHART_OF_ACCOUNTS, matchClassNames, normaliseChart, saveClientChart } from "../chart-of-accounts.js";
import { loadDeclaration } from "../declaration-store.js";
import { buildImportedRows } from "../excel-import.js";
import { importRowsIntoDeclaration } from "../excel-import-store.js";
import { parseJournalGrid } from "../excel-journal.js";
import { buildJournalGrid, SAMPLE_ROWS } from "./excel-journal-fixture.mjs";
import { ledgerRowsGrid } from "./ledger-fixture.mjs";
import { memoryDirectory } from "./memory-directory.mjs";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const settle = () => new Promise((r) => setTimeout(r, 60));
const chart = normaliseChart({ accounts: SEED_CHART_OF_ACCOUNTS });

// Ledger of the sample journal (ledger signs) with an optional extra operation of class "אחזקה".
function ledgerFile(extra = []) {
  const classes = new Map();
  for (const sample of SAMPLE_ROWS) {
    const iso = new Date(Date.UTC(1899, 11, 30) + sample.date * 86400000).toISOString().slice(0, 10);
    const sign = (sample.kind === "income" ? 1 : -1) * (sample.kind === "credit" ? -1 : 1);
    const [net, vat] = [sign * sample.net, sign * sample.vat];
    if (!classes.has(sample.cls)) classes.set(sample.cls, []);
    classes.get(sample.cls).push({ month: 1, line: String(classes.get(sample.cls).length + 1), date: iso, details: sample.details, ref1: sample.ref1, gross: Math.round((net + vat) * 100) / 100, net, vat });
  }
  const codeOf = Object.fromEntries(Object.entries(chart).map(([code, account]) => [account.name, code]));
  const blocks = [...classes].map(([name, rows]) => {
    const type = chart[codeOf[name]].type;
    return { section: type === "income" ? "הכנסות" : type === "equipment" ? "לא משתתף" : "הוצאות הנהלה וכלליות", code: codeOf[name], name, rows: name === "אחזקה" ? [...rows, ...extra] : rows };
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(ledgerRowsGrid(blocks)), "גיליון2");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return { name: "כרטסת.xlsx", size: bytes.byteLength, arrayBuffer: async () => bytes };
}
const MISSING = { month: 1, line: "99", date: "2026-01-20", details: "Water bill", ref1: "4455", gross: -118, net: -100, vat: -18 };

async function setup({ context = true } = {}) {
  const { window } = new JSDOM(html, { url: "https://vitaliksh.github.io/ocr/" });
  Object.assign(globalThis, { document: window.document, window });
  const dialog = window.document.querySelector("#ledger-check-dialog");
  dialog.showModal = () => { dialog.open = true; };
  const dataRoot = memoryDirectory("root");
  const client = { directory: memoryDirectory("client"), config: { clientId: "c1", clientName: "Eva" } };
  await saveClientChart(client.directory, chart);
  const parsed = parseJournalGrid(buildJournalGrid()).rows;
  const rows = buildImportedRows(parsed, matchClassNames(parsed.map((r) => r.classificationName), chart).codes);
  await importRowsIntoDeclaration({ clientDirectory: client.directory, clientId: "c1", month: "2026-01", rows, now: "2026-10-01T10:00:00.000Z" });
  const calls = { errors: [], saved: [], before: [] };
  const { setupLedgerCheck } = await import("../ledger-check-ui.js");
  const check = setupLedgerCheck({
    button: window.document.querySelector("#check-ledger"),
    dialog,
    getContext: () => (context ? { dataRoot, client, reserved: {} } : null),
    onBeforeWrite: async (months) => { calls.before.push(months); return months[0] ?? null; },
    onSaved: async (result, detached) => { calls.saved.push({ result, detached }); },
    onError: (message) => calls.errors.push(message),
    loadLibrary: async () => XLSX,
  });
  const q = (id) => dialog.querySelector(`#${id}`);
  const pick = async (file) => {
    Object.defineProperty(q("ledger-check-file"), "files", { value: [file], configurable: true });
    q("ledger-check-file").dispatchEvent(new window.Event("change"));
    for (let i = 0; i < 50 && q("ledger-check-details").hidden && !q("ledger-check-error").textContent; i += 1) await settle();
  };
  return { window, dialog, client, calls, check, q, pick, open: () => window.document.querySelector("#check-ledger").click() };
}

test("בדיקה מול כרטסת: בלי לקוח שגיאה והדיאלוג לא נפתח", async () => {
  const { dialog, calls, open } = await setup({ context: false });
  open();
  assert.notEqual(dialog.open, true);
  assert.match(calls.errors[0], /לקוח/);
});

test("בדיקה מול כרטסת: כרטסת שלמה — הכול תואם ואין מה להוסיף", async () => {
  const { dialog, q, pick, open } = await setup();
  open();
  assert.equal(dialog.open, true);
  assert.match(q("ledger-check-client").textContent, /Eva/);
  await pick(ledgerFile());
  assert.match(q("ledger-check-summary").textContent, /הכול תואם: כל 8 הפעולות/);
  assert.equal(q("ledger-check-list").children.length, 0);
  assert.equal(q("ledger-check-add").disabled, true);
});

test("בדיקה מול כרטסת: פעולה חסרה מוצגת, מסומנת כברירת מחדל ונוספת להצהרה, והצהרה פתוחה מנותקת לפני הכתיבה", async () => {
  const { client, calls, q, pick, open } = await setup();
  open();
  await pick(ledgerFile([MISSING]));
  assert.match(q("ledger-check-summary").textContent, /9 פעולות: 8 קיימות בהצהרות, 1 חסרות/);
  const boxes = [...q("ledger-check-list").querySelectorAll("input")];
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].checked, true);
  assert.match(q("ledger-check-list").textContent, /Water bill/);
  assert.equal(q("ledger-check-add").textContent, "הוספת 1 פעולות להצהרות");
  boxes[0].checked = false;
  boxes[0].dispatchEvent(new window.Event("change"));
  assert.equal(q("ledger-check-add").disabled, true);
  boxes[0].checked = true;
  boxes[0].dispatchEvent(new window.Event("change"));
  q("ledger-check-add").click();
  for (let i = 0; i < 50 && !calls.saved.length; i += 1) await settle();
  assert.deepEqual(calls.before, [["2026-01"]]);
  assert.equal(calls.saved[0].detached, "2026-01");
  assert.equal(calls.saved[0].result.added, 1);
  assert.equal((await loadDeclaration(client.directory, "2026-01")).draft.rows.length, SAMPLE_ROWS.length + 1);
  assert.match(q("ledger-check-summary").textContent, /נוספו 1 פעולות להצהרות 01\/2026/);
});

test("בדיקה מול כרטסת: קובץ לא תקין מציג שגיאה, וכפתור התפריט פותח את הדיאלוג", async () => {
  const { dialog, q, pick, open, calls } = await setup();
  open();
  await pick({ name: "כרטסת.docx", size: 5, arrayBuffer: async () => new ArrayBuffer(5) });
  assert.match(q("ledger-check-error").textContent, /PDF או/);
  assert.equal(q("ledger-check-add").disabled, true);
  assert.equal(dialog.open, true);
  assert.equal(calls.saved.length, 0);
});
