// The assistant dock (#assistant, step 4.3): a bar that is always there (progress line, the quick buttons), and a body that opens
// with the conversation: what the user asked, what the agent answered, question cards with buttons, proposal cards, notes. This file
// only draws and reports clicks: what a button does (start a run, cancel, open a report) is decided by the caller through onCommand.
// All text from the agent is put in with textContent; nothing it says is ever HTML.
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
};

export const FIELD_LABELS = {
  date: "תאריך", supplier_name: "ספק", purpose: "פרטים", supplier_vat_id: "ע.מ. ספק", document_number: "אסמכתא", allocation_number: "מספר הקצאה",
  net: "ללא מע״מ", vat: "מע״מ", total: "כולל מע״מ", account: "קוד מיון", vat_recognized_percent: "% מוכר מע״מ",
  expense_recognized_percent: "% מוכר כהוצאה", include: "לייצוא", month: "חודש",
};

export const COMMAND_LABELS = { process: "בדוק מסמכים חדשים", left: "מה נשאר?" };

const ADDED_STATES = ["created", "moved_month", "already_added"];

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

// onCommand({ type: "process" | "left" | "report" | "cancel" | "text", text? }) is called for a click or a sent line.
// onApply(proposal, kept) is called when the user applies a proposal (kept: the numbers of the changes that stayed ticked); it resolves with
// { applied, refused: [{ change, reason }] }. Without it a proposal card only shows the changes.
export function setupAssistant({ root, onCommand, onApply = null }) {
  const part = (id) => root.querySelector(`#${id}`);
  const [toggle, progress, body, feed, form, input, sendButton, processButton, leftButton, reportButton, cancelButton] = [
    "assistant-toggle", "assistant-progress", "assistant-body", "assistant-feed", "assistant-form", "assistant-input", "assistant-send",
    "assistant-process", "assistant-left", "assistant-report", "assistant-cancel",
  ].map(part);
  const doc = root.ownerDocument;
  let busy = false;
  let shown = "";
  let since = 0;
  let timer = null;

  const element = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (label, className = "secondary small") => Object.assign(element("button", className, label), { type: "button" });
  const scrollDown = () => { feed.scrollTop = feed.scrollHeight; };
  const add = (node) => { feed.append(node); scrollDown(); return node; };
  const lock = (box) => { for (const control of box.querySelectorAll("button, input")) control.disabled = true; };

  function open(show = true) {
    root.dataset.open = String(show);
    body.hidden = !show;
    toggle.setAttribute("aria-expanded", String(show));
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

  function setBusy(value) {
    busy = value;
    for (const control of [processButton, leftButton, input, sendButton]) control.disabled = value;
    cancelButton.hidden = !value;
    clearInterval(timer);
    timer = null;
    if (value) {
      open(true);
      timer = setInterval(drawProgress, 1000);
      timer.unref?.();
    } else setProgress("");
  }

  function addMessage(kind, text) {
    const message = element("div", "assistant-message", text);
    message.dataset.kind = kind; // user | assistant | note | error
    return add(message);
  }

  // A question of the agent: resolves with the answer of the user, never rejects. An aborted run only closes the card.
  function ask(card, { signal } = {}) {
    return new Promise((resolve) => {
      const box = element("div", "assistant-card");
      box.dataset.kind = "question";
      box.append(element("p", "card-text", card.question));
      const files = card.about?.files ?? [];
      if (files.length) box.append(element("p", "card-about muted", files.map((file) => file.name).join(" · ")));
      let remember = null;
      if (card.remember) {
        const label = element("label", "check-line");
        remember = Object.assign(doc.createElement("input"), { type: "checkbox" });
        label.append(remember, ` זכור ללקוח «${card.remember.client}»: ${card.remember.rule}`);
        box.append(label);
      }
      let finished = false;
      const finish = (answer, shown) => {
        if (finished) return;
        finished = true;
        lock(box);
        box.dataset.state = "answered";
        box.append(element("p", "card-answer", `נבחר: ${shown}`));
        resolve({ ...answer, ...(remember ? { remember: remember.checked } : {}) });
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
        lock(box);
        box.dataset.state = "cancelled";
        box.append(element("p", "card-answer muted", "הריצה הופסקה"));
      }, { once: true });
      add(box);
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

  toggle.addEventListener("click", () => open(body.hidden));
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
  return { open, setBusy, addMessage, trigger: start, setProgress, ui: { ask, propose }, isBusy: () => busy };
}
