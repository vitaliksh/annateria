// What stops a declaration from being locked (lock-check.js): one check for the lock button and for ready_to_close.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { closedMonthText, lockProblemText, lockProblems, periodProblems } from "../lock-check.js";
import { approvalKey } from "../pcn-review.js";

// values: date, account, purpose, supplier, supplier id, reference, allocation, gross, net, vat.
const row = (values, extra = {}) => ({ documentId: "d", values, rawNet: values[8], rawVat: values[9], reference: values[5], active: true, statusClass: "ready", ...extra });
const big = (extra = {}) => row(["10/02/2026", "202", "machine", "Big Supplier", "512222222", "9", "", "14160", "12000", "2160"], extra);
const small = () => row(["10/02/2026", "202", "paper", "Paper Shop", "512345679", "5", "", "118", "100", "18"]);

test("a table without an active row cannot be locked; the message is the one of the lock button", () => {
  assert.deepEqual(lockProblems([]), [{ code: "no_active_row", count: 0 }]);
  assert.deepEqual(lockProblems([{ ...small(), active: false }]), [{ code: "no_active_row", count: 0 }]);
  assert.equal(lockProblemText({ code: "no_active_row", count: 0 }), "יש לסמן לפחות שורה פעילה לפני נעילת ההצהרה.");
  assert.deepEqual(lockProblems([small()]), []);
});

test("for a PCN client an invoice above the ceiling blocks until it is approved and has its allocation number", () => {
  assert.deepEqual(lockProblems([small(), big()]), [], "no PCN duty: the ceiling does not matter");
  assert.deepEqual(lockProblems([small(), big()], { pcnRequired: true }), [{ code: "pcn_blocked", count: 1 }]);
  const numbered = big();
  numbered.values[6] = "123456789";
  assert.deepEqual(lockProblems([numbered], { pcnRequired: true }), [{ code: "pcn_blocked", count: 1 }], "a number is not an approval");
  numbered.pcnApproved = approvalKey(numbered);
  assert.deepEqual(lockProblems([numbered], { pcnRequired: true }), []);
  const approvedWithout = big();
  approvedWithout.pcnApproved = approvalKey(approvedWithout);
  assert.deepEqual(lockProblems([approvedWithout], { pcnRequired: true }), [{ code: "pcn_blocked", count: 1 }], "approved, still no number");
  assert.equal(lockProblemText({ code: "pcn_blocked", count: 2 }), "יש 2 שורות מעל סף מספר ההקצאה שלא אושרו או שחסר להן מספר הקצאה. יש להשלים לפני הנעילה.");
  assert.match(lockProblemText({ code: "pcn_blocked", count: 1 }), /^יש 1 שורה /);
  assert.equal(closedMonthText([{ code: "no_active_row", count: 0 }, { code: "pcn_blocked", count: 2 }]),
    "אין בהצהרה שורה פעילה. יש 2 שורות מעל סף מספר ההקצאה שלא אושרו או שחסר להן מספר הקצאה.");
  assert.match(closedMonthText([{ code: "pcn_blocked", count: 1 }]), /^יש 1 שורה /);
});

test("a closed month and ready_to_close use this one check, and the lock button no longer stops on it (step 9.3)", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const handler = app.slice(app.indexOf('closeDeclarationButton.addEventListener("click"'), app.indexOf("reopenDeclarationButton.addEventListener"));
  assert.doesNotMatch(handler, /lockProblems\(|lockProblemText\(/);
  assert.match(handler, /showClosedMonth\("ההצהרה ננעלה\. ההיסטוריה עודכנה\."\)/);
  const shown = app.slice(app.indexOf("function showClosedMonth("), app.indexOf("function queueDraftSave("));
  assert.match(shown, /lockProblems\(rows, \{ pcnRequired: /);
  assert.match(shown, /closedMonthText\(problems\)/);
  const tool = readFileSync(new URL("../agent/tools/ready-to-close.js", import.meta.url), "utf8");
  assert.match(tool, /lockProblems\(rows, \{ pcnRequired: profile\.pcnRequired \}\)/);
});

test("periodProblems: the months of the period with something found, oldest first (step 9.3)", () => {
  const active = { active: true, values: [] };
  const declarations = [
    { month: "2026-03", rows: [] }, { month: "2026-01", rows: [] }, { month: "2026-02", rows: [active] }, { month: "2026-04", rows: [] },
  ];
  assert.deepEqual(periodProblems(declarations, "2026-01", "2026-03"), [
    { month: "2026-01", problems: [{ code: "no_active_row", count: 0 }] },
    { month: "2026-03", problems: [{ code: "no_active_row", count: 0 }] },
  ]);
  assert.deepEqual(periodProblems(declarations, "2026-02", "2026-02"), []);
});
