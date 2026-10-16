// Dialog "פיזור שורות לחודשים": proposes a declaration month for every row of the open table (by the document date, never
// into a filed month) and moves the rows that are assigned to another month, with their images. Logic lives in
// rows-move-flow.js and month-distribution.js; this file only renders.
import { formatMonth } from "./month-format.js";
import { commitMove, prepareMove } from "./rows-move-flow.js";

const DEDUCTION_TEXTS = {
  check: "לניכוי המע״מ: חלפו 6 חודשים מתאריך המסמך — לבדוק",
  late: "לניכוי המע״מ: חלפו יותר מ‑6 חודשים מתאריך המסמך — לבדוק מול רואה החשבון",
};
const money = (value) => value.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

// getContext() returns { client, month, isIncomeCode } for the open declaration or null. beforeOpen() may return a message that
// refuses to open (for example while rows are still being processed) after saving the table; onBeforeWrite() lets the host detach
// the open table, onSaved(result) puts it back (result is null when the move failed).
export function setupRowsMove({ button = null, dialog, getContext, beforeOpen, onBeforeWrite, onSaved, onError, now = () => new Date() }) {
  const part = (id) => dialog.querySelector(`#${id}`);
  const [clientLine, summary, list, rest, restTitle, restList, errorLine, run] = [
    "rows-move-client", "rows-move-summary", "rows-move-list", "rows-move-rest", "rows-move-rest-title", "rows-move-rest-list",
    "rows-move-error", "rows-move-run",
  ].map(part);
  let context = null;
  let prepared = null;

  const selects = () => [...dialog.querySelectorAll("select[data-index]")];
  const movingCount = () => selects().filter((select) => select.value !== prepared.month).length;

  const refreshButton = () => {
    const count = movingCount();
    run.disabled = count === 0;
    run.textContent = count ? `העברת ${count} שורות` : "העברה";
  };

  const note = (line, target) => {
    const parts = [];
    if (line.reason === "after-locked") parts.push(`התאריך בחודש שכבר הוגש (עד ${formatMonth(prepared.lockedThrough)} נעול); הוצע החודש הראשון שאחריו`);
    if (line.reason === "period-received") parts.push("מסמך לתקופה — נרשם בחודש הקבלה");
    if (line.reason === "no-date") parts.push("אין תאריך קריא — לא הוצע חודש");
    if (line.reason === "implausible") parts.push("התאריך חשוד — לא הוצע חודש");
    const deduction = context.isIncomeCode?.(line.code) ? "ok" : prepared.deduction(line, target);
    if (deduction !== "ok") parts.push(DEDUCTION_TEXTS[deduction]);
    if (target !== prepared.month && prepared.similar(line, target)) parts.push(`בהצהרה ${formatMonth(target)} כבר יש שורה עם אותו תאריך, קוד וסכום — לבדוק כפילות`);
    if (line.hasImage && target !== prepared.month) parts.push("התמונה תועתק להצהרת היעד");
    return parts.join(" · ");
  };

  const lineElement = (line) => {
    const row = element("div", undefined, "move-line");
    const select = element("select");
    select.dataset.index = String(line.index);
    select.setAttribute("aria-label", "חודש היעד");
    for (const option of prepared.months) {
      const label = `${formatMonth(option.month)}${option.month === prepared.month ? " · הצהרה זו" : option.exists ? "" : " (תיווצר)"}`;
      select.append(new Option(label, option.month));
    }
    select.value = prepared.suggested(line);
    const noteNode = element("span", note(line, select.value), "move-note");
    select.addEventListener("change", () => {
      noteNode.textContent = note(line, select.value);
      row.dataset.moving = String(select.value !== prepared.month);
      refreshButton();
    });
    row.dataset.moving = String(select.value !== prepared.month);
    row.append(
      select,
      element("span", [line.date || "ללא תאריך", line.text, `${money(line.gross)} ₪${line.vat ? ` (מע״מ ${money(line.vat)})` : ""}`].filter(Boolean).join(" · "), "move-text"),
      noteNode,
    );
    return row;
  };

  const render = () => {
    clientLine.textContent = `לקוח: ${context.client.config.clientName ?? ""} · הצהרה: ${formatMonth(prepared.month)}`;
    const suggested = prepared.lines.filter((line) => prepared.suggested(line) !== prepared.month);
    const others = prepared.lines.filter((line) => !suggested.includes(line));
    summary.textContent = suggested.length
      ? `מוצע להעביר ${suggested.length} מתוך ${prepared.lines.length} שורות לחודש אחר.${prepared.lockedThrough ? ` החודשים עד ${formatMonth(prepared.lockedThrough)} נעולים ואינם מוצעים.` : ""}`
      : `לכל ${prepared.lines.length} השורות יש חודש מתאים בהצהרה זו. אפשר להעביר שורה ידנית.`;
    summary.className = suggested.length ? "summary-line" : "summary-line plate-success";
    list.replaceChildren(...suggested.map(lineElement));
    restList.replaceChildren(...others.map(lineElement));
    rest.hidden = !others.length;
    rest.open = !suggested.length;
    restTitle.textContent = `${suggested.length ? "שורות שיישארו בהצהרה" : "כל השורות"} (${others.length})`;
    errorLine.textContent = "";
    refreshButton();
  };

  // auto: offered after a batch of documents; shown only when some row has a proposal other than its own month.
  const open = async ({ auto = false } = {}) => {
    const fail = (message) => (auto ? false : (onError(message), false));
    context = getContext();
    if (!context) return fail("יש לבחור הצהרה פתוחה לפני פיזור שורות לחודשים.");
    if (auto && typeof dialog.showModal !== "function") return false;
    const blocked = await beforeOpen?.();
    if (blocked) return fail(blocked);
    try {
      prepared = await prepareMove({ client: context.client, month: context.month, today: now() });
    } catch (error) {
      return fail(error.message);
    }
    if (!prepared.lines.length) return fail("אין שורות בהצהרה.");
    if (auto && !prepared.lines.some((line) => prepared.suggested(line) !== prepared.month)) return false;
    render();
    dialog.showModal();
    return true;
  };

  run.addEventListener("click", async () => {
    if (!prepared) return;
    const assignments = new Map(selects().map((select) => [Number(select.dataset.index), select.value]));
    run.disabled = true;
    errorLine.textContent = "";
    let result = null;
    try {
      await onBeforeWrite?.();
      result = await commitMove(prepared, { assignments, client: context.client });
    } catch (error) {
      errorLine.textContent = error.message;
    }
    try {
      await onSaved?.(result);
    } catch (error) {
      errorLine.textContent = error.message;
    }
    if (!result) return refreshButton();
    summary.textContent = `הועברו ${result.moved} שורות להצהרות ${result.months.map(formatMonth).join(", ")}. עותק של כל טבלה נשמר לפני השינוי.`;
    summary.className = "summary-line plate-success";
    prepared = null;
    list.replaceChildren();
    restList.replaceChildren();
    rest.hidden = true;
    run.textContent = "הועבר";
  });

  button?.addEventListener("click", () => open());
  return { open, offer: () => open({ auto: true }) };
}
