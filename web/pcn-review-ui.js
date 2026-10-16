// The PCN review in the journal (rules in pcn-review.js): for a client that must produce a PCN874 file an invoice above
// the allocation-number ceiling gets a yellow row and a box that the bookkeeper ticks; a missing allocation number is
// marked in its cell, the allocation column is shown while such a client is open, and a plate counts what is left.
// The host passes snapshot(row) (rowSnapshot of app.js) and getContext(): null (no open declaration) or { pcnRequired }.
import { approvalKey, pcnReview, pcnSummary } from "./pcn-review.js";

const STATUS_CELL = 16;
const ALLOCATION_CELL = 7;
const BOX_CLASS = "pcn-approve";

const plural = (count, one, many) => (count === 1 ? one : many);

export function setupPcnReview({ records, plate, getContext, snapshot, columns = null, isTableLocked = () => false, onChange = () => {} }) {
  const doc = records.ownerDocument;
  const Observer = doc.defaultView.MutationObserver;
  let reviews = [];
  let scheduled = false;

  const dataRows = () => [...records.querySelectorAll("tr[data-document-id]")];

  function ensureBox(row) {
    const cell = row.cells[STATUS_CELL];
    let box = cell.querySelector(`.${BOX_CLASS} input`);
    if (box) return box;
    // The label text comes from CSS so that it never becomes part of the status text that rowSnapshot reads.
    const label = doc.createElement("label");
    label.className = BOX_CLASS;
    label.title = "אישור מנהלת חשבונות: החשבונית נבדקה";
    box = doc.createElement("input");
    box.type = "checkbox";
    const text = doc.createElement("span");
    text.dataset.label = "נבדק";
    label.append(box, text);
    cell.append(label);
    return box;
  }
  function removeBox(row) {
    row.cells[STATUS_CELL]?.querySelector(`.${BOX_CLASS}`)?.remove();
  }

  function markAllocation(row, review) {
    const cell = row.cells[ALLOCATION_CELL];
    if (!cell) return;
    const missing = Boolean(review?.missingAllocation);
    if (missing) cell.dataset.pcnMissing = "true";
    else delete cell.dataset.pcnMissing;
    if (missing) cell.title = `נדרש מספר הקצאה: חשבונית מעל ${review.threshold.toLocaleString("en-US")} ₪ לפני מע״מ`;
    else if (review?.allocationWarning) cell.title = "מספר הקצאה אמור להכיל 9 ספרות";
    else cell.removeAttribute("title");
  }

  function applyRow(row, review) {
    const over = Boolean(review?.over);
    const state = !over ? "" : review.approved ? "approved" : "review";
    if (state) row.dataset.pcn = state;
    else delete row.dataset.pcn;
    markAllocation(row, review);
    if (!over) return removeBox(row);
    const box = ensureBox(row);
    box.checked = review.approved;
    box.disabled = isTableLocked();
  }

  function showPlate(summary, overCount) {
    let text = "";
    let kind = "warning";
    if (summary.blocked) {
      const parts = [];
      if (summary.pending) {
        parts.push(`${summary.pending} ${plural(summary.pending, "שורה מעל סף מספר ההקצאה ממתינה", "שורות מעל סף מספר ההקצאה ממתינות")} לאישור מנהלת החשבונות (שורות צהובות)`);
      }
      if (summary.missingAllocation) {
        parts.push(`${summary.missingAllocation} ${plural(summary.missingAllocation, "שורה", "שורות")} ללא מספר הקצאה`);
      }
      text = `לקוח עם חובת PCN: ${parts.join("; ")}.`;
    } else if (overCount) {
      text = "לקוח עם חובת PCN: כל החשבוניות מעל סף מספר ההקצאה אושרו.";
      kind = "success";
    }
    plate.hidden = !text;
    plate.textContent = text;
    plate.className = `plate pcn-plate plate-${kind}`;
  }

  function refresh() {
    scheduled = false;
    const pcn = Boolean(getContext()?.pcnRequired);
    columns?.setForced(pcn ? ["allocation"] : []);
    const rows = dataRows();
    reviews = pcn ? pcnReview(rows.map(snapshot), { pcnRequired: true }) : rows.map(() => ({ applies: false }));
    rows.forEach((row, index) => applyRow(row, reviews[index]));
    showPlate(pcnSummary(reviews), reviews.filter((review) => review.over).length);
  }
  // Edits arrive in bursts (a whole table is restored row by row): one refresh per burst.
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    Promise.resolve().then(refresh);
  }

  records.addEventListener("change", (event) => {
    const box = event.target.closest?.(`.${BOX_CLASS} input`);
    if (!box) return schedule();
    const row = box.closest("tr[data-document-id]");
    row.dataset.pcnApproved = box.checked ? approvalKey(snapshot(row)) : "";
    onChange();
    refresh();
  });
  records.addEventListener("focusout", schedule);
  new Observer(schedule).observe(records, { childList: true, subtree: true });
  refresh();

  // The text of the refusal to lock, or "" when every invoice above the ceiling is approved and has its number.
  function lockProblem() {
    refresh();
    const { blocked } = pcnSummary(reviews);
    return blocked
      ? `יש ${blocked} ${plural(blocked, "שורה", "שורות")} מעל סף מספר ההקצאה שלא אושרו או שחסר להן מספר הקצאה. יש להשלים לפני הנעילה.`
      : "";
  }
  return { refresh, lockProblem };
}
