// What stops a declaration from being locked (lock-check.js): one check for the lock button and for ready_to_close.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lockProblemText, lockProblems } from "../lock-check.js";
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
});

test("the lock button and ready_to_close use this one check", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const handler = app.slice(app.indexOf('closeDeclarationButton.addEventListener("click"'), app.indexOf("reopenDeclarationButton.addEventListener"));
  assert.match(handler, /lockProblems\(snapshots, \{ pcnRequired: /);
  assert.match(handler, /showError\(lockProblemText\(lockProblem\)\)/);
  const tool = readFileSync(new URL("../agent/tools/ready-to-close.js", import.meta.url), "utf8");
  assert.match(tool, /lockProblems\(rows, \{ pcnRequired: profile\.pcnRequired \}\)/);
});
