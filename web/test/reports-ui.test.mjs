import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { SEED_CHART_OF_ACCOUNTS, matchClassNames, normaliseChart, saveChartOfAccounts } from "../chart-of-accounts.js";
import { buildImportedRows } from "../excel-import.js";
import { importRowsIntoDeclaration } from "../excel-import-store.js";
import { parseJournalGrid } from "../excel-journal.js";
import { readReportSettings } from "../report-data.js";
import { buildJournalGrid } from "./excel-journal-fixture.mjs";
import { memoryDirectory } from "./memory-directory.mjs";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const now = "2026-10-02T10:00:00.000Z";

async function setup({ declarations = ["2026-01", "2026-02"], context = true, openViewer, renderPdf, renderDocuments, periods = {} } = {}) {
  const { window } = new JSDOM(html, { url: "https://vitaliksh.github.io/ocr/" });
  Object.assign(globalThis, { document: window.document, window });
  const dialog = window.document.querySelector("#reports-view");
  let opened = 0;
  const dataRoot = memoryDirectory("root");
  const client = { directory: memoryDirectory("client"), config: { clientId: "c1", clientName: "Test Client", ...periods } };
  const accounts = normaliseChart({ accounts: SEED_CHART_OF_ACCOUNTS });
  await saveChartOfAccounts(dataRoot, accounts);
  const parsed = parseJournalGrid(buildJournalGrid()).rows;
  const rows = buildImportedRows(parsed, matchClassNames(parsed.map((r) => r.classificationName), accounts).codes);
  for (const month of declarations) await importRowsIntoDeclaration({ clientDirectory: client.directory, clientId: "c1", month, rows, now });
  const errors = [];
  let printed = 0;
  window.print = () => { printed += 1; };
  const { setupReports } = await import("../reports-ui.js");
  const reports = setupReports({
    button: window.document.querySelector("#open-reports"),
    dialog,
    printRoot: window.document.querySelector("#report-print"),
    getContext: (explicit) => (context ? { client: explicit ?? client, dataRoot, names: {} } : null),
    onOpen: () => { opened += 1; },
    onError: (message) => errors.push(message),
    ...(openViewer ? { openViewer } : {}),
    ...(renderPdf ? { renderPdf } : {}),
    ...(renderDocuments ? { renderDocuments } : {}),
  });
  const q = (id) => dialog.querySelector(`#${id}`);
  const open = async () => { window.document.querySelector("#open-reports").click(); await new Promise((r) => setTimeout(r, 80)); };
  const click = async (id) => { q(id).click(); await new Promise((r) => setTimeout(r, 80)); };
  return { window, dialog, client, errors, q, open, click, reports, dataRoot, opened: () => opened, printed: () => printed, printRoot: window.document.querySelector("#report-print") };
}

test("диалог отчётов: без клиента показывает ошибку", async () => {
  const { opened, errors, open } = await setup({ context: false });
  await open();
  assert.equal(opened(), 0);
  assert.match(errors[0], /לקוח/);
});

test("диалог отчётов: период по умолчанию — месяц последней декларации или с начала года", async () => {
  const { q, open } = await setup();
  await open();
  assert.deepEqual([q("reports-from").value, q("reports-to").value], ["02/2026", "02/2026"]);
  q("reports-vat-period").value = "bimonthly";
  q("reports-vat-period").dispatchEvent(new globalThis.window.Event("change"));
  assert.deepEqual([q("reports-from").value, q("reports-to").value], ["01/2026", "02/2026"]);
  q("reports-kind").value = "profitLoss";
  q("reports-kind").dispatchEvent(new globalThis.window.Event("change"));
  assert.deepEqual([q("reports-from").value, q("reports-to").value], ["01/2026", "02/2026"]);
});

test("диалог отчётов: период выбирается списками месяца и года и не сбрасывается при смене отчёта", async () => {
  const { q, open } = await setup();
  await open();
  const change = (id, value) => { q(id).value = value; q(id).dispatchEvent(new globalThis.window.Event("change")); };
  assert.deepEqual([q("reports-from-month").value, q("reports-from-year").value], ["02", "2026"]);
  assert.deepEqual([...q("reports-from-year").options].map((option) => option.value), ["2025", "2026", "2027"]);
  change("reports-kind", "profitLoss");
  assert.deepEqual([q("reports-from").value, q("reports-to").value], ["01/2026", "02/2026"], "untouched: the default of the report");
  change("reports-from-month", "02");
  change("reports-to-month", "01");
  change("reports-to-year", "2027");
  assert.deepEqual([q("reports-from").value, q("reports-to").value], ["02/2026", "01/2027"]);
  change("reports-kind", "vat");
  change("reports-kind", "documents");
  assert.deepEqual([q("reports-from").value, q("reports-to").value], ["02/2026", "01/2027"], "the chosen period stays");
  assert.deepEqual([q("reports-to-month").value, q("reports-to-year").value], ["01", "2027"]);
  await open();
  assert.deepEqual([q("reports-from").value, q("reports-to").value], ["02/2026", "02/2026"], "a new opening sets the default");
});

test("диалог отчётов: пустая последняя декларация не скрывает период с данными", async () => {
  const { q, open, click, client } = await setup({ declarations: ["2026-01"] });
  const { createDeclaration } = await import("../declaration-store.js");
  await createDeclaration(client.directory, { clientId: "c1", month: "2026-10" });
  await open();
  assert.deepEqual([q("reports-from").value, q("reports-to").value], ["01/2026", "01/2026"]);
  q("reports-from").value = "2026-10";
  q("reports-to").value = "2026-10";
  await click("reports-show");
  assert.match(q("reports-error").textContent, /אין תנועות/);
});

test("диалог отчётов: показ отчёта НДС за два месяца (без окна просмотра), настройки сохраняются", async () => {
  const { q, open, click, client } = await setup();
  await open();
  q("reports-vat-period").value = "bimonthly";
  q("reports-vat-period").dispatchEvent(new globalThis.window.Event("change"));
  q("reports-advance-percent").value = "12";
  await click("reports-show");
  assert.equal(q("reports-error").textContent, "");
  assert.match(q("reports-preview").textContent, /דוח מס ערך מוסף/);
  assert.match(q("reports-preview").textContent, /20,000/);
  assert.deepEqual(await readReportSettings(client.directory), { vatPeriod: "bimonthly", advancePercent: 12 });
});

test("the reports take the VAT dealer number and the address from the client card", async () => {
  const { q, open } = await setup({ periods: { vatId: "014715726", address: "Herzl 1" } });
  await open();
  assert.equal(q("reports-preview").querySelector(".report-business").textContent, "עוסק מורשה: 01471572-6 · Herzl 1");
});

test("диалог отчётов: авансы требуют процент, неверный период отклоняется, сохранение всех тоже", async () => {
  const { q, open, click } = await setup();
  await open();
  q("reports-kind").value = "advances";
  await click("reports-show");
  assert.match(q("reports-error").textContent, /אחוז מקדמות/);
  q("reports-from").value = "2026-03";
  q("reports-to").value = "2026-01";
  await click("reports-show");
  assert.match(q("reports-error").textContent, /תקופה תקינה/);
  await click("reports-save-all");
  assert.match(q("reports-error").textContent, /תקופה תקינה/);
});

test("диалог отчётов: все четыре вида отчётов строятся", async () => {
  const { q, open, click } = await setup();
  await open();
  q("reports-advance-percent").value = "12";
  for (const [kind, title] of [["advances", "דוח מקדמות"], ["profitLoss", "דוח רווח והפסד"], ["ledger", "כרטסת קודי מיון"]]) {
    q("reports-kind").value = kind;
    q("reports-from").value = "2026-01";
    q("reports-to").value = "2026-02";
    await click("reports-show");
    assert.match(q("reports-preview").textContent, new RegExp(title));
  }
});

const fakePdf = async (pages) => ({ pdf: new Blob([`pages:${pages.length}`], { type: "application/pdf" }), images: pages.map(() => new Blob(["x"])) });

function fakeViewer() {
  const viewer = { shown: null, failed: null, closed: 0 };
  viewer.show = (details) => { viewer.shown = details; };
  viewer.fail = (message) => { viewer.failed = message; };
  viewer.close = () => { viewer.closed += 1; };
  return viewer;
}

test("страница отчётов: показ открывает окно просмотра, а встроенный предпросмотр остаётся на странице", async () => {
  const viewer = fakeViewer();
  const { q, open, click, client } = await setup({ openViewer: () => viewer, renderPdf: fakePdf });
  await open();
  await click("reports-show");
  assert.ok(q("reports-preview").querySelector(".report-sheet"));
  assert.equal(q("reports-error").textContent, "");
  assert.equal(viewer.shown.title, "דוח מס ערך מוסף");
  assert.equal(viewer.shown.pageUrls.length, 1);
  assert.match(await viewer.shown.save(), /reports\/vat_02-2026_02-2026\.pdf/);
  assert.deepEqual([...client.directory.children.get("reports").children.keys()], ["vat_02-2026_02-2026.pdf"]);
  const win = { showSaveFilePicker: async (options) => ({ name: options.suggestedName, createWritable: async () => ({ write: async () => {}, close: async () => {} }) }) };
  assert.match(await viewer.shown.saveAs(win), /vat_02-2026_02-2026\.pdf/);
});

test("диалог отчётов: ошибка при построении закрывает окно просмотра и показывается пользователю", async () => {
  const viewer = fakeViewer();
  const { q, open, click } = await setup({ openViewer: () => viewer, renderPdf: async () => { throw new Error("boom"); } });
  await open();
  await click("reports-show");
  assert.equal(q("reports-error").textContent, "boom");
  assert.equal(viewer.failed, "boom");
});

test("диалог отчётов: «שמירת כל המסמכים» сохраняет четыре отчёта, без процента — три", async () => {
  const { q, open, click, client } = await setup({ renderPdf: fakePdf });
  await open();
  q("reports-advance-percent").value = "12";
  await click("reports-save-all");
  const names = () => [...client.directory.children.get("reports").children.keys()].sort();
  assert.deepEqual(names(), ["advances_02-2026_02-2026.pdf", "ledger_02-2026_02-2026.pdf", "profit-loss_02-2026_02-2026.pdf", "vat_02-2026_02-2026.pdf"]);
  assert.match(q("reports-status").textContent, /נשמרו 4/);
  client.directory.children.get("reports").children.clear();
  q("reports-advance-percent").value = "";
  await click("reports-save-all");
  assert.equal(names().length, 3);
  assert.match(q("reports-status").textContent, /נשמרו 3/);
  assert.match(q("reports-error").textContent, /מקדמות/);
});

test("страница отчётов: открывается для явно заданного клиента с выбранным видом и сразу показывает отчёт", async () => {
  const { q, reports, client, opened, dialog } = await setup();
  await reports.open({ client, kind: "profitLoss" });
  assert.equal(opened(), 1);
  assert.equal(q("reports-kind").value, "profitLoss");
  assert.deepEqual([q("reports-from").value, q("reports-to").value], ["01/2026", "02/2026"]);
  assert.ok(q("reports-preview").querySelector(".report-sheet"), "the preview is drawn without pressing a button");
  q("reports-kind").value = "ledger";
  q("reports-kind").dispatchEvent(new globalThis.window.Event("change"));
  assert.ok(q("reports-preview").querySelector(".report-sheet"));
  q("reports-from").value = "99/9999";
  q("reports-from").dispatchEvent(new globalThis.window.Event("input"));
  assert.equal(q("reports-preview").childElementCount, 0);
  assert.ok(dialog);
});

test("страница отчётов: авансы без процента не показывают отчёт, с процентом — показывают", async () => {
  const { q, reports, client } = await setup();
  await reports.open({ client, kind: "advances" });
  assert.equal(q("reports-preview").childElementCount, 0);
  q("reports-advance-percent").value = "12";
  q("reports-advance-percent").dispatchEvent(new globalThis.window.Event("input"));
  assert.ok(q("reports-preview").querySelector(".report-sheet"));
});

test("диалог отчётов: периоды НДС и авансов берутся из свойств клиента и независимы друг от друга", async () => {
  const { q, open } = await setup({ periods: { vatPeriod: "bimonthly", advancesPeriod: "monthly" } });
  await open();
  assert.deepEqual([q("reports-vat-period").value, q("reports-advances-period").value], ["bimonthly", "monthly"]);
  assert.equal(q("reports-vat-period").disabled, true);
  assert.deepEqual([q("reports-from").value, q("reports-to").value], ["01/2026", "02/2026"], "VAT report: two months");
  q("reports-kind").value = "advances";
  q("reports-kind").dispatchEvent(new globalThis.window.Event("change"));
  assert.deepEqual([q("reports-from").value, q("reports-to").value], ["02/2026", "02/2026"], "advances report: one month");
});

test("диалог отчётов: клиент без периодов в свойствах берёт период НДС из старых настроек отчётов", async () => {
  const { q, open, client } = await setup();
  const { saveReportSettings } = await import("../report-data.js");
  await saveReportSettings(client.directory, { vatPeriod: "bimonthly", advancePercent: 12 });
  await open();
  assert.deepEqual([q("reports-vat-period").value, q("reports-advances-period").value], ["bimonthly", "bimonthly"]);
});

// A closed month with rows the PCN874 file accepts (step 6.4.3): one purchase with its supplier number, one sale.
async function closeWithRows(clientDirectory, month, rows) {
  const store = await import("../declaration-store.js");
  const { getDeclarationDirectory, loadDeclaration, saveDraft, finalizeDeclaration } = store;
  const declarationDirectory = await getDeclarationDirectory(clientDirectory, month);
  const { declaration } = await loadDeclaration(clientDirectory, month);
  await saveDraft(declarationDirectory, declaration, rows);
  await finalizeDeclaration({ clientDirectory, declarationDirectory, declaration, finalExport: "no-export", rows });
}
const pcnRow = (date, code, party, reference, net, vat) => ({
  active: true, rawNet: String(net), rawVat: String(vat),
  values: [date, code, "", "", party, reference, "", String(net + vat), String(net), String(vat), "", ""],
});

test("the PCN874 file is offered only for a client with the PCN duty, and replaces the print button", async () => {
  const plain = await setup();
  await plain.open();
  assert.equal(plain.q("reports-kind").querySelector('option[value="pcn874"]').hidden, true);
  assert.deepEqual([plain.q("reports-show").hidden, plain.q("reports-save-pcn").hidden], [false, true]);
  const pcn = await setup({ periods: { pcnRequired: true, vatId: "123456782", vatPeriod: "bimonthly" } });
  await pcn.open();
  assert.equal(pcn.q("reports-kind").querySelector('option[value="pcn874"]').hidden, false);
  pcn.q("reports-kind").value = "pcn874";
  pcn.q("reports-kind").dispatchEvent(new globalThis.window.Event("change"));
  assert.deepEqual([pcn.q("reports-show").hidden, pcn.q("reports-save-pcn").hidden, pcn.q("reports-save-pcn-as").hidden],
    [true, false, false]);
  assert.deepEqual([pcn.q("reports-from").value, pcn.q("reports-to").value], ["01/2026", "02/2026"]);
  assert.match(pcn.q("reports-preview").textContent, /קובץ PCN874/);
});

test("the PCN874 file is refused while the list has problems, then saved into the client's reports folder", async () => {
  const periods = { pcnRequired: true, vatId: "123456782", vatPeriod: "bimonthly" };
  const { q, open, click, client } = await setup({ periods });
  await open();
  q("reports-kind").value = "pcn874";
  q("reports-kind").dispatchEvent(new globalThis.window.Event("change"));
  // The imported months are open and their purchases carry no supplier number.
  assert.match(q("reports-preview").textContent, /אינה נעולה/);
  assert.match(q("reports-preview").textContent, /חסר מספר העוסק של הספק/);
  await click("reports-save-pcn");
  assert.match(q("reports-error").textContent, /לא ניתן לשמור את קובץ PCN874/);
  assert.equal(client.directory.children.has("reports"), false);
  await closeWithRows(client.directory, "2026-01", [pcnRow("02/01/26", "203", "000000018", "3412", 100, 18)]);
  await closeWithRows(client.directory, "2026-02", [pcnRow("10/02/26", "160", "", "4087", 1000, 180)]);
  await open();
  await click("reports-save-pcn");
  assert.equal(q("reports-error").textContent, "");
  assert.match(q("reports-status").textContent, /PCN874_123456782_202602\.txt/);
  const saved = client.directory.children.get("reports").children.get("PCN874_123456782_202602.txt").text;
  const text = await saved.text();
  assert.match(text, /^O123456782202602/);
  assert.match(text, /\r\nT000000018202601020000000003412000000018\+0000000100000000000\r\n/);
  assert.match(text, /\r\nX123456782\r\n$/);
});

test("documents report: a kind of the list; the page lists the rows, the viewer gets one page per row with its original", async () => {
  const viewer = fakeViewer();
  const calls = [];
  const renderDocuments = async (input) => {
    calls.push(input);
    const originals = await Promise.all(input.items.map((item) => input.readOriginal(item)));
    return { pdf: new Blob(["%PDF"]), images: input.items.map(() => new Blob(["jpeg"])), originals };
  };
  const { q, open, click, client } = await setup({ openViewer: () => viewer, renderDocuments });
  await open();
  assert.equal(q("reports-kind").querySelector('option[value="documents"]').textContent, "PDF מסכם");
  q("reports-kind").value = "documents";
  q("reports-kind").dispatchEvent(new globalThis.window.Event("change"));
  assert.deepEqual([q("reports-from").value, q("reports-to").value], ["02/2026", "02/2026"]);
  const sheet = q("reports-preview").querySelector(".report-sheet");
  assert.equal(sheet.querySelector("h2").textContent, "PDF מסכם");
  const listed = sheet.querySelectorAll("tbody tr").length;
  assert.ok(listed > 0);
  await click("reports-show");
  assert.equal(q("reports-error").textContent, "");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].items.length, listed);
  assert.ok(calls[0].items.every((item) => item.month === "2026-02" && item.row.active));
  assert.equal(calls[0].clientName, "Test Client");
  assert.equal(viewer.shown.title, "PDF מסכם");
  assert.equal(viewer.shown.pageUrls.length, listed);
  assert.match(await viewer.shown.save(), /reports\/documents_02-2026_02-2026\.pdf/);
  assert.ok(client.directory.children.get("reports").children.has("documents_02-2026_02-2026.pdf"));
});
