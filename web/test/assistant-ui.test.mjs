import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { FIELD_LABELS, TOOL_LABELS, progressLabel, setupAssistant } from "../assistant-ui.js";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function setup() {
  const { window } = new JSDOM(html, { url: "https://vitaliksh.github.io/annateria/" });
  const commands = [];
  const root = window.document.querySelector("#assistant");
  const assistant = setupAssistant({ root, onCommand: (command) => commands.push(command) });
  const q = (selector) => root.querySelector(selector);
  const messages = () => [...root.querySelectorAll(".assistant-message")].map((node) => [node.dataset.kind, node.textContent]);
  return { window, root, assistant, commands, q, messages, click: (selector) => q(selector).click() };
}
const options = [{ id: "levi", label: "Levi" }, { id: "cohen", label: "Cohen" }];
const card = (extra = {}) => ({ id: "Q1", question: "Whose is this file?", options, allowOther: false, about: { files: [], rows: [] }, remember: null, ...extra });

test("the page has the dock between the workspace and the status bar, with its own stylesheet", () => {
  for (const id of ["assistant", "assistant-toggle", "assistant-progress", "assistant-body", "assistant-feed", "assistant-form", "assistant-input", "assistant-send", "assistant-process", "assistant-left", "assistant-report", "assistant-cancel"]) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.ok(html.indexOf("</main>") < html.indexOf('id="assistant"') && html.indexOf('id="assistant"') < html.indexOf('<footer class="statusbar">'));
  assert.match(html, /<link rel="stylesheet" href="assistant\.css">/);
});

test("the body starts closed and the title opens and closes it", () => {
  const { q, click, root } = setup();
  assert.deepEqual([root.dataset.open, q("#assistant-body").hidden, q("#assistant-toggle").getAttribute("aria-expanded")], ["false", true, "false"]);
  click("#assistant-toggle");
  assert.deepEqual([root.dataset.open, q("#assistant-body").hidden, q("#assistant-toggle").getAttribute("aria-expanded")], ["true", false, "true"]);
  click("#assistant-toggle");
  assert.equal(q("#assistant-body").hidden, true);
});

test("the two quick buttons show what was asked and start a run; the report button just asks to open the reports", () => {
  const { click, commands, messages } = setup();
  click("#assistant-process");
  click("#assistant-left");
  click("#assistant-report");
  assert.deepEqual(commands, [{ type: "process" }, { type: "left" }, { type: "report" }]);
  assert.deepEqual(messages(), [["user", "עבד חדשים"], ["user", "מה נשאר?"]]);
});

test("a typed line is trimmed, shown, cleared from the field and sent; an empty one is ignored", () => {
  const { q, commands, messages, window } = setup();
  const send = (text) => { q("#assistant-input").value = text; q("#assistant-form").dispatchEvent(new window.Event("submit", { cancelable: true })); };
  send("   ");
  send("  show the invoices of Levi  ");
  assert.deepEqual(commands, [{ type: "text", text: "show the invoices of Levi" }]);
  assert.deepEqual(messages(), [["user", "show the invoices of Levi"]]);
  assert.equal(q("#assistant-input").value, "");
});

test("while a run is on, the buttons and the field are off, stop is shown and the panel is open; afterwards it is back and the progress is cleared", () => {
  const { assistant, q, click, commands, window } = setup();
  assistant.setProgress("קורא מסמך (2)");
  assistant.setBusy(true);
  assert.deepEqual(["#assistant-process", "#assistant-left", "#assistant-input", "#assistant-send"].map((id) => q(id).disabled), [true, true, true, true]);
  assert.deepEqual([q("#assistant-cancel").hidden, q("#assistant-body").hidden, assistant.isBusy()], [false, false, true]);
  q("#assistant-input").value = "typed while busy";
  q("#assistant-form").dispatchEvent(new window.Event("submit", { cancelable: true }));
  q("#assistant-process").disabled = false;
  click("#assistant-process");
  click("#assistant-cancel");
  click("#assistant-report");
  assert.deepEqual(commands, [{ type: "cancel" }, { type: "report" }], "only stop and the report work during a run");
  assert.equal(q("#assistant-progress").textContent, "קורא מסמך (2)");
  assistant.setBusy(false);
  assert.deepEqual([q("#assistant-process").disabled, q("#assistant-cancel").hidden, q("#assistant-progress").textContent], [false, true, ""]);
});

test("what the agent says is text, never HTML", () => {
  const { assistant, q } = setup();
  assistant.addMessage("assistant", '<img src=x onerror="alert(1)"> שלום');
  assert.equal(q(".assistant-message img"), null);
  assert.equal(q(".assistant-message").textContent, '<img src=x onerror="alert(1)"> שלום');
});

test("a question card: question, files, buttons; a click answers once and locks the card", async () => {
  const { assistant, q, root } = setup();
  const pending = assistant.ui.ask(card({ about: { files: [{ file: "F1", name: "scan 1.jpg", folder: "_unsorted" }, { file: "F2", name: "scan 2.jpg", folder: "_unsorted" }], rows: [] } }));
  assert.equal(q("#assistant-body").hidden, false);
  assert.equal(q(".assistant-card .card-text").textContent, "Whose is this file?");
  assert.equal(q(".card-about").textContent, "scan 1.jpg · scan 2.jpg");
  const buttons = [...root.querySelectorAll(".card-options button")];
  assert.deepEqual(buttons.map((node) => node.textContent), ["Levi", "Cohen", "דלג"]);
  buttons[1].click();
  buttons[0].click();
  assert.deepEqual(await pending, { type: "option", id: "cohen" });
  assert.deepEqual([q(".assistant-card").dataset.state, q(".card-answer").textContent], ["answered", "נבחר: Cohen"]);
  assert.equal([...root.querySelectorAll(".assistant-card button")].every((node) => node.disabled), true);
  assert.equal(root.querySelectorAll(".card-answer").length, 1);
});

test("a question can be skipped, or answered with another text by the button or by Enter; an empty text does nothing", async () => {
  const skipped = setup();
  const first = skipped.assistant.ui.ask(card({ allowOther: true }));
  skipped.root.querySelector(".card-options .link").click();
  assert.deepEqual(await first, { type: "dismissed" });

  const typed = setup();
  const second = typed.assistant.ui.ask(card({ allowOther: true }));
  const input = typed.q(".card-other input");
  typed.q(".card-other button").click();
  input.value = "   ";
  input.dispatchEvent(new typed.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  input.value = "  the tax office  ";
  input.dispatchEvent(new typed.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.deepEqual(await second, { type: "other", text: "the tax office" });
  assert.equal(typed.q(".card-answer").textContent, "נבחר: the tax office");
  assert.equal(setup().q(".card-other"), null);
  const without = setup();
  without.assistant.ui.ask(card());
  assert.equal(without.q(".card-other"), null, "no other-field unless the agent allowed it");
});

test("remember for this client: the box shows the rule exactly, and the answer says whether it was ticked", async () => {
  const offer = card({ remember: { client: "Levi Plumbing", rule: "ביטוח עסק הוא הוצאה מוכרת" } });
  const ticked = setup();
  const first = ticked.assistant.ui.ask(offer);
  assert.match(ticked.q(".assistant-card label").textContent, /זכור ללקוח «Levi Plumbing»: ביטוח עסק הוא הוצאה מוכרת/);
  ticked.q(".assistant-card label input").click();
  ticked.root.querySelector(".card-options button").click();
  assert.deepEqual(await first, { type: "option", id: "levi", remember: true });
  const unticked = setup();
  const second = unticked.assistant.ui.ask(offer);
  unticked.root.querySelector(".card-options button").click();
  assert.deepEqual(await second, { type: "option", id: "levi", remember: false });
  const none = setup();
  const third = none.assistant.ui.ask(card());
  none.root.querySelector(".card-options button").click();
  assert.deepEqual(await third, { type: "option", id: "levi" }, "no remember key when none was offered");
});

test("a run that is stopped closes its open question without answering it", async () => {
  const { assistant, q, root } = setup();
  const controller = new AbortController();
  let settled = false;
  assistant.ui.ask(card(), { signal: controller.signal }).then(() => { settled = true; });
  controller.abort();
  root.querySelector(".card-options button").click();
  await tick();
  assert.deepEqual([q(".assistant-card").dataset.state, settled, q(".card-answer").textContent], ["cancelled", false, "הריצה הופסקה"]);
  assert.equal([...root.querySelectorAll(".assistant-card button, .assistant-card input")].every((node) => node.disabled), true);
});

test("a proposal card lists the changes in Hebrew with the row number, the month and the reason, and says that nothing was applied", async () => {
  const { assistant, q } = setup();
  await assistant.ui.propose({
    id: "P1", client: { id: "id-Levi", name: "Levi Plumbing" }, title: "תיקון תאריכים",
    changes: [
      { row: "R1", documentId: "d-1", month: "2026-02", position: 3, field: "date", value: "2026-02-20", reason: "התאריך בצילום שונה" },
      { row: "R2", documentId: "d-2", month: "2026-02", position: 9, field: "include", value: false, reason: "כפילות" },
      { row: "R3", documentId: "d-3", month: "2026-02", position: 12, field: "month", value: "2026-03", reason: "חודש אחר" },
      { row: "R4", documentId: "d-4", month: "2026-02", position: 32, field: "allocation_number", value: "", reason: "מחיקה" },
    ],
  });
  assert.equal(q(".assistant-card[data-kind='proposal'] .card-text").textContent, "תיקון תאריכים");
  assert.match(q(".card-about").textContent, /Levi Plumbing.*עדיין לא הוחלה/);
  assert.deepEqual([...q(".card-changes").children].map((item) => item.textContent), [
    "שורה 3 (02/2026) · תאריך: 2026-02-20 — התאריך בצילום שונה",
    "שורה 9 (02/2026) · לייצוא: לא — כפילות",
    "שורה 12 (02/2026) · חודש: 03/2026 — חודש אחר",
    "שורה 32 (02/2026) · מספר הקצאה: (ריק) — מחיקה",
  ]);
  assert.equal(q("#assistant-body").hidden, false);
  assert.equal(q(".assistant-card[data-kind='proposal'] button"), null, "applying comes with step 4.4");
});

test("the progress line names what the agent is doing and counts the documents read", () => {
  const counts = {};
  assert.equal(progressLabel({ type: "turn", turn: 1 }, counts), "חושב…");
  assert.equal(progressLabel({ type: "call", name: "list_inbox" }, counts), TOOL_LABELS.list_inbox);
  assert.equal(progressLabel({ type: "call", name: "extract_document" }, counts), "קורא מסמך (1)");
  assert.equal(progressLabel({ type: "call", name: "extract_document" }, counts), "קורא מסמך (2)");
  assert.equal(progressLabel({ type: "call", name: "something_new" }, counts), "עובד…");
  for (const name of ["list_inbox", "read_document", "extract_document", "find_client", "get_client_context", "query_rows", "facts_for", "ask_user", "propose_change"]) assert.ok(TOOL_LABELS[name], name);
  for (const field of ["date", "supplier_name", "purpose", "supplier_vat_id", "document_number", "allocation_number", "net", "vat", "total", "account", "vat_recognized_percent", "expense_recognized_percent", "include", "month"]) assert.ok(FIELD_LABELS[field], field);
});
