// clients/<client>/rules.md (step 4.6): the line of a confirmed rule, and the user's own edit with its copy; the dialog of the client card.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { cleanRule } from "../rule-text.js";
import { appendRule, readRules, saveRules } from "../rules-store.js";
import { setupClientRules } from "../client-rules-ui.js";
import { addAlias, readAliases } from "../aliases-store.js";
import { binaryDirectory, listPaths, putFile } from "./memory-binary-directory.mjs";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const now = "2026-10-17T09:30:00.000Z";
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test("cleanRule makes one line of single spaces without control characters", () => {
  assert.equal(cleanRule("  ביטוח עסק\nהוא\t\u0007 הוצאה  "), "ביטוח עסק הוא הוצאה");
  assert.equal(cleanRule(null), "");
});

test("appendRule creates the file, adds the date and the confirmation, and never adds the same rule twice", async () => {
  const directory = binaryDirectory();
  assert.deepEqual(await appendRule(directory, "ביטוח עסק הוא הוצאה", { now }), { added: true, line: "- ביטוח עסק הוא הוצאה (2026-10-17, אושר ע״י המשתמש)" });
  assert.equal(await readRules(directory), "- ביטוח עסק הוא הוצאה (2026-10-17, אושר ע״י המשתמש)\n");
  assert.equal((await appendRule(directory, " ביטוח עסק  הוא הוצאה ", { now: "2026-11-01T00:00:00.000Z" })).added, false);
  await appendRule(directory, "דלק הוא הוצאה", { now });
  assert.equal(await readRules(directory), "- ביטוח עסק הוא הוצאה (2026-10-17, אושר ע״י המשתמש)\n- דלק הוא הוצאה (2026-10-17, אושר ע״י המשתמש)\n");
  await assert.rejects(appendRule(directory, " \n "), /ריק/);
});

test("appendRule keeps what the user typed, also a last line without a line break, and knows a typed rule", async () => {
  const directory = binaryDirectory();
  await putFile(directory, "rules.md", "# כללים\n- חניה היא הוצאה");
  assert.equal((await appendRule(directory, "חניה היא הוצאה", { now })).added, false, "the same rule typed by the user");
  await appendRule(directory, "קנס אינו הוצאה", { now });
  assert.equal(await readRules(directory), "# כללים\n- חניה היא הוצאה\n- קנס אינו הוצאה (2026-10-17, אושר ע״י המשתמש)\n");
});

test("saveRules keeps the text before in a copy, writes nothing when nothing changed, and makes no copy of an empty file", async () => {
  const directory = binaryDirectory();
  assert.deepEqual(await saveRules(directory, "- first", { now }), { copy: null, changed: true });
  assert.equal(await readRules(directory), "- first\n");
  assert.deepEqual(await saveRules(directory, "- first\n", { now }), { copy: null, changed: false });
  const saved = await saveRules(directory, "- second\r\n", { now });
  assert.deepEqual(saved, { copy: "rules.before-2026-10-17T09-30-00-000Z.md", changed: true });
  assert.equal(await readRules(directory), "- second\n");
  assert.deepEqual((await listPaths(directory)).sort(), ["rules.before-2026-10-17T09-30-00-000Z.md", "rules.md"]);
  assert.equal(await (await (await directory.getFileHandle(saved.copy)).getFile()).text(), "- first\n");
});

test("the client card has a button for the rules, and its dialog shows, edits and saves rules.md with a copy", async () => {
  const { window } = new JSDOM(html, { url: "https://vitaliksh.github.io/annateria/" });
  const menu = window.document.querySelector("#client-menu");
  assert.equal(menu.querySelector("#client-rules").textContent, "כללים של הלקוח");
  const dialog = window.document.querySelector("#client-rules-dialog");
  dialog.showModal = () => { dialog.open = true; };
  const directory = binaryDirectory("Levi");
  await putFile(directory, "rules.md", "- דלק הוא הוצאה\n");
  const errors = [];
  const rules = setupClientRules({ dialog, onError: (message) => errors.push(message) });
  await rules.open({ clientName: "Levi Plumbing", directory });
  assert.equal(dialog.open, true);
  assert.equal(dialog.querySelector("#client-rules-title").textContent, "כללים של «Levi Plumbing»");
  const text = dialog.querySelector("#client-rules-text");
  assert.equal(text.value, "- דלק הוא הוצאה\n");
  dialog.querySelector("#client-rules-save").click();
  await tick();
  assert.equal(dialog.querySelector("#client-rules-status").textContent, "אין שינויים לשמירה.");
  text.value = "- דלק הוא הוצאה\n- חניה היא הוצאה";
  dialog.querySelector("#client-rules-save").click();
  await tick();
  assert.match(dialog.querySelector("#client-rules-status").textContent, /^נשמר\. עותק של הגרסה הקודמת: rules\.before-.+\.md$/);
  assert.equal(await readRules(directory), "- דלק הוא הוצאה\n- חניה היא הוצאה\n");
  assert.deepEqual(errors, []);
  assert.equal(dialog.querySelector("#client-aliases-list").textContent, "אין עדיין.");
});

test("the rules dialog lists the buyers confirmed as the client, and the user removes one (marked in the file)", async () => {
  const { window } = new JSDOM(html, { url: "https://vitaliksh.github.io/annateria/" });
  const dialog = window.document.querySelector("#client-rules-dialog");
  dialog.showModal = () => { dialog.open = true; };
  const directory = binaryDirectory("Levi");
  await addAlias(directory, { vatId: "300000007", name: "משה לוי" }, { now });
  await addAlias(directory, { vatId: "", name: "דנה לוי" }, { now });
  await setupClientRules({ dialog }).open({ clientName: "Levi", directory });
  const items = () => [...dialog.querySelectorAll("#client-aliases-list li")].map((item) => item.firstChild.textContent);
  assert.deepEqual(items(), ["«משה לוי» · מס׳ 300000007 · נוסף 17/10/2026", "«דנה לוי» · נוסף 17/10/2026"]);
  dialog.querySelector("#client-aliases-list li button").click();
  await tick();
  await tick();
  assert.deepEqual(items(), ["«דנה לוי» · נוסף 17/10/2026"]);
  assert.deepEqual((await readAliases(directory)).aliases.map((alias) => alias.name), ["דנה לוי"]);
  await putFile(directory, "aliases.json", "{ damaged");
  await setupClientRules({ dialog }).open({ clientName: "Levi", directory });
  assert.deepEqual(items(), ["הקובץ aliases.json של הלקוח פגום; הקונים שבו אינם נחשבים."]);
});
