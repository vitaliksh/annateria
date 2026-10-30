import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { ROW_CHIPS, setupWaiting } from "../waiting-ui.js";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");

function setup() {
  const { window } = new JSDOM(html);
  const root = window.document.querySelector("#waiting");
  const gone = [];
  const waiting = setupWaiting({ root, onGo: (target) => gone.push(target) });
  const texts = () => [...root.querySelectorAll(".waiting-item")].map((item) => item.textContent);
  return { root, waiting, gone, texts };
}
const rows = (...items) => items.map(([client, month, count]) => ({ clientId: client, client, month, count }));

test("the page has the strip under the top bar, hidden until something waits (C6)", () => {
  assert.ok(html.indexOf("</header>") < html.indexOf('id="waiting"') && html.indexOf('id="waiting"') < html.indexOf('<main class="workspace">'));
  const { root, texts } = setup();
  assert.equal(root.hidden, true);
  assert.deepEqual(texts(), []);
});

test("each thing that waits is one chip, in a fixed order; a chip of rows names its client and its month", () => {
  const { root, waiting, texts } = setup();
  waiting.set("rows", rows(["אווה", "2026-09", 4], ["Levi", "2026-10", 1]));
  waiting.set("inbox", 1);
  waiting.set("imports", [{ name: "journal-08.xlsx", client: "אווה" }]);
  waiting.set("question", 1);
  assert.equal(root.hidden, false);
  assert.equal(root.querySelector(".waiting-title").textContent, "ממתין לך");
  assert.deepEqual(texts(), [
    "שאלה של העוזר ממתינה לתשובה", "אווה · ייבוא שלא הושלם: journal-08.xlsx", "קובץ אחד בתיבת הקלט",
    "אווה · 09/2026: 4 שורות לבדיקה", "Levi · 10/2026: שורה אחת לבדיקה",
  ]);
  assert.deepEqual([...root.querySelectorAll("[data-kind='import'] bdi")].map((item) => item.textContent), ["אווה", "journal-08.xlsx"], "names are isolated");
  assert.equal(root.querySelector("[data-kind='rows'] bdi").textContent, "אווה");
  for (const part of ["question", "imports", "inbox", "rows"]) waiting.set(part, null);
  assert.equal(root.hidden, true);
});

test(`at most ${ROW_CHIPS} chips of rows, then +N, which opens the list of all clients`, () => {
  const { waiting, texts, root, gone } = setup();
  waiting.set("rows", rows(["A", "2026-01", 1], ["A", "2026-02", 2], ["B", "2026-01", 3], ["C", "2026-03", 1], ["D", "2026-04", 5], ["E", "2026-05", 1]));
  assert.equal(texts().length, ROW_CHIPS + 1);
  assert.equal(texts().at(-1), "+2");
  root.querySelector("[data-kind='more']").click();
  assert.deepEqual(gone, [{ kind: "more", index: undefined }]);
});

test("red only for an import closed before it finished; everything else amber (F4)", () => {
  const { root, waiting } = setup();
  waiting.set("imports", [{ name: "a.xlsx", client: "A", state: "unfinished" }, { name: "b.xlsx", client: "B", state: "waiting" }]);
  waiting.set("inbox", 2);
  waiting.set("question", 1);
  waiting.set("rows", rows(["A", "2026-01", 1]));
  const levels = [...root.querySelectorAll(".waiting-item")].map((item) => [item.dataset.kind, item.dataset.level]);
  assert.deepEqual(levels, [["question", "look"], ["import", "act"], ["import", "look"], ["inbox", "look"], ["rows", "look"]]);
});

test("a click says where to go", () => {
  const { root, waiting, gone } = setup();
  waiting.set("imports", [{ name: "a.xlsx", client: "A" }, { name: "b.xlsx", client: "B" }]);
  waiting.set("inbox", 3);
  waiting.set("rows", rows(["A", "2026-01", 1], ["B", "2026-02", 2]));
  for (const item of root.querySelectorAll(".waiting-item")) item.click();
  assert.deepEqual(gone, [
    { kind: "import", index: 0 }, { kind: "import", index: 1 }, { kind: "inbox", index: undefined }, { kind: "rows", index: 0 }, { kind: "rows", index: 1 },
  ]);
});
