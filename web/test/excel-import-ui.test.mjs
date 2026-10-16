import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import * as XLSX from "xlsx";
import { SEED_CHART_OF_ACCOUNTS, matchClassNames, normaliseChart, readChartOfAccounts, saveClientChart } from "../chart-of-accounts.js";
import { createDeclaration, loadDeclaration } from "../declaration-store.js";
import { buildImportedRows } from "../excel-import.js";
import { importRowsIntoDeclaration } from "../excel-import-store.js";
import { parseJournalGrid } from "../excel-journal.js";
import { buildJournalGrid, OTHER_CLIENT, SAMPLE_ROWS } from "./excel-journal-fixture.mjs";
import { memoryDirectory } from "./memory-directory.mjs";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");

function xlsxFile(grid) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(grid), "גיליון2");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return { name: "journal.xlsx", size: bytes.byteLength, arrayBuffer: async () => bytes };
}

// The UI module uses the browser globals document, window and Option, so bind them to a jsdom page first.
async function setup({ context = true, confirm = () => true } = {}) {
  const dom = new JSDOM(html, { url: "https://vitaliksh.github.io/ocr/" });
  const { window } = dom;
  Object.assign(globalThis, { document: window.document, window, Option: window.Option });
  window.confirm = confirm;
  const dialog = window.document.querySelector("#excel-import-dialog");
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
  const dataRoot = memoryDirectory("root");
  const client = { directory: memoryDirectory("client"), config: { clientId: "c1" } };
  const calls = { errors: [], imported: [], before: [] };
  const { setupExcelImport } = await import("../excel-import-ui.js");
  setupExcelImport({
    button: window.document.querySelector("#import-excel"),
    dialog,
    getContext: () => (context ? { dataRoot, client, reserved: {} } : null),
    onImported: async (result, month) => { calls.imported.push({ result, month }); },
    onError: (message) => calls.errors.push(message),
    loadLibrary: async () => XLSX,
    onBeforeCommit: async (month) => { calls.before.push(month); },
  });
  const pick = async (grid) => {
    const input = dialog.querySelector("#excel-import-file");
    Object.defineProperty(input, "files", { value: [xlsxFile(grid)], configurable: true });
    input.dispatchEvent(new window.Event("change"));
    for (let i = 0; i < 50 && dialog.querySelector("#excel-import-details").hidden; i += 1) await new Promise((r) => setTimeout(r, 10));
  };
  const q = (id) => dialog.querySelector(`#${id}`);
  return { window, dialog, dataRoot, client, calls, pick, q, open: () => window.document.querySelector("#import-excel").click() };
}

test("диалог импорта: без выбранного клиента показывает ошибку и не открывается", async () => {
  const { dialog, calls, open } = await setup({ context: false });
  open();
  assert.notEqual(dialog.open, true);
  assert.match(calls.errors[0], /תיקיית נתונים ולקוח/);
});

test("диалог импорта: файл разбирается, показывает итоги и месяц, импорт пишет декларацию", async () => {
  const { dialog, calls, pick, q, open, dataRoot, client } = await setup();
  open();
  assert.equal(dialog.open, true);
  await pick(buildJournalGrid({ month: 8 }));
  assert.match(q("excel-import-summary").textContent, new RegExp(`^${SAMPLE_ROWS.length} שורות`));
  assert.equal(q("excel-import-month").value, "08/2026");
  assert.equal(q("excel-import-run").disabled, false);
  q("excel-import-run").click();
  for (let i = 0; i < 100 && !calls.imported.length; i += 1) await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.imported[0].month, "2026-08");
  assert.equal(dialog.open, true);
  assert.equal(dialog.dataset.step, "done");
  assert.match(q("excel-import-result").textContent, /^יובאו \d+ שורות להצהרה 08\/2026/);
  assert.equal((await loadDeclaration(client.directory, "2026-08")).draft.rows.length, SAMPLE_ROWS.length);
  assert.equal((await readChartOfAccounts(dataRoot))[203].name, "אחזקה");
});

test("диалог импорта: неизвестный класс получает предложенный код, ошибки файла блокируют импорт", async () => {
  const unknown = await setup();
  unknown.open();
  await unknown.pick(buildJournalGrid({ rows: SAMPLE_ROWS.map((row, i) => (i ? row : { ...row, cls: "ספרים" })) }));
  assert.equal(unknown.q("excel-import-unknown").hidden, false);
  assert.equal(unknown.q("excel-import-unknown-list").querySelector("input").value, "200");
  assert.equal(unknown.q("excel-import-run").disabled, false);
  const broken = await setup();
  broken.open();
  await broken.pick(buildJournalGrid({ footer: { totalVat: "1.00" } }));
  assert.equal(broken.q("excel-import-run").disabled, true);
  assert.match(broken.q("excel-import-problems").textContent, /שגיאה/);
});

async function seed(client, month, { closeNow = false } = {}) {
  const parsed = parseJournalGrid(buildJournalGrid()).rows;
  const accounts = normaliseChart({ accounts: SEED_CHART_OF_ACCOUNTS });
  const rows = buildImportedRows(parsed, matchClassNames(parsed.map((r) => r.classificationName), accounts).codes);
  await importRowsIntoDeclaration({ clientDirectory: client.directory, clientId: "c1", month, rows, closeNow, now: "2026-10-01T10:00:00.000Z" });
}
const settle = () => new Promise((r) => setTimeout(r, 80));

test("диалог импорта: состояние выбранного месяца — не существует, пустая, со строками, закрыта", async () => {
  const { q, open, pick, client, window } = await setup();
  await seed(client, "2026-02");
  await seed(client, "2026-03", { closeNow: true });
  await createDeclaration(client.directory, { clientId: "c1", month: "2026-04" });
  open();
  await pick(buildJournalGrid({ month: 1 }));
  await settle();
  const check = async (month) => {
    q("excel-import-month").value = month;
    q("excel-import-month").dispatchEvent(new window.Event("change"));
    await settle();
    return [q("excel-import-target").textContent, q("excel-import-run").disabled, q("excel-import-replace-label").hidden];
  };
  assert.deepEqual(await check("2026-01"), ["ההצהרה ל-01/2026 לא קיימת ותיווצר.", false, true]);
  assert.deepEqual(await check("2026-04"), ["ההצהרה ל-04/2026 קיימת וריקה. השורות ייכנסו אליה.", false, true]);
  assert.deepEqual(await check("2026-02"), ["ב-02/2026 כבר יש 8 שורות.", true, false]);
  assert.deepEqual(await check("2026-03"), ["ההצהרה ל-03/2026 נעולה, אי אפשר לייבא אליה.", true, true]);
});

test("диалог импорта: замена непустой декларации требует галочки, сохраняет копию и вызывает onBeforeCommit", async () => {
  const { q, open, pick, client, calls, window } = await setup();
  await seed(client, "2026-02");
  open();
  await pick(buildJournalGrid({ month: 2 }));
  await settle();
  assert.equal(q("excel-import-month").value, "02/2026");
  assert.equal(q("excel-import-run").disabled, true);
  q("excel-import-replace").checked = true;
  q("excel-import-replace").dispatchEvent(new window.Event("change"));
  assert.equal(q("excel-import-run").disabled, false);
  assert.match(q("excel-import-replace-text").textContent, /8 השורות הקיימות/);
  q("excel-import-run").click();
  for (let i = 0; i < 100 && !calls.imported.length; i += 1) await settle();
  assert.deepEqual(calls.before, ["2026-02"]);
  assert.equal(calls.imported.length, 1);
  const declarationDirectory = (await client.directory.getDirectoryHandle("declarations")).children.get("2026-02");
  const backups = [...declarationDirectory.children.keys()].filter((name) => name.startsWith("draft-table.before-import-"));
  assert.equal(backups.length, 1);
  assert.equal(JSON.parse(declarationDirectory.children.get(backups[0]).text).rows.length, 8);
  assert.equal((await loadDeclaration(client.directory, "2026-02")).draft.rows.length, 8);
});

test("диалог импорта: «закрыть сразу» не требует системного подтверждения", async () => {
  const { calls, pick, q, open, client } = await setup({ confirm: () => false });
  open();
  await pick(buildJournalGrid());
  await settle();
  q("excel-import-close").checked = true;
  q("excel-import-run").click();
  for (let i = 0; i < 100 && !calls.imported.length; i += 1) await settle();
  assert.equal((await loadDeclaration(client.directory, "2026-01")).declaration.status, "closed");
});

test("диалог импорта: предупреждения и ошибки показываются по-ивритски", async () => {
  const { pick, q, open } = await setup();
  open();
  await pick(buildJournalGrid());
  assert.match(q("excel-import-warnings").textContent, /ל-8 שורות סטטוס «טיוטא»/);
  assert.doesNotMatch(q("excel-import-warnings").textContent, /rows have/);
  const broken = await setup();
  broken.open();
  await broken.pick(buildJournalGrid({ footer: { totalVat: "1.00" } }));
  assert.match(broken.q("excel-import-problems").textContent, /אינם תואמים לשורות/);
});

test("диалог импорта: месяц вводится как MM/YYYY (и как M/YYYY), неверный формат отклоняется", async () => {
  const { q, open, pick, window, calls, client } = await setup();
  open();
  await pick(buildJournalGrid({ month: 1 }));
  assert.equal(q("excel-import-month").placeholder, "MM/YYYY");
  q("excel-import-month").value = "3/2026";
  q("excel-import-month").dispatchEvent(new window.Event("input"));
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(q("excel-import-target").textContent, "ההצהרה ל-03/2026 לא קיימת ותיווצר.");
  q("excel-import-month").value = "March 2026";
  q("excel-import-month").dispatchEvent(new window.Event("input"));
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(q("excel-import-run").disabled, true);
  q("excel-import-month").value = "03/2026";
  q("excel-import-month").dispatchEvent(new window.Event("input"));
  await new Promise((r) => setTimeout(r, 80));
  q("excel-import-run").click();
  for (let i = 0; i < 100 && !calls.imported.length; i += 1) await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.imported[0].month, "2026-03");
  assert.equal((await loadDeclaration(client.directory, "2026-03")).draft.rows.length, SAMPLE_ROWS.length);
});

test("мастер импорта: шаги файл → проверка → хозяйство → итог, кнопки и размер диалога не меняются", async () => {
  const { dialog, calls, pick, q, open } = await setup();
  const steps = () => [...dialog.querySelectorAll("[data-step-name]")].map((item) => item.dataset.state);
  const visibleButtons = () => [...dialog.querySelectorAll(".dialog-actions [data-for]")].filter((button) => button.dataset.for.split(" ").includes(dialog.dataset.step)).map((button) => button.textContent);
  open();
  assert.equal(dialog.dataset.step, "file");
  assert.deepEqual(steps(), ["current", "todo", "todo", "todo"]);
  assert.deepEqual(visibleButtons(), ["ביטול"]);
  await pick(buildJournalGrid({ month: 8 }));
  assert.equal(dialog.dataset.step, "check");
  assert.deepEqual(steps(), ["done", "current", "todo", "todo"]);
  assert.deepEqual(visibleButtons(), ["הבא", "חזרה", "ביטול"]);
  assert.equal(q("excel-import-next").disabled, false);
  q("excel-import-next").click();
  assert.equal(dialog.dataset.step, "month");
  assert.deepEqual(visibleButtons(), ["ייבוא", "חזרה", "ביטול"]);
  q("excel-import-back").click();
  assert.equal(dialog.dataset.step, "check");
  q("excel-import-back").click();
  assert.equal(dialog.dataset.step, "file");
  await pick(buildJournalGrid({ month: 8 }));
  q("excel-import-next").click();
  q("excel-import-run").click();
  for (let i = 0; i < 100 && !calls.imported.length; i += 1) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(dialog.dataset.step, "done");
  assert.deepEqual(steps(), ["done", "done", "done", "current"]);
  assert.deepEqual(visibleButtons(), ["סגירה"]);
  open();
  assert.equal(dialog.dataset.step, "file");
  assert.equal(q("excel-import-result").textContent, "");
});

test("мастер импорта: файл с ошибками остаётся на шаге проверки и не пускает дальше", async () => {
  const { dialog, pick, q, open } = await setup();
  open();
  await pick(buildJournalGrid({ footer: { totalVat: "1.00" } }));
  assert.equal(dialog.dataset.step, "check");
  assert.equal(q("excel-import-next").disabled, true);
  assert.match(q("excel-import-problems").textContent, /שגיאה/);
});

test("диалог импорта: типы подбираются по итогам файла, выделяются и ведут к импорту без ручной правки", async () => {
  const { pick, q, open, window, calls, dataRoot } = await setup();
  open();
  await pick(buildJournalGrid(OTHER_CLIENT));
  await settle();
  assert.equal(q("excel-import-problems").querySelectorAll(".problem-error").length, 0);
  assert.equal(q("excel-import-next").disabled, false);
  assert.match(q("excel-import-problems").textContent, /הוגדרו אוטומטית.*«ביגוד».*«רכב רשוי וביטוח».*«הכנסה חייבת»/);
  const rows = [...q("excel-import-unknown-list").children];
  assert.deepEqual(rows.map((row) => row.classList.contains("suggested")), [true, true, true, false]);
  const select = (name) => q("excel-import-unknown-list").querySelector(`[data-name="${name}"] select`);
  assert.deepEqual(["הכנסה חייבת", "ביגוד", "רכב רשוי וביטוח", "אחזקה"].map((name) => select(name).value), ["income", "outsideVatBase", "outsideVatBase", "expense"]);
  // A manual change is re-checked at once.
  select("ביגוד").value = "expense";
  select("ביגוד").dispatchEvent(new window.Event("change"));
  assert.match(q("excel-import-problems").textContent, /תשומות כולל/);
  assert.equal(q("excel-import-next").disabled, true);
  select("ביגוד").value = "outsideVatBase";
  select("ביגוד").dispatchEvent(new window.Event("change"));
  assert.equal(q("excel-import-next").disabled, false);
  q("excel-import-run").click();
  for (let i = 0; i < 100 && !calls.imported.length; i += 1) await settle();
  assert.equal(calls.imported.length, 1);
  assert.deepEqual((await readChartOfAccounts(dataRoot))[217].clientTypes, { c1: "outsideVatBase" });
});

test("диалог импорта: если типы по итогам не подобрать, ошибка остаётся и блокирует импорт", async () => {
  const { pick, q, open } = await setup();
  open();
  await pick(buildJournalGrid({ ...OTHER_CLIENT, footer: { totalVat: "1.00" } }));
  await settle();
  assert.equal(q("excel-import-problems").querySelectorAll(".problem-error").length, 1);
  assert.doesNotMatch(q("excel-import-problems").textContent, /הוגדרו אוטומטית/);
  assert.equal(q("excel-import-next").disabled, true);
});

test("диалог импорта: на первом шаге видно, есть ли у клиента свои коды, кнопка открывает загрузку כרטסת", async () => {
  const { q, open, client, calls } = await setup();
  open();
  await settle();
  assert.match(q("excel-import-codes").textContent, /אין עדיין קודי מיון משלו/);
  await saveClientChart(client.directory, { 110: { name: "הכנסות", type: "income" } });
  open();
  await settle();
  assert.match(q("excel-import-codes").textContent, /נטענו מהכרטסת \(1 קודים\)/);
  assert.equal(q("excel-import-codes-open").textContent.includes("כרטסת"), true);
  assert.equal(calls.errors.length, 0);
});
