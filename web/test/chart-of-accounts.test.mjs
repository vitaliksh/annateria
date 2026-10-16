import test from "node:test";
import assert from "node:assert/strict";
import {
  SEED_CHART_OF_ACCOUNTS,
  addAccount,
  chartForClient,
  classTypesFromChart,
  matchClassNames,
  normaliseChart,
  readChartOfAccounts,
  readClientChart,
  readEffectiveChart,
  saveClientChart,
  setAccountType,
  saveChartOfAccounts,
  setClientType,
} from "../chart-of-accounts.js";
import { parseJournalGrid } from "../excel-journal.js";
import { memoryDirectory } from "./memory-directory.mjs";
import { buildJournalGrid } from "./excel-journal-fixture.mjs";

// Minimal in-memory File System Access stand-in: a data root with one `common` directory.
function memoryRoot(hasCommon = false) {
  const files = new Map();
  const notFound = () => Object.assign(new Error("missing"), { name: "NotFoundError" });
  const common = {
    async getFileHandle(name, { create } = {}) {
      if (!files.has(name) && !create) throw notFound();
      return {
        getFile: async () => ({ text: async () => files.get(name) }),
        createWritable: async () => ({ write: async (text) => files.set(name, text), close: async () => {} }),
      };
    },
  };
  let created = hasCommon;
  return {
    files,
    async getDirectoryHandle(name, { create } = {}) {
      if (name !== "common" || (!created && !create)) throw notFound();
      created = true;
      return common;
    },
  };
}

const reservedBuiltIn = Object.fromEntries(Array.from({ length: 89 }, (_, i) => [String(800 + i), "x"]));

test("план счетов: начальный набор валиден и не пересекается с кодами 800–888", () => {
  const accounts = normaliseChart({ accounts: SEED_CHART_OF_ACCOUNTS }, reservedBuiltIn);
  assert.equal(Object.keys(accounts).length, Object.keys(SEED_CHART_OF_ACCOUNTS).length);
  assert.equal(accounts[900].type, "equipment");
  assert.equal(accounts[206].type, "outsideVatBase");
});

test("план счетов: отбрасывает неверный код, тип, пустое имя, дубль имени и зарезервированный код", () => {
  const accounts = normaliseChart(
    {
      accounts: {
        10: { name: "a", type: "expense" },
        300: { name: "b", type: "bogus" },
        301: { name: " ", type: "income" },
        302: { name: "dup", type: "expense" },
        303: { name: "dup", type: "income" },
        811: { name: "res", type: "expense" },
      },
    },
    { 811: "x" },
  );
  assert.deepEqual(accounts, { 302: { name: "dup", type: "expense" } });
});

test("план счетов: типы классов для парсера журнала", () => {
  const types = classTypesFromChart(normaliseChart({ accounts: SEED_CHART_OF_ACCOUNTS }));
  assert.deepEqual(types.income, ["הכנסות"]);
  assert.deepEqual(types.equipment, ["רכישת ציוד/רכוש קבוע"]);
  assert.deepEqual(types.outsideVatBase, ["ארנונה", "ביטוח עסק"]);
});

test("план счетов: типы из плана дают разбор фикстуры без ошибок", () => {
  const classTypes = classTypesFromChart(normaliseChart({ accounts: SEED_CHART_OF_ACCOUNTS }));
  assert.deepEqual(parseJournalGrid(buildJournalGrid(), { classTypes }).errors, []);
});

test("план счетов: сопоставление имён с кодами и список неизвестных", () => {
  const accounts = normaliseChart({ accounts: SEED_CHART_OF_ACCOUNTS });
  const { codes, unknown } = matchClassNames(["אחזקה", "הכנסות", "אחזקה", "ספרים"], accounts);
  assert.deepEqual(codes, { אחזקה: "203", הכנסות: "160" });
  assert.deepEqual(unknown, ["ספרים"]);
});

test("план счетов: ручное добавление не перезаписывает существующий код или имя", () => {
  const accounts = normaliseChart({ accounts: SEED_CHART_OF_ACCOUNTS });
  assert.equal(addAccount(accounts, { code: "240", name: "ספרים", type: "expense" })[240].name, "ספרים");
  assert.throws(() => addAccount(accounts, { code: "203", name: "חדש", type: "expense" }), /אינם תקינים/);
  assert.throws(() => addAccount(accounts, { code: "241", name: "אחזקה", type: "expense" }), /אינם תקינים/);
  assert.throws(() => addAccount(accounts, { code: "812", name: "x", type: "expense" }, { 812: "y" }), /אינם תקינים/);
});

test("план счетов: без файла null, сохранение и чтение возвращают тот же план", async () => {
  const root = memoryRoot();
  assert.equal(await readChartOfAccounts(root), null);
  assert.equal(await readChartOfAccounts(null), null);
  const saved = await saveChartOfAccounts(root, SEED_CHART_OF_ACCOUNTS);
  assert.deepEqual(await readChartOfAccounts(root), saved);
  assert.equal(JSON.parse(root.files.get("chart-of-accounts.json")).schemaVersion, 1);
  await assert.rejects(saveChartOfAccounts(null, {}), /תיקיית נתונים/);
});

test("план счетов: корень с пустой папкой common тоже даёт null", async () => {
  assert.equal(await readChartOfAccounts(memoryRoot(true)), null);
});

test("план счетов: тип класса у клиента отдельно от общего, тот же тип снимает исключение", () => {
  const seed = normaliseChart({ accounts: SEED_CHART_OF_ACCOUNTS });
  const chart = setClientType(seed, "217", "c2", "outsideVatBase");
  assert.deepEqual(chart[217], { name: "רכב רשוי וביטוח", type: "expense", clientTypes: { c2: "outsideVatBase" } });
  assert.equal(chartForClient(chart, "c2")[217].type, "outsideVatBase");
  assert.equal(chartForClient(chart, "c1")[217].type, "expense");
  assert.equal(chartForClient(chart)[217].type, "expense");
  assert.deepEqual(normaliseChart({ accounts: chart }), chart);
  assert.deepEqual(setClientType(chart, "217", "c2", "expense")[217], { name: "רכב רשוי וביטוח", type: "expense" });
  assert.throws(() => setClientType(chart, "999", "c2", "income"));
  const dirty = normaliseChart({ accounts: { 217: { name: "x", type: "expense", clientTypes: { c1: "bogus", c2: "expense", c3: "income" } } } });
  assert.deepEqual(dirty[217].clientTypes, { c3: "income" });
});

test("תרשים לקוח: נשמר בתיקיית הלקוח, מחליף את התרשים המשותף, ובלעדיו נשאר התרשים המשותף עם סוגי הלקוח", async () => {
  const root = memoryRoot();
  const client = memoryDirectory("client");
  await saveChartOfAccounts(root, setClientType(normaliseChart({ accounts: SEED_CHART_OF_ACCOUNTS }), "217", "c1", "outsideVatBase"));
  assert.equal(await readClientChart(client), null);
  assert.equal(await readClientChart(null), null);
  assert.equal((await readEffectiveChart(root, client, "c1"))[217].type, "outsideVatBase");
  assert.equal((await readEffectiveChart(root, client, "c2"))[217].type, "expense");
  const saved = await saveClientChart(client, { 110: { name: "הכנסה חייבת", type: "income" }, 214: { name: "רכב רשוי וביטוח", type: "expense" } }, { reserved: { 214: "x" } });
  assert.deepEqual(Object.keys(saved), ["110"], "reserved codes are dropped");
  assert.deepEqual(await readEffectiveChart(root, client, "c1"), saved);
  assert.equal(JSON.parse(client.children.get("classification-codes.json").text).source, "ledger");
  await assert.rejects(saveClientChart(null, {}), /לקוח/);
  assert.equal(setAccountType(saved, "110", "expense")[110].type, "expense");
  assert.throws(() => setAccountType(saved, "999", "expense"));
  assert.throws(() => setAccountType(saved, "110", "bogus"));
});
