// Applies a proposal of the agent (propose_change) to the table that is open, when the user presses the button of the card. Every change is
// checked first: the table must be the month of the change and unlocked, and the row at the number of the change must still be the row
// the agent meant (the same documentId), otherwise the table was changed in the meantime and the change is refused, not guessed.
// The edit itself is done by the page (`ops`) with the same functions as typing in a cell, so recalculation, the duplicate check and the
// saving of the draft happen as for any edit. Month moves are not done here: they go through the dialog "פיזור שורות לחודשים".
import { formatMonth } from "./month-format.js";
import { displayDate } from "./row-builder.js";

const CELL = { date: 2, purpose: 3, supplier_name: 4, supplier_vat_id: 5, allocation_number: 7 };
const AMOUNT_COLUMN = { total: 8, net: 9, vat: 10 };
const PERCENT_ROLE = { vat_recognized_percent: "vat", expense_recognized_percent: "expense" };

export const REFUSALS = {
  locked: "ההצהרה נעולה",
  other_month: (month) => `חודש ${formatMonth(month)} אינו פתוח בטבלה: יש לפתוח אותו כדי להחיל`,
  changed: "הטבלה השתנתה מאז ההצעה: השורה אינה השורה שהוצעה",
  month_move: "העברה לחודש אחר נעשית דרך «פיזור שורות לחודשים»",
};

// proposal: { changes: [{ row, documentId, month, position, field, value, reason }] } (the changes the user kept).
// ops: { locked(), month(), rows(), setText(row, cell, text), setReference(row, full), setAmount(row, column, number), setAccount(row, code),
//        setPercent(row, role, number), setInclude(row, flag), edited(row) }.
// Resolves with { applied: [change], refused: [{ change, reason }] }.
export function applyProposal(proposal, ops) {
  const applied = [];
  const refused = [];
  const touched = new Set();
  for (const change of proposal.changes) {
    const refuse = (reason) => refused.push({ change, reason });
    if (ops.locked()) { refuse(REFUSALS.locked); continue; }
    if (change.field === "month") { refuse(REFUSALS.month_move); continue; }
    if (change.month !== ops.month()) { refuse(REFUSALS.other_month(change.month)); continue; }
    const row = ops.rows()[change.position - 1];
    if (!row || row.dataset.documentId !== change.documentId) { refuse(REFUSALS.changed); continue; }
    const { field, value } = change;
    if (field in CELL) ops.setText(row, CELL[field], field === "date" ? displayDate(value) : value);
    else if (field === "document_number") {
      ops.setReference(row, value);
      ops.setText(row, 6, String(value).replace(/\D/g, "").slice(-4) || value);
    } else if (field in AMOUNT_COLUMN) ops.setAmount(row, AMOUNT_COLUMN[field], value);
    else if (field === "account") ops.setAccount(row, value);
    else if (field in PERCENT_ROLE) ops.setPercent(row, PERCENT_ROLE[field], value);
    else if (field === "include") ops.setInclude(row, value);
    else { refuse(`שדה לא נתמך: ${field}`); continue; }
    touched.add(row);
    applied.push(change);
  }
  for (const row of touched) ops.edited(row);
  return { applied, refused };
}
