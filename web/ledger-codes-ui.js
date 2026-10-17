// Dialog that loads a client's classification ledger as that client's own codes. Logic lives in ledger-codes-flow.js.
import { ACCOUNT_TYPES } from "./chart-of-accounts.js";
import { TYPE_LABELS } from "./excel-import-ui.js";
import { commitLedger, prepareLedger } from "./ledger-codes-flow.js";
import { formatMonth } from "./month-format.js";

const SKIPPED_REASONS = {
  incomplete: "חסר קוד או שם",
  conflict: "אותו קוד עם שם אחר",
  invalid: "קוד לא תקין, שם כפול או קוד שמור",
};

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

// getContext() returns { dataRoot, client, reserved } or null; onBeforeWrite(months) lets the host detach the open table
// and returns what onSaved(result, detached) needs to put it back.
export function setupLedgerCodes({ dialog, getContext, onSaved, onError, onBeforeWrite, loadLibrary, loadPdf }) {
  const part = (id) => dialog.querySelector(`#${id}`);
  const [clientLine, file, details, summary, notes, list, errorLine, save] = [
    "ledger-codes-client", "ledger-codes-file", "ledger-codes-details", "ledger-codes-summary", "ledger-codes-notes",
    "ledger-codes-list", "ledger-codes-error", "ledger-codes-save",
  ].map(part);
  let context = null;
  let prepared = null;
  let loaded = null; // the file that `prepared` was read from
  let preset = null; // { file, onCommitted } of a dialog opened with openWith (the card of the assistant, step 4.7.3)

  const reset = () => {
    prepared = null;
    loaded = null;
    file.value = "";
    details.hidden = true;
    errorLine.textContent = "";
    save.disabled = true;
    save.textContent = "שמירה";
    clientLine.textContent = `לקוח: ${context.client.config.clientName ?? ""}`;
  };

  const render = () => {
    const { accounts, skipped, plan, hadOwnChart } = prepared;
    summary.textContent = `נמצאו ${Object.keys(accounts).length} קודי מיון בכרטסת.`;
    const lines = [];
    if (hadOwnChart) lines.push(element("li", "ללקוח כבר יש קודי מיון משלו; הם יוחלפו בקודים שבכרטסת (עותק שלהם יישמר בתיקיית הלקוח)."));
    if (plan.changed) {
      lines.push(element("li", `בהצהרות ${plan.months.map(formatMonth).join(", ")} יעודכנו הקודים של ${plan.changed} שורות שיובאו מ-Excel. עותק של כל טבלה נשמר לפני השינוי.`));
    }
    if (plan.unresolved.length) lines.push(element("li", `שורות שיובאו עם סוג שאינו בכרטסת לא יעודכנו: ${plan.unresolved.join(", ")}`, "problem-error"));
    if (plan.locked.length) lines.push(element("li", `הצהרות נעולות עם שורות מיובאות לא יעודכנו (יש לפתוח אותן מחדש): ${plan.locked.map(formatMonth).join(", ")}`, "problem-error"));
    for (const item of skipped) lines.push(element("li", `דולג: ${item.code || "—"} ${item.name || ""} (${SKIPPED_REASONS[item.reason] ?? item.reason})`, "problem-error"));
    notes.replaceChildren(...lines);
    list.replaceChildren(...Object.entries(accounts).map(([code, account]) => {
      const row = element("div", undefined, "unknown-account");
      row.dataset.code = code;
      const type = element("select");
      for (const value of ACCOUNT_TYPES) type.add(new Option(TYPE_LABELS[value], value));
      type.value = account.type;
      type.setAttribute("aria-label", `סוג עבור ${account.name}`);
      row.append(element("strong", account.name), element("span", code), type);
      return row;
    }));
    details.hidden = false;
    save.disabled = false;
  };

  file.addEventListener("change", async () => {
    errorLine.textContent = "";
    details.hidden = true;
    save.disabled = true;
    if (!file.files?.length) return;
    await load(file.files[0]);
  });

  async function load(selected) {
    try {
      loaded = selected;
      prepared = await prepareLedger(selected, { ...context, loadLibrary, loadPdf });
      render();
    } catch (error) {
      prepared = null;
      errorLine.textContent = error.message;
    }
  }

  // What the host does with the original once the codes are saved; a failure is told and never undoes the save.
  async function afterCommit() {
    if (!preset || loaded !== preset.file) return "";
    try {
      return (await preset.onCommitted()) ?? "";
    } catch (error) {
      return `הקובץ לא הועבר מתיבת הקלט: ${error.message}`;
    }
  }

  save.addEventListener("click", async () => {
    if (!prepared) return;
    save.disabled = true;
    errorLine.textContent = "";
    try {
      const types = Object.fromEntries([...list.querySelectorAll("[data-code]")].map((row) => [row.dataset.code, row.querySelector("select").value]));
      const detached = await onBeforeWrite?.(prepared.plan.months);
      const result = await commitLedger(prepared, { types, client: context.client, reserved: context.reserved });
      const filed = await afterCommit();
      await onSaved?.(result, detached);
      errorLine.textContent = "";
      summary.textContent = `נשמרו ${Object.keys(result.chart).length} קודי מיון של הלקוח${result.plan.changed ? `, עודכנו ${result.plan.changed} שורות` : ""}.${result.chartCopy ? " הקודים הקודמים נשמרו בעותק." : ""}${filed ? ` ${filed}` : ""}`;
      prepared = null;
      list.replaceChildren();
      notes.replaceChildren();
      save.textContent = "נשמר";
    } catch (error) {
      errorLine.textContent = error.message;
      save.disabled = false;
    }
  });

  return {
    open() {
      context = getContext();
      if (!context) return onError("יש לבחור תחילה תיקיית נתונים ולקוח לפני טעינת קודי מיון.");
      preset = null;
      reset();
      dialog.showModal();
    },
    // Opens the dialog with `selected` (a File) already read, for the open client. onCommitted() runs after the codes were saved
    // and resolves with a line for the user; it runs only if the file read is still this one.
    async openWith(selected, { onCommitted } = {}) {
      context = getContext();
      if (!context) return onError("יש לבחור תחילה תיקיית נתונים ולקוח לפני טעינת קודי מיון.");
      reset();
      preset = onCommitted ? { file: selected, onCommitted } : null;
      dialog.showModal();
      await load(selected);
    },
  };
}
