import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { FIELD_LABELS, TOOL_LABELS, progressLabel, setupAssistant } from "../assistant-ui.js";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function setup({ onApply, onRemember, onRememberAlias } = {}) {
  const { window } = new JSDOM(html, { url: "https://vitaliksh.github.io/annateria/" });
  const commands = [];
  const root = window.document.querySelector("#assistant");
  const assistant = setupAssistant({ root, onCommand: (command) => commands.push(command), ...(onApply ? { onApply } : {}), ...(onRemember ? { onRemember } : {}), ...(onRememberAlias ? { onRememberAlias } : {}) });
  const q = (selector) => root.querySelector(selector);
  const messages = () => [...root.querySelectorAll(".assistant-message")].map((node) => [node.dataset.kind, node.textContent]);
  return { window, root, assistant, commands, q, messages, click: (selector) => q(selector).click() };
}
const options = [{ id: "levi", label: "Levi" }, { id: "cohen", label: "Cohen" }];
const card = (extra = {}) => ({ id: "Q1", question: "Whose is this file?", options, allowOther: false, about: { files: [], rows: [] }, remember: null, ...extra });

test("the page has the dock between the workspace and the status bar, with its own stylesheet", () => {
  for (const id of ["assistant", "assistant-toggle", "assistant-progress", "assistant-body", "assistant-feed", "assistant-form", "assistant-input", "assistant-send", "assistant-process", "assistant-left", "assistant-report", "assistant-cancel", "assistant-minimize"]) {
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
  assert.deepEqual(messages(), [["user", "בדוק מסמכים חדשים"], ["user", "מה נשאר?"]]);
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

test("remember for this client: the box shows the rule exactly; the page writes it only for the ticked box and the answer of the rule", async () => {
  const offer = card({ remember: { client: "Levi Plumbing", clientId: "id-Levi", rule: "ביטוח עסק הוא הוצאה מוכרת", option: "levi", optionLabel: "Levi" } });
  const written = [];
  const onRemember = async (item) => { written.push(item); return { added: written.length === 1 }; };
  const ticked = setup({ onRemember });
  const first = ticked.assistant.ui.ask(offer);
  assert.match(ticked.q(".assistant-card label").textContent, /זכור ללקוח «Levi Plumbing» \(בתשובה «Levi»\): ביטוח עסק הוא הוצאה מוכרת/);
  ticked.q(".assistant-card label input").click();
  ticked.root.querySelector(".card-options button").click();
  assert.deepEqual(await first, { type: "option", id: "levi", remember: true, saved: true });
  assert.deepEqual(written, [{ clientId: "id-Levi", rule: "ביטוח עסק הוא הוצאה מוכרת" }]);
  assert.ok(ticked.root.textContent.includes("הכלל נשמר בכללים של הלקוח."));
  const again = setup({ onRemember });
  const repeated = again.assistant.ui.ask(offer);
  again.q(".assistant-card label input").click();
  again.root.querySelector(".card-options button").click();
  assert.deepEqual(await repeated, { type: "option", id: "levi", remember: true, saved: true });
  assert.ok(again.root.textContent.includes("הכלל כבר רשום בכללים של הלקוח."));
  const wrong = setup({ onRemember });
  const otherAnswer = wrong.assistant.ui.ask(offer);
  wrong.q(".assistant-card label input").click();
  wrong.root.querySelectorAll(".card-options button")[1].click();
  assert.deepEqual(await otherAnswer, { type: "option", id: "cohen", remember: true, saved: false });
  assert.ok(wrong.root.textContent.includes("הכלל לא נשמר: נבחרה תשובה אחרת."));
  const failing = setup({ onRemember: async () => { throw new Error("אין הרשאה"); } });
  const failed = failing.assistant.ui.ask(offer);
  failing.q(".assistant-card label input").click();
  failing.root.querySelector(".card-options button").click();
  assert.deepEqual(await failed, { type: "option", id: "levi", remember: true, saved: false });
  assert.ok(failing.root.textContent.includes("הכלל לא נשמר: אין הרשאה"));
  assert.equal(written.length, 2, "nothing was written for the other answer");
  const unticked = setup({ onRemember });
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
  assert.equal(q(".assistant-card[data-kind='proposal'] button"), null, "without a handler the card only shows the changes");
});

test("the progress line names what the agent is doing and counts the documents read", () => {
  const counts = {};
  assert.equal(progressLabel({ type: "turn", turn: 1 }, counts), "חושב…");
  assert.equal(progressLabel({ type: "call", name: "list_inbox" }, counts), TOOL_LABELS.list_inbox);
  assert.equal(progressLabel({ type: "call", name: "extract_document" }, counts), "קורא מסמך (1)");
  assert.equal(progressLabel({ type: "call", name: "extract_document" }, counts), "קורא מסמך (2)");
  assert.equal(progressLabel({ type: "call", name: "something_new" }, counts), "עובד…");
  assert.equal(progressLabel({ type: "done", name: "extract_document", ok: true }, counts), null, "a finished call only updates the counts");
  assert.equal(progressLabel({ type: "turn", turn: 2 }, counts), "חושב…");
  for (const name of ["list_inbox", "read_document", "extract_document", "find_client", "get_client_context", "query_rows", "facts_for", "ask_user", "propose_change"]) assert.ok(TOOL_LABELS[name], name);
  for (const field of ["date", "supplier_name", "purpose", "supplier_vat_id", "document_number", "allocation_number", "net", "vat", "total", "account", "vat_recognized_percent", "expense_recognized_percent", "include", "month"]) assert.ok(FIELD_LABELS[field], field);
});

test("the progress line counts the files read, the rows added and the originals filed", () => {
  const counts = {};
  const files = [{ kind: "image", status: "waiting" }, { kind: "pdf", status: "waiting" }, { kind: "spreadsheet", status: "waiting" }, { kind: "pdf", status: "filed" }];
  progressLabel({ type: "done", name: "list_inbox", ok: true, result: { files } }, counts);
  assert.equal(counts.total, 2, "spreadsheets and files that are not waiting are not counted");
  assert.equal(progressLabel({ type: "call", name: "extract_document" }, counts), "קורא מסמך (1) · נקראו 0 מתוך 2");
  progressLabel({ type: "done", name: "extract_document", ok: true, result: {} }, counts);
  assert.equal(progressLabel({ type: "turn", turn: 2 }, counts), "חושב… · נקראו 1 מתוך 2");
  progressLabel({ type: "done", name: "extract_document", ok: true, result: {} }, counts);
  progressLabel({ type: "done", name: "add_rows", ok: true, result: { rows: [{ state: "created" }, { state: "rejected" }, { state: "moved_month" }] } }, counts);
  assert.equal(progressLabel({ type: "call", name: "move_file_to_declaration" }, counts), "מתייק את המקור · נקראו 2 מתוך 2 · נוספו 2 שורות");
  progressLabel({ type: "done", name: "move_file_to_declaration", ok: true, result: { state: "filed" } }, counts);
  assert.equal(progressLabel({ type: "turn", turn: 3 }, counts), "חושב… · נקראו 2 מתוך 2 · נוספו 2 שורות · תויקו 1");
});

test("a new step replaces the line, and the line is cleared when the run ends", () => {
  const { assistant, q } = setup();
  assistant.setBusy(true);
  assistant.setProgress("חושב…");
  assert.equal(q("#assistant-progress").textContent, "חושב…");
  assistant.setProgress("קורא מסמך (1)");
  assert.equal(q("#assistant-progress").textContent, "קורא מסמך (1)");
  assistant.setBusy(false);
  assert.equal(q("#assistant-progress").textContent, "");
});

test("a quick request can also be started from elsewhere: it shows the same line, and does nothing while a run is on", () => {
  const { assistant, commands, messages } = setup();
  assert.equal(assistant.trigger("process"), true);
  assistant.setBusy(true);
  assert.equal(assistant.trigger("left"), false);
  assert.deepEqual(commands, [{ type: "process" }]);
  assert.deepEqual(messages(), [["user", "בדוק מסמכים חדשים"]]);
});

test("the button of the dock says what it does and what it does not do", () => {
  const { q } = setup();
  assert.equal(q("#assistant-process").textContent, "בדוק מסמכים חדשים");
  assert.match(q("#assistant-process").title, /מוסיף שורות לטבלאות.*מתייק את המקורות.*שואל כשצריך/);
});

const proposal = () => ({
  id: "P1", client: { id: "id-Levi", name: "Levi Plumbing" }, title: "תיקון",
  changes: [
    { row: "R1", documentId: "d-1", month: "2026-02", position: 3, field: "date", value: "2026-02-20", reason: "ראשון" },
    { row: "R2", documentId: "d-2", month: "2026-02", position: 9, field: "purpose", value: "x", reason: "שני" },
    { row: "R3", documentId: "d-3", month: "2026-02", position: 12, field: "include", value: false, reason: "שלישי" },
  ],
});

test("a proposal with a handler: each change is ticked, apply sends the ticked ones and the card says what was done and what was refused", async () => {
  const calls = [];
  const { assistant, q, root } = setup({ onApply: async (given, kept) => { calls.push([given.id, kept]); return { applied: [given.changes[kept[0]]], refused: [{ change: given.changes[kept[1]], reason: "הטבלה השתנתה" }] }; } });
  assistant.ui.propose(proposal());
  const ticks = [...root.querySelectorAll(".card-changes input")];
  assert.deepEqual(ticks.map((tick) => tick.checked), [true, true, true]);
  assert.match(q(".card-changes li").textContent, /שורה 3 \(02\/2026\) · תאריך: 2026-02-20 — ראשון/);
  ticks[2].click();
  const [apply, reject] = [...root.querySelectorAll(".assistant-card[data-kind='proposal'] .card-options button")];
  assert.deepEqual([apply.textContent, reject.textContent], ["החל", "דחה"]);
  apply.click();
  await tick();
  assert.deepEqual(calls, [["P1", [0, 1]]]);
  assert.match(q(".assistant-card[data-kind='proposal'] .card-about").textContent, /הוחלו 1 מתוך 2 שינויים/);
  assert.equal(q(".card-answer").textContent, "שורה 9: הטבלה השתנתה");
  assert.equal([...root.querySelectorAll(".assistant-card button, .assistant-card input")].every((node) => node.disabled), true);
  apply.click();
  await tick();
  assert.equal(calls.length, 1, "a card is applied once");
});

test("a proposal can be turned down, applied with nothing ticked (nothing happens), or fail with a message", async () => {
  let called = 0;
  const rejected = setup({ onApply: async () => { called += 1; return { applied: [], refused: [] }; } });
  rejected.assistant.ui.propose(proposal());
  rejected.root.querySelector(".card-options .link").click();
  assert.match(rejected.q(".card-about").textContent, /ההצעה נדחתה/);
  assert.equal(called, 0);

  const none = setup({ onApply: async () => { called += 1; return { applied: [], refused: [] }; } });
  none.assistant.ui.propose(proposal());
  for (const tick of none.root.querySelectorAll(".card-changes input")) tick.click();
  none.root.querySelector(".card-options button").click();
  await tick();
  assert.equal(called, 0);
  assert.equal(none.q(".assistant-card[data-kind='proposal'] button").disabled, false, "the card stays open");

  const failing = setup({ onApply: async () => { throw new Error("disk full"); } });
  failing.assistant.ui.propose(proposal());
  failing.root.querySelector(".card-options button").click();
  await tick();
  assert.match(failing.q(".card-about").textContent, /לא ניתן להחיל: disk full/);
});

test("a clear button minimizes the open dock; it is there only while the dock is open", () => {
  const { root, q, click, assistant } = setup();
  assert.equal(q("#assistant-minimize").hidden, true, "closed: nothing to minimize");
  click("#assistant-toggle");
  assert.equal(q("#assistant-minimize").hidden, false);
  assert.match(q("#assistant-minimize").textContent, /מזער/);
  click("#assistant-minimize");
  assert.deepEqual([root.dataset.open, q("#assistant-body").hidden, q("#assistant-minimize").hidden], ["false", true, true]);
  assistant.open(true);
  assert.equal(q("#assistant-minimize").hidden, false, "a question or a run opens it again with the button");
});

test("after a run the dock offers a button for each month that got rows; a click asks to open that month", () => {
  const { assistant, commands, q } = setup();
  assistant.showPlaced([]);
  assert.equal(q(".assistant-card[data-kind='placed']"), null, "nothing was added: nothing to offer");
  assistant.showPlaced([{ clientId: "id-Levi", month: "2026-01", count: 5 }, { clientId: "id-Levi", month: "2026-03", count: 1 }]);
  const buttons = [...q(".assistant-card[data-kind='placed']").querySelectorAll("button")];
  assert.deepEqual(buttons.map((button) => button.textContent), ["01/2026 · 5 שורות", "03/2026 · 1 שורות"]);
  buttons[1].click();
  assert.deepEqual(commands.at(-1), { type: "open", clientId: "id-Levi", month: "2026-03" });
});

// --- the card of an import file (prepare_import, step 4.7.2) ---
const importCard = (extra = {}) => ({
  id: "I1", kind: "journal", reason: "זה יומן קליטה של ריבהיט", month: null, file: { name: "journal-08.xlsx", hash: "a".repeat(64), folder: "Levi" }, client: { id: "c1", name: "Levi" },
  summary: { rows: 8, known_accounts: 6, new_accounts: 2, month: "2026-08", own_chart: false }, checks: [], problems: [],
  totals: { net: 13520.5, vat: 1280.31, gross: 15840.19 }, ...extra,
});

test("the card of an import file says what the file is, what was found and what is wrong, and does nothing by itself", () => {
  const { assistant, q, commands } = setup();
  assistant.ui.importCard(importCard({ problems: [
    { code: "footer-mismatch", severity: "error", count: 1, key: "totalVat" },
    { code: "month_has_rows", severity: "warning", count: 3 },
    { code: "draft-rows", severity: "warning", count: 8 },
  ] }));
  const card = q(".assistant-card[data-kind='import']");
  assert.ok(card);
  const text = card.textContent;
  for (const part of ["זה יומן קליטה של ריבהיט", "יומן קליטה (Rivhit)", "journal-08.xlsx", "«Levi»", "8 שורות", "15,840.19", "08/2026", "2 שמות קודי מיון חדשים"]) assert.ok(text.includes(part), part);
  assert.match(text, /שגיאה: סכום «סה״כ מע״מ לחודש» בסוף הקובץ אינו תואם/);
  assert.match(text, /אזהרה: בחודש הזה כבר יש 3 שורות/);
  assert.match(text, /אזהרה: ל-8 שורות סטטוס «טיוטא»/);
  assert.equal(q("#assistant-body").hidden, false, "the panel opens");
  assert.deepEqual(commands, [], "no wizard before the click");
});

test("the button of the card asks the page to open the wizard, and the page tells the card what happened", () => {
  const { assistant, q, commands } = setup();
  const data = importCard();
  assistant.ui.importCard(data);
  const button = [...q(".assistant-card[data-kind='import']").querySelectorAll("button")].find((item) => item.textContent === "פתח אשף");
  button.click();
  assert.equal(commands.length, 1);
  assert.deepEqual([commands[0].type, commands[0].card.id, commands[0].card.file.hash], ["import", "I1", "a".repeat(64)]);
  commands[0].report({ text: "האשף נפתח." });
  assert.equal(q(".assistant-card[data-kind='import'] .card-answer").textContent, "האשף נפתח.");
  assert.equal(button.disabled, false, "the wizard can be opened again if it was closed without writing");
  commands[0].report({ text: "הייבוא בוצע.", done: true });
  assert.equal(button.disabled, true);
  assert.equal(q(".assistant-card[data-kind='import']").dataset.state, "answered");
});

test("the button of the card waits while a run is on", () => {
  const { assistant, q, commands } = setup();
  assistant.ui.importCard(importCard());
  assistant.setBusy(true);
  [...q(".assistant-card[data-kind='import']").querySelectorAll("button")].find((item) => item.textContent === "פתח אשף").click();
  assert.deepEqual(commands, []);
  assert.match(q(".assistant-card[data-kind='import'] .card-answer").textContent, /להמתין לסיום הריצה/);
});

test("prepare_import has a label for the progress line", () => {
  assert.equal(TOOL_LABELS.prepare_import, "בודק קובץ לייבוא");
  assert.equal(progressLabel({ type: "call", name: "prepare_import" }, {}), "בודק קובץ לייבוא");
});

test("the question about the client has a list of the other clients; choosing one answers with its option and locks the card", async () => {
  const { assistant, q } = setup();
  const answer = assistant.ui.ask(card({ question: "לאיזה לקוח?", options: [{ id: "client1", label: "Levi" }], more: [{ id: "list1", label: "Cohen" }, { id: "list2", label: "Pcn" }] }));
  const box = q(".assistant-card[data-kind='question']");
  const list = box.querySelector("select");
  assert.deepEqual([...list.options].map((option) => option.textContent), ["לקוח אחר…", "Cohen", "Pcn"]);
  const pick = [...box.querySelectorAll("button")].find((item) => item.textContent === "בחירה");
  pick.click();
  assert.equal(box.dataset.state, undefined, "nothing chosen yet: no answer");
  list.value = "list2";
  pick.click();
  assert.deepEqual(await answer, { type: "option", id: "list2" });
  assert.equal(list.disabled, true);
  assert.match(box.textContent, /נבחר: Pcn/);
});

test("the card of a classification-codes ledger says how many codes and which imported rows get new codes", () => {
  const { assistant, q } = setup();
  assistant.ui.importCard(importCard({
    kind: "ledger_codes", totals: null, file: { name: "codes.pdf", hash: "b".repeat(64), folder: "Levi" },
    summary: { accounts: 42, had_own_chart: true, rows_to_remap: 7, months_to_remap: ["2026-01", "2026-03"], month: null },
    problems: [{ code: "replaces_own_chart", severity: "warning", count: 1 }, { code: "locked_months_not_remapped", severity: "warning", count: 2 }],
  }));
  const text = q(".assistant-card[data-kind='import']").textContent;
  for (const part of ["כרטסת קודי מיון (Rivhit)", "42 קודי מיון בכרטסת", "7 שורות שיובאו מ-Excel יקבלו את הקודים החדשים (01/2026, 03/2026)", "יוחלפו בקודים שבכרטסת", "ב-2 הצהרות נעולות"]) assert.ok(text.includes(part), part);
  assert.equal(text.includes("undefined"), false);
});

test("the card of an operations ledger says how many operations are in the tables and how many are missing", () => {
  const { assistant, q } = setup();
  assistant.ui.importCard(importCard({
    kind: "ledger_check", totals: null, file: { name: "ledger.pdf", hash: "c".repeat(64), folder: "Levi" },
    summary: { year: 2026, operations: 120, matched: 115, missing: 5, can_add: 3, months_created: 1, extra: 2, month: null },
    problems: [{ code: "operations_missing", severity: "warning", count: 5 }, { code: "missing_unknown_class", severity: "warning", count: 2 }, { code: "rows_not_in_ledger", severity: "warning", count: 2 }],
  }));
  const text = q(".assistant-card[data-kind='import']").textContent;
  for (const part of ["כרטסת עם פעולות (Rivhit)", "120 פעולות בכרטסת לשנת 2026: 115 קיימות בהצהרות, 5 חסרות", "3 מהחסרות אפשר להוסיף באשף (1 הצהרות ייווצרו)", "אין קוד מיון אצל הלקוח", "אין התאמה בכרטסת"]) assert.ok(text.includes(part), part);
  assert.equal(text.includes("undefined"), false);
});

test("the question about the client says why each button is offered", () => {
  const { assistant, q } = setup();
  assistant.ui.ask(card({ question: "לאיזה לקוח?", options: [{ id: "client1", label: "Pcn", hint: "open" }, { id: "client2", label: "Levi", hint: "name_partial" }, { id: "mixed", label: "לקוחות שונים" }], more: [] }));
  assert.match(q(".assistant-card[data-kind='question']").textContent, /Pcn: הלקוח הפתוח כעת · Levi: נמצא לפי שם דומה, לא בטוח/);
});

test("an import card that may be of another client shows that first, as an error", () => {
  const { assistant, q } = setup();
  assistant.ui.importCard(importCard({
    kind: "ledger_check", totals: null, summary: { year: 2026, operations: 224, matched: 14, missing: 210, can_add: 210, months_created: 2, extra: 42, month: null },
    problems: [{ code: "maybe_other_client", severity: "error", count: 1 }, { code: "operations_missing", severity: "warning", count: 210 }],
  }));
  const items = [...q(".assistant-card[data-kind='import'] .card-changes").children].map((item) => item.textContent);
  assert.match(items.find((item) => item.startsWith("שגיאה")), /ייתכן שהכרטסת של לקוח אחר/);
});

test("the card of an income report says the period, the sums and where the rows go", () => {
  const { assistant, q } = setup();
  assistant.ui.importCard(importCard({
    kind: "income_report", file: { name: "report.pdf", hash: "d".repeat(64), folder: "Levi" }, totals: { net: 250.5, vat: 45.09, gross: 295.59 },
    summary: { month: "2026-02", period_from: "2026-02-01", period_to: "2026-02-28", documents: 5, rows_to_add: 2, verified: true },
    problems: [{ code: "sum-differs", severity: "warning", count: 1, key: "vat" }, { code: "month_missing", severity: "error", count: 1 }],
  }));
  const text = q(".assistant-card[data-kind='import']").textContent;
  for (const part of ["דוח הכנסות תקופתי (חשבונית ירוקה)", "01/02/2026–28/02/2026: 5 מסמכים", "ללא מע״מ 250.50", "כולל 295.59", "שתי שורות (חייב ופטור) תתווסף להצהרה 02/2026; הפירוט תואם לסיכום", "סכום הפירוט שונה מהסיכום", "שגיאה: אין הצהרה לחודש של הדוח"]) assert.ok(text.includes(part), part);
  assert.equal(text.includes("undefined"), false);
});

test("which client: the box keeps the printed buyer for the chosen client, through the page, and only when a client is chosen", async () => {
  const offer = card({ question: "לאיזה לקוח?", options: [...options, { id: "mixed", label: "לקוחות שונים" }], alias: { vatId: "300000007", name: "משה לוי", clients: { levi: "id-Levi", cohen: "id-Cohen" } } });
  const kept = [];
  const onRememberAlias = async (item) => { kept.push(item); return { added: true }; };
  const ticked = setup({ onRememberAlias });
  const first = ticked.assistant.ui.ask(offer);
  assert.match(ticked.q(".assistant-card label").textContent, /לזכור: מסמכים שהקונה בהם «משה לוי» מס׳ 300000007 שייכים ללקוח שייבחר/);
  ticked.q(".assistant-card label input").click();
  ticked.root.querySelectorAll(".card-options button")[1].click();
  assert.deepEqual(await first, { type: "option", id: "cohen", alias: true, aliasSaved: true });
  assert.deepEqual(kept, [{ clientId: "id-Cohen", vatId: "300000007", name: "משה לוי" }]);
  assert.ok(ticked.root.textContent.includes("הקונה נשמר ללקוח «Cohen»."));
  const mixed = setup({ onRememberAlias });
  const second = mixed.assistant.ui.ask(offer);
  mixed.q(".assistant-card label input").click();
  mixed.root.querySelectorAll(".card-options button")[2].click();
  assert.deepEqual(await second, { type: "option", id: "mixed", alias: true, aliasSaved: false });
  assert.ok(mixed.root.textContent.includes("הקונה לא נשמר: לא נבחר לקוח."));
  const unticked = setup({ onRememberAlias });
  const third = unticked.assistant.ui.ask(offer);
  unticked.root.querySelector(".card-options button").click();
  assert.deepEqual(await third, { type: "option", id: "levi", alias: false });
  assert.equal(kept.length, 1);
});
