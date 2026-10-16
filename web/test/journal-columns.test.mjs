import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { COLUMNS, PRESET_HIDDEN, columnIndex, columnPercents, hiddenCss, normaliseHidden, toggleHidden, weightsFromWidths } from "../table-column-model.js";
import { DEFAULT_UI_SETTINGS, normaliseUiSettings, readUiSettings, saveUiSettings } from "../ui-settings.js";
import { setupJournalColumns } from "../journal-columns.js";
import { memoryDirectory } from "./memory-directory.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");

test("the header cells carry the column keys in the model order", () => {
  const keys = [...html.matchAll(/<th data-col="([^"]+)">/g)].map((match) => match[1]);
  assert.deepEqual(keys, COLUMNS.map((column) => column.key));
});

test("the model has 19 columns, locked core columns and a minimum preset that hides only unlocked ones", () => {
  assert.equal(COLUMNS.length, 19);
  assert.equal(new Set(COLUMNS.map((column) => column.key)).size, 19);
  for (const key of PRESET_HIDDEN.minimum) assert.equal(COLUMNS[columnIndex(key)].locked, undefined);
  for (const key of ["code", "date", "gross", "net", "vat"]) assert.equal(COLUMNS[columnIndex(key)].locked, true);
});

test("normaliseHidden drops unknown and locked keys and keeps column order; toggling is symmetric", () => {
  assert.deepEqual(normaliseHidden(["agent", "code", "nope", "supplierId", "agent"]), ["supplierId", "agent"]);
  assert.deepEqual(normaliseHidden("x"), []);
  assert.deepEqual(toggleHidden([], "agent"), ["agent"]);
  assert.deepEqual(toggleHidden(["agent"], "agent"), []);
  assert.deepEqual(toggleHidden(["agent"], "code"), ["agent"]);
});

test("column percents sum to 100, hidden columns get 0 and a saved weight wins", () => {
  const hidden = PRESET_HIDDEN.minimum;
  const percents = columnPercents(hidden);
  assert.ok(Math.abs(percents.reduce((sum, value) => sum + value, 0) - 100) < 1e-9);
  for (const key of hidden) assert.equal(percents[columnIndex(key)], 0);
  const wider = columnPercents(hidden, { weights: { details: 40 } });
  assert.ok(wider[columnIndex("details")] > percents[columnIndex("details")]);
  assert.ok(Math.abs(wider.reduce((sum, value) => sum + value, 0) - 100) < 1e-9);
});

test("no visible column is squeezed below the minimum share even with an extreme saved weight", () => {
  const percents = columnPercents([], { weights: { details: 5000 } });
  const visible = percents.filter((value) => value > 0);
  assert.ok(Math.min(...visible) > 1.5);
});

test("dragged widths are stored in the unit of the default weights, so mixing with defaults stays balanced", () => {
  const pixels = COLUMNS.map((column) => column.weight * 40);
  const saved = weightsFromWidths([], pixels);
  for (const column of COLUMNS) assert.ok(Math.abs(saved[column.key] - column.weight) < 0.05, column.key);
  const mixed = weightsFromWidths(["agent"], pixels.map((value, index) => (index === 14 ? 0 : value)), saved);
  assert.equal(mixed.agent, saved.agent);
  const before = columnPercents(["agent"], { weights: {} });
  const after = columnPercents(["agent"], { weights: mixed });
  before.forEach((value, index) => assert.ok(Math.abs(value - after[index]) < 0.2));
  assert.deepEqual(weightsFromWidths([], [], { code: 12 }), { code: 12 });
});

test("ui settings: defaults, normalisation and a round trip through the data root", async () => {
  assert.deepEqual(normaliseUiSettings(null).hiddenColumns, PRESET_HIDDEN.minimum);
  assert.deepEqual(normaliseUiSettings({ hiddenColumns: [] }).hiddenColumns, []);
  assert.deepEqual(normaliseUiSettings({ hiddenColumns: ["agent", "code"] }).hiddenColumns, ["agent"]);
  const dataRoot = memoryDirectory("root");
  assert.deepEqual((await readUiSettings(dataRoot)).hiddenColumns, DEFAULT_UI_SETTINGS.hiddenColumns);
  await saveUiSettings(dataRoot, { hiddenColumns: ["confidence", "bogus"] });
  assert.deepEqual((await readUiSettings(dataRoot)).hiddenColumns, ["confidence"]);
  await saveUiSettings(dataRoot, { hiddenColumns: [] });
  assert.deepEqual((await readUiSettings(dataRoot)).hiddenColumns, []);
});

test("ui settings keep the typed folder path and saving one field leaves the other alone", async () => {
  const dataRoot = memoryDirectory("root");
  assert.equal((await readUiSettings(dataRoot)).folderPath, "");
  await saveUiSettings(dataRoot, { hiddenColumns: ["agent"] });
  await saveUiSettings(dataRoot, { folderPath: "  D:\ocr_data  " });
  const settings = await readUiSettings(dataRoot);
  assert.deepEqual([settings.hiddenColumns, settings.folderPath], [["agent"], "D:\ocr_data"]);
  await saveUiSettings(dataRoot, { hiddenColumns: [] });
  assert.equal((await readUiSettings(dataRoot)).folderPath, "D:\ocr_data");
  assert.equal(normaliseUiSettings({ folderPath: "x".repeat(400) }).folderPath.length, 260);
  assert.equal(normaliseUiSettings({ folderPath: 5 }).folderPath, "");
});

function journal() {
  const dom = new JSDOM(html.replace(/<script\b[^>]*><\/script>/g, ""), { url: "https://vitaliksh.github.io/ocr/" });
  const { document } = dom.window;
  const changes = [];
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  const table = document.querySelector("#journal-table");
  const columns = setupJournalColumns({ table, menu: document.querySelector("#columns-menu"), storage, onChange: (hidden) => changes.push(hidden) });
  return { dom, document, table, columns, changes, store };
}

test("the journal starts with the minimum preset: hidden columns are collapsed and the colgroup adds up", () => {
  const { table } = journal();
  const cols = [...table.querySelectorAll("colgroup col")];
  assert.equal(cols.length, 19);
  assert.ok(Math.abs(cols.reduce((sum, col) => sum + parseFloat(col.style.width), 0) - 100) < 0.01);
  assert.equal(cols[columnIndex("agent")].style.visibility, "collapse");
  assert.equal(cols[columnIndex("details")].style.visibility, "");
  assert.equal(cols[columnIndex("agent")].style.width, "0%");
});

test("the hide button hides a column, the chooser restores it and every change is reported", () => {
  const { table, columns, changes, document } = journal();
  const header = (key) => table.tHead.rows[0].cells[columnIndex(key)];
  header("reference").querySelector(".col-hide").click();
  assert.equal(columns.getHidden().includes("reference"), true);
  assert.equal(table.querySelectorAll("colgroup col")[columnIndex("reference")].style.visibility, "collapse");
  const box = [...document.querySelectorAll("#columns-menu .columns-option")].find((label) => label.textContent === "אסמכתא").querySelector("input");
  assert.equal(box.checked, false);
  box.checked = true;
  box.dispatchEvent(new document.defaultView.Event("change"));
  assert.equal(columns.getHidden().includes("reference"), false);
  assert.equal(changes.length, 2);
  assert.equal(header("code").querySelector(".col-hide"), null);
});

test("the chooser lists every column, disables locked ones and applies presets", () => {
  const { document, columns, changes } = journal();
  const options = [...document.querySelectorAll("#columns-menu .columns-option input")];
  assert.equal(options.length, 19);
  assert.equal(options.filter((box) => box.disabled).length, COLUMNS.filter((column) => column.locked).length);
  const box = [...document.querySelectorAll("#columns-menu .columns-option")].find((label) => label.textContent === "החלטת הסוכן").querySelector("input");
  assert.equal(box.checked, false);
  box.checked = true;
  box.dispatchEvent(new document.defaultView.Event("change"));
  assert.equal(columns.getHidden().includes("agent"), false);
  [...document.querySelectorAll("#columns-menu .columns-presets button")].find((button) => button.textContent === "הכול").click();
  assert.deepEqual(columns.getHidden(), []);
  assert.equal(options.every((item) => item.checked), true);
  [...document.querySelectorAll("#columns-menu .columns-presets button")].find((button) => button.textContent === "מינימום").click();
  assert.deepEqual(columns.getHidden(), PRESET_HIDDEN.minimum);
  assert.equal(changes.length, 3);
});

test("setHidden without persist applies silently (used when a data root is loaded)", () => {
  const { columns, changes } = journal();
  columns.setHidden([], { persist: false });
  assert.deepEqual(columns.getHidden(), []);
  assert.equal(changes.length, 0);
});

test("a forced column is shown whatever the user chose, is never saved and goes back when released", () => {
  const { table, columns, changes, document } = journal();
  const col = () => table.querySelectorAll("colgroup col")[columnIndex("allocation")];
  assert.equal(col().style.visibility, "collapse");
  columns.setForced(["allocation"]);
  assert.equal(col().style.visibility, "");
  assert.ok(parseFloat(col().style.width) > 0);
  assert.equal(columns.getHidden().includes("allocation"), true, "the user choice is untouched");
  assert.equal(changes.length, 0);
  const box = [...document.querySelectorAll("#columns-menu .columns-option")].find((label) => label.textContent === "מספר הקצאה")?.querySelector("input");
  assert.ok(box, "chooser has the allocation option");
  assert.equal(box.checked, true);
  assert.equal(box.disabled, true);
  columns.setForced([]);
  assert.equal(col().style.visibility, "collapse");
  assert.equal(box.disabled, false);
  assert.equal(box.checked, false);
});

test("hidden cells are emptied so zero-width columns cannot make rows tall", () => {
  const css = hiddenCss(["supplierId"], "#t");
  assert.match(css, /#t th:nth-child\(6\), #t td:nth-child\(6\) \{ padding: 0; border: 0; overflow: hidden; font-size: 0; line-height: 0; box-shadow: none; \}/);
  assert.match(css, /#t td:nth-child\(6\) > \* \{ display: none; \}/);
  assert.equal(hiddenCss([], "#t"), "");
  const { document } = journal();
  assert.match(document.querySelector("#journal-columns-style").textContent, /nth-child\(15\)/);
});
