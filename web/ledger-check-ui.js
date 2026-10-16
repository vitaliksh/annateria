// Dialog that checks the client's declarations against its classification ledger and adds the operations that are missing.
// Logic lives in ledger-reconcile-flow.js; this file only renders.
import { formatMonth } from "./month-format.js";
import { commitReconcile, prepareReconcile } from "./ledger-reconcile-flow.js";

const PROBLEM_TEXTS = {
  "unknown-class": "לסיווג אין קוד אצל הלקוח (יש לטעון קודם את כרטסת קודי המיון)",
  locked: "ההצהרה נעולה",
};
const money = (value) => value.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const displayDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

// getContext() returns { dataRoot, client, reserved } or null; onBeforeWrite(months) lets the host detach the open table
// and returns what onSaved(result, detached) needs to put it back.
export function setupLedgerCheck({ button = null, dialog, getContext, onSaved, onError, onBeforeWrite, loadLibrary, loadPdf }) {
  const part = (id) => dialog.querySelector(`#${id}`);
  const [clientLine, file, details, summary, list, extraBox, extraList, errorLine, add] = [
    "ledger-check-client", "ledger-check-file", "ledger-check-details", "ledger-check-summary", "ledger-check-list",
    "ledger-check-extra", "ledger-check-extra-list", "ledger-check-error", "ledger-check-add",
  ].map(part);
  let context = null;
  let prepared = null;

  const selectedIndexes = () => new Set([...list.querySelectorAll("input:checked")].map((box) => Number(box.dataset.index)));
  const updateAdd = () => {
    const count = selectedIndexes().size;
    add.disabled = count === 0;
    add.textContent = count ? `הוספת ${count} פעולות להצהרות` : "הוספה";
  };

  const reset = () => {
    prepared = null;
    file.value = "";
    details.hidden = true;
    errorLine.textContent = "";
    add.disabled = true;
    add.textContent = "הוספה";
    clientLine.textContent = `לקוח: ${context.client.config.clientName ?? ""}`;
  };

  const render = () => {
    const { operations, matched, missing, extra } = prepared;
    summary.textContent = missing.length || extra.length
      ? `בכרטסת ${operations} פעולות: ${matched} קיימות בהצהרות, ${missing.length} חסרות${extra.length ? `, ו-${extra.length} שורות בהצהרות אין להן התאמה בכרטסת` : ""}.`
      : `הכול תואם: כל ${operations} הפעולות שבכרטסת נמצאות בהצהרות.`;
    summary.className = missing.length || extra.length ? "summary-line" : "summary-line plate-success";
    list.replaceChildren(...missing.map((operation, index) => {
      const row = element("label", undefined, "check-line ledger-missing");
      const box = element("input");
      box.type = "checkbox";
      box.dataset.index = String(index);
      box.checked = !operation.problem;
      box.disabled = Boolean(operation.problem);
      box.addEventListener("change", updateAdd);
      const text = [
        formatMonth(operation.month), displayDate(operation.date), operation.name, operation.details,
        `${money(operation.net)} (מע״מ ${money(operation.vat)})`,
        operation.problem ? PROBLEM_TEXTS[operation.problem] : operation.creates ? "ההצהרה תיווצר" : "",
      ].filter(Boolean).join(" · ");
      row.append(box, element("span", text, operation.problem ? "problem-error" : undefined));
      return row;
    }));
    extraBox.hidden = !extra.length;
    extraList.replaceChildren(...extra.map((item) => element("li", `${formatMonth(item.month)} · ${displayDate(item.date)} · ${item.name} · ${item.details} · ${money(item.net)}`)));
    details.hidden = false;
    updateAdd();
  };

  file.addEventListener("change", async () => {
    errorLine.textContent = "";
    details.hidden = true;
    add.disabled = true;
    if (!file.files?.length) return;
    try {
      prepared = await prepareReconcile(file.files[0], { ...context, loadLibrary, loadPdf });
      render();
    } catch (error) {
      prepared = null;
      errorLine.textContent = error.message;
    }
  });

  add.addEventListener("click", async () => {
    if (!prepared) return;
    const selected = selectedIndexes();
    add.disabled = true;
    errorLine.textContent = "";
    try {
      const months = [...new Set(prepared.missing.filter((operation, index) => selected.has(index)).map((operation) => operation.month))];
      const detached = await onBeforeWrite?.(months);
      const result = await commitReconcile(prepared, { selected, client: context.client });
      await onSaved?.(result, detached);
      summary.textContent = `נוספו ${result.added} פעולות להצהרות ${result.months.map(formatMonth).join(", ")}. עותק של כל טבלה נשמר לפני השינוי.`;
      summary.className = "summary-line plate-success";
      prepared = null;
      list.replaceChildren();
      extraBox.hidden = true;
      add.textContent = "נוסף";
    } catch (error) {
      errorLine.textContent = error.message;
      add.disabled = false;
    }
  });

  const open = () => {
    context = getContext();
    if (!context) return onError("יש לבחור תחילה תיקיית נתונים ולקוח לפני בדיקה מול כרטסת.");
    reset();
    dialog.showModal();
  };
  button?.addEventListener("click", open);
  return { open };
}
