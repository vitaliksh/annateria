// What stops a declaration from being locked (step 6.2). One function for the lock button of the journal and for the tool
// ready_to_close of the agent, so that the agent's "ready to close" can never disagree with the button. Pure; no DOM.
//
// Rows are in the draft-table format (rowSnapshot of app.js, or a saved draft-table.json).
import { pcnReview, pcnSummary } from "./pcn-review.js";

const plural = (count, one, many) => (count === 1 ? one : many);

// [{ code, count }] in the order the button reports them; empty when the declaration can be locked.
// no_active_row: nothing would be reported. pcn_blocked: rows above the allocation ceiling of a PCN client that are not
// approved or have no allocation number.
export function lockProblems(rows, { pcnRequired = false } = {}) {
  const problems = [];
  if (!rows.some((row) => row.active)) problems.push({ code: "no_active_row", count: 0 });
  const { blocked } = pcnSummary(pcnReview(rows, { pcnRequired }));
  if (blocked) problems.push({ code: "pcn_blocked", count: blocked });
  return problems;
}

// The red line of a closed month (step 9.3): the checks no longer stop the lock, the month says what they found.
export function closedMonthText(problems) {
  return problems
    .map(({ code, count }) => code === "no_active_row"
      ? "אין בהצהרה שורה פעילה."
      : `יש ${count} ${plural(count, "שורה", "שורות")} מעל סף מספר ההקצאה שלא אושרו או שחסר להן מספר הקצאה.`)
    .join(" ");
}

// The months of a period whose saved rows the checks find something in, for the red line of the reports page (step 9.3).
// declarations: [{ month, rows }] (loadReportDeclarations); from, to: "YYYY-MM". Resolves to [{ month, problems }], oldest first.
export function periodProblems(declarations, from, to, { pcnRequired = false } = {}) {
  return declarations
    .filter(({ month }) => month >= from && month <= to)
    .map(({ month, rows }) => ({ month, problems: lockProblems(rows, { pcnRequired }) }))
    .filter(({ problems }) => problems.length)
    .sort((left, right) => left.month.localeCompare(right.month));
}

// The message of the lock button for one problem.
export function lockProblemText({ code, count }) {
  if (code === "no_active_row") return "יש לסמן לפחות שורה פעילה לפני נעילת ההצהרה.";
  return `יש ${count} ${plural(count, "שורה", "שורות")} מעל סף מספר ההקצאה שלא אושרו או שחסר להן מספר הקצאה. יש להשלים לפני הנעילה.`;
}
