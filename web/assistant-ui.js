// The assistant dock (#assistant, step 4.3): a bar that is always there (progress line, the quick buttons), and a body that opens
// with the conversation: what the user asked and what the agent answered. The agent works quietly (the owner, 11 November 2026: cards
// and buttons in the panel are not seen): a question or a suggestion of the agent, and the end of a run, are dialogs over the page, one
// at a time. This file only draws and reports clicks: what a button does (start a run, cancel, open a report) is decided by the caller
// through onCommand.
// All text from the agent is put in with textContent; nothing it says is ever HTML.
import { problemText } from "./excel-import-ui.js";
import { formatMonth } from "./month-format.js";

export const TOOL_LABELS = {
  list_inbox: "בודק את תיבת הקלט",
  read_document: "בודק קובץ",
  extract_document: "קורא מסמך",
  find_client: "מחפש לקוח",
  get_client_context: "קורא את פרטי הלקוח",
  query_rows: "בודק את הטבלה",
  facts_for: "בודק את הכללים",
  ask_user: "ממתין לתשובה שלך",
  propose_change: "מכין הצעה",
  add_rows: "מוסיף שורות לטבלה",
  move_file_to_declaration: "מתייק את המקור",
  prepare_import: "בודק קובץ לייבוא",
};

export const FIELD_LABELS = {
  date: "תאריך", supplier_name: "ספק", purpose: "פרטים", supplier_vat_id: "ע.מ. ספק", document_number: "אסמכתא", allocation_number: "מספר הקצאה",
  net: "ללא מע״מ", vat: "מע״מ", total: "כולל מע״מ", account: "קוד מיון", vat_recognized_percent: "% מוכר מע״מ",
  expense_recognized_percent: "% מוכר כהוצאה", include: "לייצוא", month: "חודש",
};

export const COMMAND_LABELS = { process: "בדוק מסמכים חדשים", left: "מה נשאר?" };

// The card of an import file (prepare_import): what the file is, what was found in it, and the button that opens the wizard.
const IMPORT_KINDS = { journal: "יומן קליטה (Rivhit)", ledger_codes: "כרטסת קודי מיון (Rivhit)", ledger_check: "כרטסת עם פעולות (Rivhit), לבדיקה מול ההצהרות", income_report: "דוח הכנסות תקופתי (חשבונית ירוקה)" };
const IMPORT_PROBLEMS = {
  month_locked: () => "ההצהרה לחודש הזה נעולה, אי אפשר לייבא אליה.",
  month_has_rows: (item) => `בחודש הזה כבר יש ${item.count} שורות; באשף אפשר להחליף אותן (עותק של הטבלה הישנה יישמר).`,
  month_differs: () => "החודש בקובץ שונה מהחודש הפתוח; הנתונים ייכנסו לחודש הפתוח ויסומנו לבדיקה.",
  rows_other_months: (item) => `${item.count} שורות בקובץ מחודשים אחרים; הן ייכנסו לחודש הפתוח ויסומנו לבדיקה.`,
  operations_other_months: (item) => `${item.count} פעולות חסרות מחודשים אחרים; מה שיסומן באשף ייכנס לחודש שלו.`,
  journal_other_month: () => "היומן שייך לחודש אחר; השורות ייכנסו לחודש שבקובץ.",
  month_closed_ask: () => "החודש של הקובץ סגור; לפני הייבוא תוצג שאלה אם לפתוח אותו.",
  replaces_own_chart: () => "ללקוח כבר יש קודי מיון משלו; הם יוחלפו בקודים שבכרטסת (עותק שלהם יישמר).",
  lines_skipped: (item) => `${item.count} שורות בכרטסת לא נקראו; האשף מראה אילו ולמה.`,
  rows_not_remapped: (item) => `ל-${item.count} סוגים של שורות שיובאו מ-Excel אין קוד בכרטסת; השורות האלה לא יעודכנו.`,
  locked_months_not_remapped: (item) => `ב-${item.count} הצהרות נעולות יש שורות שיובאו מ-Excel; הן לא יעודכנו.`,
  month_missing: () => "אין הצהרה לחודש של הדוח; יש ליצור אותה לפני ההוספה.",
  listing_unread: () => "פירוט המסמכים בדוח לא נקרא; הסכומים נלקחים מהסיכום בלבד, יש לבדוק מול הדוח.",
  "unreadable-documents": () => "חלק מהמסמכים בפירוט הדוח לא נקראו במלואם.",
  "section-count": () => "מספר המסמכים שנקראו בחלק מהדוח שונה מהמספר שבדוח.",
  "document-count": () => "מספר המסמכים שנקראו שונה מהמספר שבדוח.",
  "sum-differs": () => "סכום הפירוט שונה מהסיכום של הדוח.",
  "summary-inconsistent": () => "סיכום הדוח אינו מתחבר: חייב + פטור + מע״מ שונה מהסה״כ.",
  maybe_other_client: () => "כמעט אף פעולה בכרטסת לא נמצאה בהצהרות, אף שיש בהן שורות באותם חודשים: ייתכן שהכרטסת של לקוח אחר. יש לבדוק לפני הוספה.",
  operations_missing: (item) => `${item.count} פעולות מהכרטסת חסרות בהצהרות; באשף אפשר לסמן אותן ולהוסיף.`,
  missing_unknown_class: (item) => `ל-${item.count} מהפעולות החסרות אין קוד מיון אצל הלקוח; יש לטעון קודם את כרטסת קודי המיון.`,
  missing_in_locked_month: (item) => `${item.count} מהפעולות החסרות שייכות להצהרות נעולות ולא יתווספו.`,
  rows_not_in_ledger: (item) => `ל-${item.count} שורות בהצהרות אין התאמה בכרטסת; האשף מציג אותן.`,
  types_suggested: (item) => `ל-${item.count} קודי מיון הוצע סוג אחר כדי שהסכומים בסוף הקובץ יתאימו; האשף מראה זאת.`,
};
const money = (value) => value.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const importProblemText = (item) => (IMPORT_PROBLEMS[item.code] ?? problemText)(item) ?? item.code;

const ADDED_STATES = ["created", "moved_month", "already_added"];
const FOLD_AFTER = 1500; // characters of a final answer shown before "הצג את כל הסיכום" (the owner: folded lines are not seen)

// What the run has done so far, for the progress line: documents read of the files found, rows added, originals filed.
function summaryOf(counts) {
  const parts = [];
  if (counts.total) parts.push(`נקראו ${counts.read ?? 0} מתוך ${counts.total}`);
  if (counts.rows) parts.push(`נוספו ${counts.rows} שורות`);
  if (counts.filed) parts.push(`תויקו ${counts.filed}`);
  return parts.join(" · ");
}

// The line of the progress bar for a progress event of the loop; `counts` keeps what was done in this run. A finished call only updates
// the counts (null: nothing new to show before the next event).
export function progressLabel(event, counts) {
  if (event.type === "done") {
    const result = event.result ?? {};
    if (event.name === "list_inbox" && event.ok) {
      const waiting = (result.files ?? []).filter((file) => file.kind !== "spreadsheet" && file.status === "waiting");
      counts.total = Math.max(counts.total ?? 0, waiting.length);
      counts.names = { ...(counts.names ?? {}), ...Object.fromEntries((result.files ?? []).map((file) => [file.file, file.name])) };
    } else if (event.name === "extract_document") {
      counts.read = (counts.read ?? 0) + 1;
      counts.documents = (counts.documents ?? 0) + (result.documents ?? []).length;
    }
    else if (event.name === "add_rows") counts.rows = (counts.rows ?? 0) + (result.rows ?? []).filter((row) => ADDED_STATES.includes(row.state)).length;
    else if (event.name === "move_file_to_declaration" && result.state === "filed") counts.filed = (counts.filed ?? 0) + 1;
    return null;
  }
  const summary = summaryOf(counts);
  if (event.type === "turn") return summary ? `חושב… · ${summary}` : "חושב…";
  if (event.name === "extract_document") counts.extracted = (counts.extracted ?? 0) + 1;
  // The file worked on now, by its name (the owner, 8 November 2026: say which document is being read).
  const name = counts.names?.[event.args?.file];
  if (name && event.name === "extract_document") return `קורא את «${name}» (קובץ ${counts.extracted} מתוך ${Math.max(counts.total ?? 0, counts.extracted)})`;
  if (name && event.name === "move_file_to_declaration") return `מתייק את «${name}»`;
  const label = TOOL_LABELS[event.name] ?? "עובד…";
  const line = event.name === "extract_document" ? `${label} (${counts.extracted})` : label;
  return summary ? `${line} · ${summary}` : line;
}

// The thermometer under the line: every file is read, then filed, so a file counts twice. null until the files are known.
export function progressMeter(counts) {
  if (!counts.total) return null;
  const parts = [`${counts.total === 1 ? "קובץ אחד" : `${counts.total} קבצים`} בתיבת הקלט`];
  if (counts.read) parts.push(`נמצאו ${counts.documents ?? 0} מסמכים ${counts.read === 1 ? "בקובץ אחד" : `ב-${counts.read} קבצים`}`);
  if (counts.rows) parts.push(`נוספו ${counts.rows} שורות`);
  parts.push(`תויקו ${counts.filed ?? 0} מתוך ${counts.total}`);
  const value = Math.min(counts.total * 2, (counts.read ?? 0) + (counts.filed ?? 0));
  return { value, max: counts.total * 2, caption: parts.join(" · ") };
}

function valueText(field, value) {
  if (field === "include") return value ? "כן" : "לא";
  if (field === "month") return formatMonth(value);
  return value === "" ? "(ריק)" : String(value);
}

// onCommand({ type: "process" | "left" | "report" | "cancel" | "text" | "open" | "look" | "inbox", text?, clientId?, month? }) is called for a
// click or a sent line ("look": the rows to look at of that month).
// onApply(proposal, kept) is called when the user applies a proposal (kept: the numbers of the changes that stayed ticked); it resolves with
// { applied, refused: [{ change, reason }] }. Without it a proposal card only shows the changes.
// onRemember({ clientId, rule }) appends a confirmed rule to the client's rules.md and resolves with { added }; it is called only after
// the user ticked "זכור ללקוח" and clicked the answer the rule belongs to.
// onPending({ questions, imports }) is called whenever a question or an import file opens or ends; reveal({ kind, index }) shows the
// open question (kind "question") or opens the wizard of the index-th import file not done (kind "import").
export function setupAssistant({ root, onCommand, onApply = null, onRemember = null, onPending = () => {} }) {
  const part = (id) => root.querySelector(`#${id}`);
  const [toggle, progress, body, feed, form, input, sendButton, processButton, leftButton, reportButton, cancelButton, minimizeButton] = [
    "assistant-toggle", "assistant-progress", "assistant-body", "assistant-feed", "assistant-form", "assistant-input", "assistant-send",
    "assistant-process", "assistant-left", "assistant-report", "assistant-cancel", "assistant-minimize",
  ].map(part);
  const doc = root.ownerDocument;
  const meterBox = root.querySelector("#assistant-meter");
  const meterBar = root.querySelector("#assistant-meter-bar");
  const meterText = root.querySelector("#assistant-meter-text");
  let busy = false;
  let runImports = []; // the import cards of the current or last run: { card, box, wizard, todo }
  const allImports = []; // every import card of this page, for the strip "ממתין לך"
  const openQuestions = new Set(); // question cards waiting for an answer
  // One entry per file: a file still in the inbox gets a card in every run (M2, D4), and the newest card stands for it.
  const pendingImports = () => {
    const open = allImports.filter((entry) => entry.box.dataset.state !== "answered");
    return open.filter((entry, index) => !open.slice(index + 1).some((later) => sameFile(later, entry)));
  };
  // Tells the page what waits in the feed (docs/UI_REDESIGN_PROPOSAL.md, C6): { questions, imports: [{ name }] }.
  const notify = () => onPending({
    questions: openQuestions.size,
    imports: pendingImports().map(({ card, box }) => ({
      name: card.file.name, client: card.client.name, clientId: card.client.id, state: box.dataset.state,
    })),
  });
  let waiting = null; // files in the inbox, null until the page has counted them
  const processTitle = processButton.title;
  let shown = "";
  let since = 0;
  let timer = null;

  const element = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  // A line whose file names are isolated (<bdi>): a Latin name such as "journal (1).xlsx" is not turned around by the Hebrew text.
  const isolated = (className, parts) => {
    const line = element("p", className);
    for (const part of parts) line.append(typeof part === "string" ? part : element("bdi", "", part.name));
    return line;
  };
  const button = (label, className = "secondary small") => Object.assign(element("button", className, label), { type: "button" });
  const scrollDown = () => { feed.scrollTop = feed.scrollHeight; };
  const add = (node) => { feed.append(node); scrollDown(); return node; };
  const lock = (box) => { for (const control of box.querySelectorAll("button, input, select")) control.disabled = true; };

  // The dialog of the assistant: one question, suggestion or end of a run at a time, the others wait in turn. Esc does not close it:
  // its buttons say what happens.
  const dialog = element("dialog", "workspace-dialog assistant-dialog");
  dialog.id = "assistant-dialog";
  dialog.setAttribute("aria-labelledby", "assistant-dialog-title");
  root.append(dialog);
  dialog.addEventListener("cancel", (event) => event.preventDefault());
  const dialogs = [];
  let shownDialog = null;
  function showDialog(title, box) {
    const item = { title, box, closed: false };
    item.close = () => {
      if (item.closed) return;
      item.closed = true;
      if (shownDialog !== item) {
        dialogs.splice(dialogs.indexOf(item), 1);
        return;
      }
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
      dialog.removeAttribute("open");
      dialog.replaceChildren();
      shownDialog = null;
      nextDialog();
    };
    dialogs.push(item);
    nextDialog();
    return item;
  }
  function nextDialog() {
    if (shownDialog || !dialogs.length) return;
    shownDialog = dialogs.shift();
    const heading = element("h2", "", shownDialog.title);
    heading.id = "assistant-dialog-title";
    const header = element("header");
    header.append(heading);
    const body = element("div", "assistant-dialog-body");
    body.append(header, shownDialog.box);
    dialog.replaceChildren(body);
    if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
    else dialog.setAttribute("open", "");
    shownDialog.box.querySelector("button:not(:disabled)")?.focus?.();
  }

  function open(show = true) {
    root.dataset.open = String(show);
    body.hidden = !show;
    toggle.setAttribute("aria-expanded", String(show));
    minimizeButton.hidden = !show;
    minimizeButton.setAttribute("aria-expanded", String(show));
    if (show) scrollDown();
  }

  // The progress line, with the seconds since it last changed once the step takes a while: a long wait for the model is not a freeze.
  const drawProgress = () => {
    const seconds = Math.floor((Date.now() - since) / 1000);
    progress.textContent = shown && seconds >= 5 ? `${shown} · ${seconds} שנ׳` : shown;
  };
  // meter: { value, max, caption } from progressMeter, null to hide it, undefined to leave it as it is.
  function setProgress(text, meter) {
    if (text !== shown) since = Date.now();
    shown = text;
    drawProgress();
    if (meter === undefined || !meterBox) return;
    meterBox.hidden = !meter;
    if (!meter) return;
    meterBar.max = meter.max;
    meterBar.value = meter.value;
    meterText.textContent = meter.caption;
  }

  // The check button says how many files wait and is off with an empty inbox: a run there would only find nothing
  // (docs/UI_REDESIGN_PROPOSAL.md, C3). The inbox dialog's button has the same name and starts the same run.
  function drawProcess() {
    processButton.disabled = busy || waiting === 0;
    processButton.textContent = waiting ? `${COMMAND_LABELS.process} (${waiting})` : COMMAND_LABELS.process;
    processButton.title = waiting === 0 ? "תיבת הקלט ריקה" : processTitle;
  }
  function setWaiting(count) {
    waiting = Number.isInteger(count) ? count : null;
    drawProcess();
  }

  function setBusy(value) {
    busy = value;
    for (const control of [leftButton, input, sendButton]) control.disabled = value;
    drawProcess();
    cancelButton.hidden = !value;
    clearInterval(timer);
    timer = null;
    if (value) {
      runImports = [];
      open(true);
      timer = setInterval(drawProgress, 1000);
      timer.unref?.();
    } else setProgress("");
  }

  // fold: a long answer shows its first lines and a control that shows the rest, so that the card "לטיפולך" under it stays in view
  // (docs/UI_REDESIGN_PROPOSAL.md, C5).
  function addMessage(kind, text, { fold = false } = {}) {
    const message = element("div", "assistant-message", text);
    message.dataset.kind = kind; // user | assistant | note | error
    add(message);
    if (fold && text.length > FOLD_AFTER) {
      message.classList.add("folded");
      const more = button("הצג את כל הסיכום", "link small");
      more.addEventListener("click", () => { message.classList.remove("folded"); more.remove(); });
      message.after(more);
    }
    return message;
  }

  // The end of a run, built by the page from what the run did, not from the agent's words (the owner, 11 November 2026: it must be
  // clear when the agent has finished): where the rows went and how many are to look at, the import files of the run still waiting
  // (each with its wizard button), the files left in the inbox, and notes. rows: [{ clientId, client, month, count, review }];
  // inbox: the names of the files left; notes: lines of text.
  let doneDialog = null;
  function showDone({ title, rows = [], inbox = [], notes = [] }) {
    const box = element("div", "assistant-card");
    box.dataset.kind = "done";
    const list = element("ul", "todo-list");
    const line = (text, label, onClick) => {
      const item = element("li");
      item.append(element("p", "", text));
      if (label) {
        const go = button(label, "small");
        go.addEventListener("click", () => { doneDialog?.close(); onClick(); });
        item.append(go);
      }
      list.append(item);
    };
    const placed = rows.filter((item) => item.count > 0);
    if (!placed.length) line("לא נוספו שורות.");
    for (const { clientId, client, month, count, review } of placed) {
      const added = count === 1 ? "נוספה שורה אחת" : `נוספו ${count} שורות`;
      const look = review ? ` · ${review === 1 ? "שורה אחת" : `${review} שורות`} לבדיקה` : "";
      const label = review ? "הצגת השורות לבדיקה" : "";
      line(`${added} ל-${formatMonth(month)}${client ? ` של «${client}»` : ""}${look}`, label, () => onCommand({ type: "look", clientId, month }));
    }
    if (inbox.length) {
      const count = inbox.length === 1 ? "קובץ אחד נשאר" : `${inbox.length} קבצים נשארו`;
      const names = `${inbox.slice(0, 6).join(", ")}${inbox.length > 6 ? " ועוד" : ""}`;
      line(`${count} בתיבת הקלט: ${names}`, "פתיחת תיבת הקלט", () => onCommand({ type: "inbox" }));
    }
    for (const note of notes) line(note);
    box.append(list);
    for (const entry of runImports.filter((item) => item.box.dataset.state !== "answered")) box.append(entry.box);
    const actions = element("div", "dialog-actions");
    const close = button("סגירה", "");
    close.addEventListener("click", () => doneDialog?.close());
    actions.append(close);
    box.append(actions);
    doneDialog = showDialog(title, box);
    return box;
  }
  // Every run draws its own card for a file still in the inbox; once one of them imported it, all of them are done (M2 exam,
  // 7 November 2026: "not done" stayed on every earlier card and line after the import).
  const sameFile = (a, b) => a.card.file.name === b.card.file.name && a.card.client.name === b.card.client.name && a.card.kind === b.card.kind;
  const markDone = (done) => {
    for (const other of allImports.filter((entry) => sameFile(entry, done))) {
      other.wizard.disabled = true;
      other.box.dataset.state = "answered";
    }
  };

  // Starts the import of every card of these kinds that waits and has no error, as its button would (the income report is imported
  // after a run without a click). Resolves with how many were started.
  function importPending(kinds) {
    let started = 0;
    for (const entry of runImports) {
      if (!kinds.includes(entry.card.kind) || entry.box.dataset.state !== "waiting" || entry.wizard.disabled) continue;
      if (entry.card.problems.some((item) => item.severity === "error")) continue;
      entry.wizard.click();
      started += 1;
    }
    return started;
  }

  // A question of the agent, in the dialog: resolves with the answer of the user, never rejects. An aborted run only closes it.
  function ask(card, { signal } = {}) {
    return new Promise((resolve) => {
      const box = element("div", "assistant-card");
      box.dataset.kind = "question";
      box.append(element("p", "card-text", card.question));
      const files = card.about?.files ?? [];
      if (files.length) box.append(isolated("card-about muted", files.flatMap((file, index) => [...(index ? [" · "] : []), { name: file.name }])));
      let remember = null;
      if (card.remember) {
        const label = element("label", "check-line");
        remember = Object.assign(doc.createElement("input"), { type: "checkbox" });
        label.append(remember, ` זכור ללקוח «${card.remember.client}» (בתשובה «${card.remember.optionLabel}»): ${card.remember.rule}`);
        box.append(label);
      }
      // The rule is written here, by the page, when the box is ticked and the answer it belongs to is clicked; the card says what happened.
      const saveRule = async (answer) => {
        if (!remember?.checked) return {};
        if (answer.type !== "option" || answer.id !== card.remember.option) {
          addMessage("note", "הכלל לא נשמר: נבחרה תשובה אחרת.");
          return { remember: true, saved: false };
        }
        try {
          if (!onRemember) throw new Error("אין אפשרות לשמור כאן.");
          const { added } = await onRemember({ clientId: card.remember.clientId, rule: card.remember.rule });
          addMessage("note", added ? "הכלל נשמר בכללים של הלקוח." : "הכלל כבר רשום בכללים של הלקוח.");
          return { remember: true, saved: true };
        } catch (error) {
          addMessage("error", `הכלל לא נשמר: ${error.message}`);
          return { remember: true, saved: false };
        }
      };
      let finished = false;
      const finish = async (answer, shown) => {
        if (finished) return;
        finished = true;
        openQuestions.delete(box);
        notify();
        lock(box);
        box.dataset.state = "answered";
        box.append(element("p", "card-answer", `נבחר: ${shown}`));
        shownQuestion.close();
        const saved = await saveRule(answer);
        resolve({ ...answer, ...(remember ? { remember: remember.checked, ...saved } : {}) });
      };
      const options = element("div", "card-options");
      for (const option of card.options) {
        const choice = button(option.label, "small");
        choice.addEventListener("click", () => finish({ type: "option", id: option.id }, option.label));
        options.append(choice);
      }
      const dismiss = button("דלג", "link small");
      dismiss.addEventListener("click", () => finish({ type: "dismissed" }, "דילוג"));
      options.append(dismiss);
      box.append(options);
      if (card.allowOther) {
        const other = element("div", "card-other");
        const text = Object.assign(doc.createElement("input"), { type: "text", maxLength: 300, placeholder: "אחר…", autocomplete: "off" });
        text.setAttribute("aria-label", "תשובה אחרת");
        const submit = button("שליחה");
        const send = () => { if (text.value.trim()) finish({ type: "other", text: text.value.trim() }, text.value.trim()); };
        submit.addEventListener("click", send);
        text.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); send(); } });
        other.append(text, submit);
        box.append(other);
      }
      signal?.addEventListener("abort", () => {
        if (finished) return;
        finished = true;
        openQuestions.delete(box);
        notify();
        lock(box);
        box.dataset.state = "cancelled";
        shownQuestion.close();
      }, { once: true });
      const shownQuestion = showDialog("שאלה מהעוזר", box);
      openQuestions.add(box);
      notify();
    });
  }

  // A suggestion of the agent for existing rows, in the dialog, each with its row number (the # column of the table). With onApply the
  // user keeps or unticks each change and applies the rest; the dialog then says what was done and what was refused, and why.
  function propose(proposal) {
    const box = element("div", "assistant-card");
    box.dataset.kind = "proposal";
    const status = element("p", "card-about muted", `הצעה ללקוח «${proposal.client.name}» — עדיין לא הוחלה`);
    box.append(element("p", "card-text", proposal.title), status);
    const list = element("ul", "card-changes");
    const ticks = [];
    for (const change of proposal.changes) {
      const item = element("li");
      const text = `שורה ${change.position} (${formatMonth(change.month)}) · ${FIELD_LABELS[change.field] ?? change.field}: ${valueText(change.field, change.value)} — ${change.reason}`;
      if (onApply) {
        const label = element("label", "check-line");
        const tick = Object.assign(doc.createElement("input"), { type: "checkbox", checked: true });
        ticks.push(tick);
        label.append(tick, ` ${text}`);
        item.append(label);
      } else item.textContent = text;
      list.append(item);
    }
    box.append(list);
    let shownProposal = null;
    const closing = element("div", "dialog-actions");
    const close = button("סגירה", "");
    close.addEventListener("click", () => shownProposal.close());
    closing.append(close);
    if (onApply) {
      const actions = element("div", "card-options");
      const apply = button("החל", "small");
      const reject = button("דחה", "link small");
      const finish = (text) => {
        lock(box);
        box.dataset.state = "answered";
        status.textContent = text;
        box.append(closing);
        close.focus?.();
      };
      apply.addEventListener("click", async () => {
        const kept = ticks.flatMap((tick, index) => (tick.checked ? [index] : []));
        if (!kept.length) return;
        lock(box);
        let result;
        try {
          result = await onApply(proposal, kept);
        } catch (error) {
          finish(`לא ניתן להחיל: ${error.message}`);
          return;
        }
        finish(`הוחלו ${result.applied.length} מתוך ${kept.length} שינויים`);
        for (const { change, reason } of result.refused) box.insertBefore(element("p", "card-answer", `שורה ${change.position}: ${reason}`), closing);
      });
      reject.addEventListener("click", () => {
        finish("ההצעה נדחתה");
        shownProposal.close();
      });
      actions.append(apply, reject);
      box.append(actions);
    } else box.append(closing);
    shownProposal = showDialog("הצעה מהעוזר", box);
  }

  // A file prepared by the agent. It is not drawn in the panel: the dialog at the end of the run shows the files still waiting, each
  // with this box and its button, and the strip "ממתין לך" opens the wizard directly. The button asks the page to open the wizard
  // (onCommand type "import"); the page reports back what happened to the file through `report`. Its state (data-state) is waiting,
  // opened, unfinished (the wizard was closed before it wrote) or answered (done).
  function importCard(card) {
    const box = element("div", "assistant-card");
    box.dataset.kind = "import";
    box.dataset.state = "waiting";
    box.append(element("p", "card-text", card.reason));
    box.append(isolated("card-about muted", [`${IMPORT_KINDS[card.kind] ?? card.kind} · `, { name: card.file.name }, ` · לקוח «${card.client.name}»`]));
    const { summary, totals } = card;
    const list = element("ul", "card-changes");
    const lines = [];
    if (card.kind === "income_report") {
      const dates = `${summary.period_from.split("-").reverse().join("/")}–${summary.period_to.split("-").reverse().join("/")}`;
      lines.push(`${dates}: ${summary.documents} מסמכים${totals ? ` · ללא מע״מ ${money(totals.net)} · מע״מ ${money(totals.vat)} · כולל ${money(totals.gross)}` : ""}`);
      lines.push(`${summary.rows_to_add === 2 ? "שתי שורות (חייב ופטור)" : "שורה אחת"} תתווסף להצהרה ${formatMonth(summary.month)}${summary.verified ? "; הפירוט תואם לסיכום" : ""}.`);
    } else if (card.kind === "ledger_check") {
      lines.push(`${summary.operations} פעולות בכרטסת לשנת ${summary.year}: ${summary.matched} קיימות בהצהרות, ${summary.missing} חסרות`);
      if (summary.can_add) lines.push(`${summary.can_add} מהחסרות אפשר להוסיף באשף${summary.months_created ? ` (${summary.months_created} הצהרות ייווצרו)` : ""}.`);
    } else if (card.kind === "ledger_codes") {
      lines.push(`${summary.accounts} קודי מיון בכרטסת`);
      if (summary.rows_to_remap) lines.push(`${summary.rows_to_remap} שורות שיובאו מ-Excel יקבלו את הקודים החדשים (${summary.months_to_remap.map(formatMonth).join(", ")}); עותק של כל טבלה יישמר.`);
    } else {
      lines.push(`${summary.rows} שורות${totals ? ` · נטו ${money(totals.net)} · מע״מ ${money(totals.vat)} · ברוטו ${money(totals.gross)}` : ""}`);
      if (summary.month) lines.push(`חודש בקובץ: ${formatMonth(summary.month)}`);
      if (summary.new_accounts) lines.push(`${summary.new_accounts} שמות קודי מיון חדשים (באשף יש להגדיר להם קוד וסוג)`);
    }
    for (const item of card.problems) lines.push(`${item.severity === "error" ? "שגיאה" : "אזהרה"}: ${importProblemText(item)}`);
    for (const line of lines) list.append(element("li", "", line));
    box.append(list);
    const status = element("p", "card-answer muted", "");
    const actions = element("div", "card-options");
    const wizard = button("בדיקה וייבוא", "small");
    const entry = { card, box, wizard };
    runImports.push(entry);
    allImports.push(entry);
    wizard.addEventListener("click", () => {
      if (busy) { status.textContent = "יש להמתין לסיום הריצה."; return; }
      status.textContent = "";
      if (box.closest("dialog")) doneDialog?.close();
      onCommand({
        type: "import", card,
        report: ({ text, done = false, state = "" }) => {
          status.textContent = text;
          if (done) markDone(entry); else if (state) box.dataset.state = state;
          notify();
        },
      });
    });
    actions.append(wizard);
    box.append(actions, status);
    notify();
  }

  toggle.addEventListener("click", () => open(body.hidden));
  minimizeButton.addEventListener("click", () => open(false));
  // The two quick requests, from the buttons of the dock or from elsewhere (the inbox dialog). False when a run is on.
  function start(type) {
    if (busy) return false;
    addMessage("user", COMMAND_LABELS[type]);
    onCommand({ type });
    return true;
  }
  processButton.addEventListener("click", () => start("process"));
  leftButton.addEventListener("click", () => start("left"));
  reportButton.addEventListener("click", () => onCommand({ type: "report" }));
  cancelButton.addEventListener("click", () => onCommand({ type: "cancel" }));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (busy || !text) return;
    input.value = "";
    addMessage("user", text);
    onCommand({ type: "text", text });
  });

  open(false);
  function reveal({ kind, index = 0 }) {
    if (kind === "question") {
      const box = [...openQuestions][0];
      box?.querySelector("button:not(:disabled)")?.focus();
      return Boolean(box);
    }
    const entry = pendingImports()[index];
    if (!entry || entry.wizard.disabled) return false;
    entry.wizard.click();
    return true;
  }

  return {
    open, setBusy, setWaiting, addMessage, trigger: start, setProgress, progressText: () => shown, showDone, reveal, importPending,
    ui: { ask, propose, importCard }, isBusy: () => busy,
  };
}
