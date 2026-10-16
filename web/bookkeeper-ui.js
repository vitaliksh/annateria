// The "עיבוד חשבונאי" button and the plate above the journal. A row with fresh OCR waits for the bookkeeper agent
// (data-processing="pending") and cannot be edited until the agent has run, with one exception: a failed run opens the
// rows again (data-processing="failed") so that nobody is ever stuck. Logic of the run is in bookkeeper-flow.js; this file
// holds the states, the locks and the messages. The host applies a plan to a row (applyPlan).
import { backupTable, recheckIntake, runBookkeeper } from "./bookkeeper-flow.js";

export const PENDING = "pending";
export const FAILED = "failed";
// Cells that stay usable on a waiting row: photo, status (re-run), delete.
const OPEN_CELLS = [13, 16, 18];
const LOCKED_CONTROLS = "select,input,.field-swap";
const RECHECK_COLUMNS = [2, 4, 5, 6, 8];

const plural = (count, one, many) => (count === 1 ? one : many);

// getContext() returns null (no open declaration) or { client, month, snapshots(), call(body), reserved, beforeRun(),
// onChange() }. snapshots() lists every row of the table in table order; beforeRun() saves the table and may return a
// message that refuses the run. applyPlan(row, plan) writes a plan into a row; afterRun(plans) runs after the last batch.
// The run starts by itself when autoState() says "ready" (autoDelayMs after the last change of the table); "busy" (the
// recognition is still running) waits and asks again, anything else leaves it to the button. confirmAll(count) asks
// before "runAll" gives every active row to the agent again.
export function setupBookkeeper({ records, button, plate, getContext, applyPlan, applyRecheck, afterRun, isTableLocked = () => false, now = () => new Date(), autoState = () => "off", autoDelayMs = 3000, confirmAll = async () => true }) {
  const doc = records.ownerDocument;
  const Observer = doc.defaultView.MutationObserver;
  let running = false;
  let lastError = "";
  let lastResult = "";
  let resultMonth = "";
  let resultTimer = null;
  let autoTimer = null;

  const dataRows = () => [...records.querySelectorAll("tr[data-document-id]")];
  const waiting = () => dataRows().filter((row) => row.dataset.processing === PENDING || row.dataset.processing === FAILED);
  const pendingCount = () => dataRows().filter((row) => row.dataset.processing === PENDING).length;

  // Applied every time, not once: setTableLocked (host) re-enables every cell when it unlocks the table.
  function lockRow(row) {
    row.dataset.agentLock = "true";
    [...row.cells].forEach((cell, column) => {
      if (OPEN_CELLS.includes(column)) return;
      if (cell.matches(".editable")) cell.contentEditable = "false";
      for (const control of cell.querySelectorAll(LOCKED_CONTROLS)) control.disabled = true;
    });
  }
  function unlockRow(row) {
    if (!row.dataset.agentLock) return;
    delete row.dataset.agentLock;
    if (isTableLocked()) return;
    for (const cell of row.querySelectorAll(".editable")) cell.contentEditable = "true";
    for (const control of row.querySelectorAll(LOCKED_CONTROLS)) control.disabled = false;
  }
  function syncRow(row) {
    const isPending = row.dataset.processing === PENDING;
    row.classList.toggle("waiting-agent", isPending);
    if (isPending) lockRow(row);
    else unlockRow(row);
  }
  const syncAll = () => dataRows().forEach(syncRow);

  function show(text, kind) {
    plate.hidden = !text;
    plate.textContent = text;
    plate.className = `plate bookkeeper-plate plate-${kind}`;
  }
  function waitingMessage(count) {
    return `${count} ${plural(count, "שורה חדשה ממתינה", "שורות חדשות ממתינות")} לעיבוד חשבונאי. עד העיבוד אי אפשר לערוך אותן — ${autoState() === "off" ? "לחצו על \"עיבוד חשבונאי\"" : "העיבוד יתחיל מעצמו בעוד רגע"}.`;
  }
  function refresh() {
    const rows = waiting();
    const pending = pendingCount();
    button.hidden = !rows.length || !getContext();
    button.disabled = running;
    button.classList.toggle("attention", !running && pending > 0);
    if (running) return show(`מעבד ${rows.length} שורות…`, "info");
    if (pending) return show(waitingMessage(pending), "warning");
    if (rows.length) {
      const reason = lastError ? `: ${lastError.replace(/[.\s]+$/, "")}` : "";
      return show(`העיבוד החשבונאי לא הושלם${reason}. אפשר לערוך את השורות ידנית; הכפתור "עיבוד חשבונאי" נשאר זמין לניסיון נוסף.`, "error");
    }
    show(getContext()?.month === resultMonth ? lastResult : "", "success");
  }

  // A click on a blocked cell explains why instead of doing nothing.
  function explain() {
    const count = pendingCount();
    if (!count) return;
    show(waitingMessage(count), "warning");
    plate.classList.add("flash");
    plate.scrollIntoView?.({ block: "nearest" });
    setTimeout(() => plate.classList.remove("flash"), 1200);
  }
  records.addEventListener(
    "click",
    (event) => {
      const row = event.target.closest?.("tr.waiting-agent");
      if (!row || event.target.closest("button,a")) return;
      const column = [...row.cells].indexOf(event.target.closest("td"));
      if (column >= 0 && !OPEN_CELLS.includes(column)) explain();
    },
    true,
  );
  // A row that the user includes again is the user's decision: it is no longer excluded by the code.
  records.addEventListener("change", (event) => {
    const row = event.target.closest?.("tr[data-document-id]");
    if (row && event.target.matches('td input[type="checkbox"]') && event.target.checked) delete row.dataset.autoExclude;
  });
  // A corrected date, reference, supplier or amount may lift (or bring back) the exclusion made by the code.
  records.addEventListener("focusout", (event) => {
    const cell = event.target.closest?.("td");
    const row = cell?.parentElement;
    if (!row?.dataset.autoExclude || !RECHECK_COLUMNS.includes([...row.cells].indexOf(cell))) return;
    recheck(row).catch(() => {});
  });
  async function recheck(row) {
    const context = getContext();
    if (!context || !applyRecheck) return;
    const snapshots = context.snapshots();
    const index = dataRows().indexOf(row);
    if (index < 0) return;
    const facts = await recheckIntake({ client: context.client, month: context.month, snapshots, index, today: now() });
    if ((facts.exclude ?? "") !== (row.dataset.autoExclude ?? "")) applyRecheck(row, facts);
  }

  // Runs the agent on the waiting rows; true when a run was made (it may still have failed).
  async function run() {
    if (running) return false;
    const context = getContext();
    const rows = waiting();
    if (!context || !rows.length) return false;
    const busy = await context.beforeRun?.();
    if (busy) {
      show(busy, "warning");
      return false;
    }
    running = true;
    lastError = "";
    lastResult = "";
    refresh();
    const byPosition = new Map();
    try {
      await backupTable(context.client, context.month);
      const snapshots = context.snapshots();
      const all = dataRows();
      for (const row of rows) byPosition.set(all.indexOf(row), row);
      const plans = await runBookkeeper({
        client: context.client,
        month: context.month,
        snapshots,
        waiting: [...byPosition.keys()].sort((a, b) => a - b),
        reserved: context.reserved,
        call: context.call,
        today: now(),
        onBatch: (batch) => {
          for (const plan of batch) {
            const row = byPosition.get(plan.index);
            if (!row?.isConnected) continue;
            applyPlan(row, plan);
            row.dataset.processing = "";
            byPosition.delete(plan.index);
          }
          context.onChange?.();
        },
      });
      const review = plans.filter((plan) => plan.review).length;
      lastResult = `העיבוד החשבונאי הושלם: ${plans.length} ${plural(plans.length, "שורה", "שורות")}, ${review} לבדיקה.`;
      resultMonth = context.month;
      clearTimeout(resultTimer);
      resultTimer = setTimeout(() => {
        lastResult = "";
        refresh();
      }, 30000);
      // A row the answer did not cover must not wait for ever (and must not start the automatic run again).
      for (const row of byPosition.values()) if (row.isConnected) row.dataset.processing = FAILED;
      afterRun?.(plans);
    } catch (error) {
      lastError = error?.message || "שגיאה לא ידועה";
      for (const row of byPosition.values()) if (row.isConnected) row.dataset.processing = FAILED;
      context.onChange?.();
    } finally {
      running = false;
      syncAll();
      refresh();
    }
    return true;
  }
  button.addEventListener("click", () => run());

  // Every active row of the table except Excel and ledger rows (already filed with the bookkeeper's own accounts) and
  // income reports goes through the agent again, after the user confirms: a decision made by hand is replaced.
  const eligibleForAll = (row) =>
    row.cells[17]?.querySelector("input")?.checked &&
    row.dataset.processing !== PENDING &&
    row.dataset.documentKind !== "income_report" &&
    !String(row.dataset.documentId ?? "").startsWith("import-");
  async function runAll() {
    if (running) return;
    if (!getContext()) return;
    if (isTableLocked()) return show("ההצהרה נעולה — אי אפשר להפעיל עיבוד חשבונאי.", "warning");
    const rows = dataRows().filter(eligibleForAll);
    if (!rows.length) return show("אין שורות פעילות לעיבוד חשבונאי.", "info");
    if (!(await confirmAll(rows.length))) return;
    const busy = await getContext()?.beforeRun?.();
    if (busy) return show(busy, "warning");
    for (const row of rows) row.dataset.processing = PENDING;
    syncAll();
    if (!(await run())) for (const row of rows) if (row.dataset.processing === PENDING) row.dataset.processing = "";
  }

  // Automatic start: a quiet moment after the last change of a table that has waiting rows.
  function scheduleAuto() {
    clearTimeout(autoTimer);
    autoTimer = null;
    if (running || !pendingCount()) return;
    autoTimer = setTimeout(tryAuto, autoDelayMs);
  }
  function tryAuto() {
    autoTimer = null;
    if (running || !pendingCount() || !getContext()) return;
    const state = autoState();
    if (state === "busy") scheduleAuto();
    else if (state === "ready") run();
  }

  new Observer(() => {
    syncAll();
    refresh();
    scheduleAuto();
  }).observe(records, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-processing"] });
  syncAll();
  refresh();
  scheduleAuto();
  return { refresh, syncAll, run, runAll, waitingCount: pendingCount };
}
