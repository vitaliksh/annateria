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
  ask_user: "שואל שאלה",
  propose_change: "מכין הצעה",
};

export const FIELD_LABELS = {
  date: "תאריך", supplier_name: "ספק", purpose: "פרטים", supplier_vat_id: "ע.מ. ספק", document_number: "אסמכתא", allocation_number: "מספר הקצאה",
  net: "ללא מע״מ", vat: "מע״מ", total: "כולל מע״מ", account: "קוד מיון", vat_recognized_percent: "% מוכר מע״מ",
  expense_recognized_percent: "% מוכר כהוצאה", include: "לייצוא", month: "חודש",
};

export const COMMAND_LABELS = { process: "עבד חדשים", left: "מה נשאר?" };

// The line of the progress bar for a progress event of the loop; `counts` keeps how many documents were read in this run.
export function progressLabel(event, counts) {
  if (event.type === "turn") return "חושב…";
  if (event.name === "extract_document") counts.extracted = (counts.extracted ?? 0) + 1;
  const label = TOOL_LABELS[event.name] ?? "עובד…";
  return event.name === "extract_document" ? `${label} (${counts.extracted})` : label;
}

function valueText(field, value) {
  if (field === "include") return value ? "כן" : "לא";
  if (field === "month") return formatMonth(value);
  return value === "" ? "(ריק)" : String(value);
}

// onCommand({ type: "process" | "left" | "report" | "cancel" | "text", text? }) is called for a click or a sent line.
export function setupAssistant({ root, onCommand }) {
  const part = (id) => root.querySelector(`#${id}`);
  const [toggle, progress, body, feed, form, input, sendButton, processButton, leftButton, reportButton, cancelButton] = [
    "assistant-toggle", "assistant-progress", "assistant-body", "assistant-feed", "assistant-form", "assistant-input", "assistant-send",
    "assistant-process", "assistant-left", "assistant-report", "assistant-cancel",
  ].map(part);
  const doc = root.ownerDocument;
  let busy = false;

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

  function setBusy(value) {
    busy = value;
    for (const control of [processButton, leftButton, input, sendButton]) control.disabled = value;
    cancelButton.hidden = !value;
    if (value) open(true);
    else progress.textContent = "";
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

  // A suggestion of the agent for existing rows, each with its row number (the # column of the table). Applying it from here comes with
  // step 4.4; today the card only shows it.
  function propose(proposal) {
    const box = element("div", "assistant-card");
    box.dataset.kind = "proposal";
    box.append(element("p", "card-text", proposal.title), element("p", "card-about muted", `הצעה ללקוח «${proposal.client.name}» — עדיין לא הוחלה`));
    const list = element("ul", "card-changes");
    for (const change of proposal.changes) {
      list.append(element("li", "", `שורה ${change.position} (${formatMonth(change.month)}) · ${FIELD_LABELS[change.field] ?? change.field}: ${valueText(change.field, change.value)} — ${change.reason}`));
    }
    box.append(list);
    add(box);
    open(true);
  }

  toggle.addEventListener("click", () => open(body.hidden));
  processButton.addEventListener("click", () => { if (busy) return; addMessage("user", COMMAND_LABELS.process); onCommand({ type: "process" }); });
  leftButton.addEventListener("click", () => { if (busy) return; addMessage("user", COMMAND_LABELS.left); onCommand({ type: "left" }); });
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
  return { open, setBusy, addMessage, setProgress: (text) => { progress.textContent = text; }, ui: { ask, propose }, isBusy: () => busy };
}
