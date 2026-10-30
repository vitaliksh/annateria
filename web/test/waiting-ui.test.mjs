import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { setupWaiting } from "../waiting-ui.js";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");

function setup() {
  const { window } = new JSDOM(html);
  const root = window.document.querySelector("#waiting");
  const gone = [];
  const waiting = setupWaiting({ root, onGo: (target) => gone.push(target) });
  const texts = () => [...root.querySelectorAll(".waiting-item")].map((item) => item.textContent);
  return { root, waiting, gone, texts };
}

test("the page has the strip under the top bar, hidden until something waits (C6)", () => {
  assert.ok(html.indexOf("</header>") < html.indexOf('id="waiting"') && html.indexOf('id="waiting"') < html.indexOf('<main class="workspace">'));
  const { root, texts } = setup();
  assert.equal(root.hidden, true);
  assert.deepEqual(texts(), []);
});

test("each part that waits is one button, in a fixed order, and the strip hides again when all is done", () => {
  const { root, waiting, texts } = setup();
  waiting.set("review", 2);
  waiting.set("inbox", 1);
  waiting.set("imports", [{ name: "journal-08.xlsx" }]);
  waiting.set("question", 1);
  assert.equal(root.hidden, false);
  assert.equal(root.querySelector(".waiting-title").textContent, "ממתין לך");
  assert.deepEqual(texts(), [
    "שאלה של העוזר ממתינה לתשובה", "ייבוא שלא הושלם: journal-08.xlsx", "קובץ אחד בתיבת הקלט", "2 שורות לבדיקה בחודש הפתוח",
  ]);
  assert.equal(root.querySelector("[data-kind='import'] bdi").textContent, "journal-08.xlsx", "a file name is isolated");
  waiting.set("inbox", 5);
  waiting.set("review", 1);
  assert.deepEqual(texts().slice(2), ["5 קבצים בתיבת הקלט", "שורה אחת לבדיקה בחודש הפתוח"]);
  for (const part of ["question", "imports", "inbox", "review"]) waiting.set(part, null);
  assert.equal(root.hidden, true);
});

test("rows to look at in other open months are one entry with their months, at most three shown (C7)", () => {
  const { waiting, texts, gone, root } = setup();
  waiting.set("months", [{ clientId: "a", month: "2026-07", count: 2 }, { clientId: "b", month: "2026-07", count: 1 }]);
  assert.deepEqual(texts(), ["3 שורות לבדיקה ב-07/2026"]);
  waiting.set("months", ["2026-05", "2026-06", "2026-07", "2026-08"].map((month) => ({ clientId: "a", month, count: 1 })));
  assert.deepEqual(texts(), ["4 שורות לבדיקה ב-05/2026, 06/2026, 07/2026…"]);
  root.querySelector(".waiting-item").click();
  assert.deepEqual(gone, [{ kind: "months", index: undefined }]);
  waiting.set("months", []);
  assert.equal(root.hidden, true);
});

test("a click says where to go", () => {
  const { root, waiting, gone } = setup();
  waiting.set("imports", [{ name: "a.xlsx" }, { name: "b.xlsx" }]);
  waiting.set("inbox", 3);
  waiting.set("review", 1);
  for (const item of root.querySelectorAll(".waiting-item")) item.click();
  assert.deepEqual(gone, [{ kind: "import", index: 0 }, { kind: "import", index: 1 }, { kind: "inbox", index: undefined }, { kind: "review", index: undefined }]);
});
