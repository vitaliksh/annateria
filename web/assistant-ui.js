// The assistant dock (#assistant, step 4.3): a bar that is always there (progress line, the quick buttons), and a body that opens
// with the conversation: what the user asked, what the agent answered, question cards with buttons, proposal cards, notes. This file
// only draws and reports clicks: what a button does (start a run, cancel, open a report) is decided by the caller through onCommand.
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
  month_differs: () => "החודש שהוצע שונה מהחודש בכותרת הקובץ; האשף ישתמש בחודש שבקובץ.",
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
// Why a client is offered as a button of the question "which client?" (choose_client).
const CLIENT_HINTS = { open: "הלקוח הפתוח כעת", vat_id: "מספר העוסק במסמך זהה", alias: "הקונה במסמך אושר בעבר ללקוח הזה", name_exact: "נמצא לפי שם זהה", name_partial: "נמצא לפי שם דומה, לא בטוח" };
const money = (value) => value.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const importProblemText = (item) => (IMPORT_PROBLEMS[item.code] ?? problemText)(item) ?? item.code;

const ADDED_STATES = ["created", "moved_month", "already_added"];
const FOLD_AFTER = 240; // characters of a final answer shown before "הצג את כל הסיכום"

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
      const found = (result.files ?? []).filter((file) => file.kind !== "spreadsheet" && file.status === "waiting").length;
      counts.total = Math.max(counts.total ?? 0, found);
    } else if (event.name === "extract_document") counts.read = (counts.read ?? 0) + 1;
    else if (event.name === "add_rows") counts.rows = (counts.rows ?? 0) + (result.rows ?? []).filter((row) => ADDED_STATES.includes(row.state)).length;
    else if (event.name === "move_file_to_declaration" && result.state === "filed") counts.filed = (counts.filed ?? 0) + 1;
    return null;
  }
  const summary = summaryOf(counts);
  if (event.type === "turn") return summary ? `חושב… · ${summary}` : "חושב…";
  if (event.name === "extract_document") counts.extracted = (counts.extracted ?? 0) + 1;
  const label = TOOL_LABELS[event.name] ?? "עובד…";
  const line = event.name === "extract_document" ? `${label} (${counts.extracted})` : label;
  return summary ? `${line} · ${summary}` : line;
}

function valueText(field, value) {
  if (field === "include") return value ? "כן" : "לא";
  if (field === "month") return formatMonth(value);
  return value === "" ? "(ריק)" : String(value);
}

// onCommand({ type: "process" | "left" | "report" | "cancel" | "text" | "open", text?, clientId?, month? }) is called for a click or a sent line.
// onApply(proposal, kept) is called when the user applies a proposal (kept: the numbers of the changes that stayed ticked); it resolves with
// { applied, refused: [{ change, reason }] }. Without it a proposal card only shows the changes.
// onRemember({ clientId, rule }) appends a confirmed rule to the client's rules.md and resolves with { added }; it is called only after
// the user ticked "זכור ללקוח" and clicked the answer the rule belongs to. onRememberAlias({ clientId, vatId, name }) keeps the printed buyer of
// the documents of a "which client?" question as an alias of the chosen client (step 4.6.2) and resolves with { added }; it is called only after
// the user ticked that box and chose a client.
// onPending({ questions, imports }) is called whenever a question card or an import card opens or ends; reveal({ kind, index })
// opens the panel at the first open question (kind "question") or at the index-th import card not done (kind "import").
export function setupAssistant({ root, onCommand, onApply = null, onRemember = null, onRememberAlias = null, onPending = () => {} }) {
  const part = (id) => root.querySelector(`#${id}`);
  const [toggle, progress, body, feed, form, input, sendButton, processButton, leftButton, reportButton, cancelButton, minimizeButton] = [
    "assistant-toggle", "assistant-progress", "assistant-body", "assistant-feed", "assistant-form", "assistant-input", "assistant-send",
    "assistant-process", "assistant-left", "assistant-report", "assistant-cancel", "assistant-minimize",
  ].map(part);
  const doc = root.ownerDocument;
  let busy = false;
  let runImports = []; // the import cards of the current or last run: { card, box, wizard, todo }
  const allImports = []; // every import card of this page, for the strip "ממתין לך"
  const openQuestions = new Set(); // question cards waiting for an answer
  const pendingImports = () => allImports.filter((entry) => entry.box.dataset.state !== "answered");
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
  function setProgress(text) {
    shown = text;
    since = Date.now();
    drawProgress();
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

  // What is left for the user after a run, built by the page from what the run did, not from the agent's words: the import cards of
  // this run that are not done, the months with rows to look at, the files left in the inbox. Each line has the button that goes
  // there. rows: [{ clientId, client, month, review }]; inbox: a number of files. Nothing to do: no card.
  function showTodo({ rows = [], inbox = 0 } = {}) {
    const imports = runImports.filter((entry) => entry.box.dataset.state !== "answered");
    const reviewed = rows.filter((item) => item.review > 0);
    if (!imports.length && !reviewed.length && !inbox) return null;
    const box = element("div", "assistant-card");
    box.dataset.kind = "todo";
    box.append(element("p", "card-text", "לטיפולך"));
    const list = element("ul", "todo-list");
    const line = (text, label, onClick) => {
      const item = element("li");
      const go = button(label, "small");
      go.addEventListener("click", onClick);
      item.append(text, go);
      list.append(item);
      return { item, go };
    };
    for (const entry of imports) {
      const text = isolated("", ["ייבוא ", { name: entry.card.file.name }, ` ל«${entry.card.client.name}» לא הושלם`]);
      entry.todo = line(text, "בדיקה וייבוא", () => { entry.box.scrollIntoView?.({ block: "nearest" }); entry.wizard.click(); });
    }
    for (const { clientId, client, month, review } of reviewed) {
      const count = review === 1 ? "שורה אחת" : `${review} שורות`;
      line(element("p", "", `${count} לבדיקה ב-${formatMonth(month)} של «${client}»`), formatMonth(month), () => onCommand({ type: "open", clientId, month }));
    }
    if (inbox) {
      const text = inbox === 1 ? "קובץ אחד נשאר בתיבת הקלט" : `${inbox} קבצים נשארו בתיבת הקלט`;
      line(element("p", "", text), "תיבת קלט", () => onCommand({ type: "inbox" }));
    }
    box.append(list);
    add(box);
    open(true);
    return box;
  }
  // A line of the card "לטיפולך" follows its import card: done there, done here.
  const drawTodoLine = (entry) => {
    if (!entry.todo || entry.box.dataset.state !== "answered") return;
    entry.todo.item.dataset.state = "done";
    entry.todo.go.disabled = true;
  };

  // Where the rows of a run went: one button per month that opens it. months: [{ clientId, month, count }].
  function showPlaced(months) {
    if (!months.length) return;
    const box = element("div", "assistant-card");
    box.dataset.kind = "placed";
    box.append(element("p", "card-text", "נוספו שורות בחודשים:"));
    const options = element("div", "card-options");
    for (const { clientId, month, count } of months) {
      const choice = button(`${formatMonth(month)} · ${count} שורות`, "small");
      choice.addEventListener("click", () => onCommand({ type: "open", clientId, month }));
      options.append(choice);
    }
    box.append(options);
    add(box);
  }

  // A question of the agent: resolves with the answer of the user, never rejects. An aborted run only closes the card.
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
          box.append(element("p", "card-answer muted", "הכלל לא נשמר: נבחרה תשובה אחרת."));
          return { remember: true, saved: false };
        }
        try {
          if (!onRemember) throw new Error("אין אפשרות לשמור כאן.");
          const { added } = await onRemember({ clientId: card.remember.clientId, rule: card.remember.rule });
          box.append(element("p", "card-answer muted", added ? "הכלל נשמר בכללים של הלקוח." : "הכלל כבר רשום בכללים של הלקוח."));
          return { remember: true, saved: true };
        } catch (error) {
          box.append(element("p", "card-answer", `הכלל לא נשמר: ${error.message}`));
          return { remember: true, saved: false };
        }
      };
      // choose_client: remember the buyer printed on the documents for the client that is chosen.
      let aliasBox = null;
      if (card.alias) {
        const label = element("label", "check-line");
        aliasBox = Object.assign(doc.createElement("input"), { type: "checkbox" });
        const buyer = [card.alias.name ? `«${card.alias.name}»` : "", card.alias.vatId ? `מס׳ ${card.alias.vatId}` : ""].filter(Boolean).join(" ");
        label.append(aliasBox, ` לזכור: מסמכים שהקונה בהם ${buyer} שייכים ללקוח שייבחר`);
        box.append(label);
      }
      const saveAlias = async (answer, shown) => {
        if (!aliasBox?.checked) return {};
        const clientId = answer.type === "option" ? card.alias.clients?.[answer.id] : null;
        if (!clientId) {
          box.append(element("p", "card-answer muted", "הקונה לא נשמר: לא נבחר לקוח."));
          return { aliasSaved: false };
        }
        try {
          if (!onRememberAlias) throw new Error("אין אפשרות לשמור כאן.");
          const { added } = await onRememberAlias({ clientId, vatId: card.alias.vatId, name: card.alias.name });
          box.append(element("p", "card-answer muted", added ? `הקונה נשמר ללקוח «${shown}».` : `הקונה כבר רשום ללקוח «${shown}».`));
          return { aliasSaved: true };
        } catch (error) {
          box.append(element("p", "card-answer", `הקונה לא נשמר: ${error.message}`));
          return { aliasSaved: false };
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
        const saved = await saveRule(answer);
        const aliasSaved = await saveAlias(answer, shown);
        resolve({ ...answer, ...(remember ? { remember: remember.checked, ...saved } : {}), ...(aliasBox ? { alias: aliasBox.checked, ...aliasSaved } : {}) });
        scrollDown();
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
      const hints = card.options.filter((option) => CLIENT_HINTS[option.hint]).map((option) => `${option.label}: ${CLIENT_HINTS[option.hint]}`);
      if (hints.length) box.append(element("p", "card-about muted", hints.join(" · ")));
      // The question "which client?" (choose_client): every client that is not a button is in this list.
      if (card.more?.length) {
        const other = element("div", "card-other");
        const list = doc.createElement("select");
        list.setAttribute("aria-label", "לקוח אחר");
        list.append(new doc.defaultView.Option("לקוח אחר…", ""));
        for (const option of card.more) list.append(new doc.defaultView.Option(option.label, option.id));
        const pick = button("בחירה");
        pick.addEventListener("click", () => {
          const option = card.more.find((item) => item.id === list.value);
          if (option) finish({ type: "option", id: option.id }, option.label);
        });
        other.append(list, pick);
        box.append(other);
      }
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
        box.append(element("p", "card-answer muted", "הריצה הופסקה"));
      }, { once: true });
      add(box);
      openQuestions.add(box);
      notify();
      open(true);
    });
  }

  // A suggestion of the agent for existing rows, each with its row number (the # column of the table). With onApply the user keeps or
  // unticks each change and applies the rest; the card then says what was done and what was refused, and why.
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
    if (onApply) {
      const actions = element("div", "card-options");
      const apply = button("החל", "small");
      const reject = button("דחה", "link small");
      const finish = (text) => { lock(box); box.dataset.state = "answered"; status.textContent = text; };
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
        for (const { change, reason } of result.refused) box.append(element("p", "card-answer", `שורה ${change.position}: ${reason}`));
        scrollDown();
      });
      reject.addEventListener("click", () => finish("ההצעה נדחתה"));
      actions.append(apply, reject);
      box.append(actions);
    }
    add(box);
    open(true);
  }

  // A file prepared by the agent. The button asks the page to open the wizard (onCommand type "import"); the page reports back what
  // happened to the file through `report`. The card stays after the run, so the button can be pressed later. Its state (data-state)
  // is waiting, opened, unfinished (the wizard was closed before it wrote) or answered (done).
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
    const entry = { card, box, wizard, todo: null };
    runImports.push(entry);
    allImports.push(entry);
    wizard.addEventListener("click", () => {
      if (busy) { status.textContent = "יש להמתין לסיום הריצה."; return; }
      status.textContent = "";
      onCommand({
        type: "import", card,
        report: ({ text, done = false, state = "" }) => {
          status.textContent = text;
          if (done) { wizard.disabled = true; box.dataset.state = "answered"; } else if (state) box.dataset.state = state;
          drawTodoLine(entry);
          notify();
        },
      });
    });
    actions.append(wizard);
    box.append(actions, status);
    add(box);
    notify();
    open(true);
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
    const box = kind === "question" ? [...openQuestions][0] : pendingImports()[index]?.box;
    if (!box) return false;
    open(true);
    box.scrollIntoView?.({ block: "nearest" });
    box.querySelector("button:not(:disabled)")?.focus();
    return true;
  }

  return {
    open, setBusy, setWaiting, addMessage, trigger: start, setProgress, showPlaced, showTodo, reveal,
    ui: { ask, propose, importCard }, isBusy: () => busy,
  };
}
