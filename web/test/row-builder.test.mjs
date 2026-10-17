import test from "node:test";
import assert from "node:assert/strict";
import { READY_CONFIDENCE, REASON_TEXT, buildRowSnapshot, excludeText, recognition } from "../row-builder.js";
import { rawRecord } from "./agent-fixtures.mjs";
import { normalizeRecord } from "../agent/fact-record.js";

const entry = { hash: "a".repeat(64), addedAt: "2026-10-16T08:00:00.000Z" };
const noFacts = { reasons: [], exclude: null, year: { year: 2026 }, duplicates: { level: null, matches: [] } };
const record = (overrides = {}) => normalizeRecord(rawRecord(overrides));
const build = (overrides = {}) => buildRowSnapshot({
  record: record(), entry, documentId: "agent-x-p0", decision: "expense", account: "202", accountName: "משרדיות", facts: noFacts, kind: "office", month: "2026-02",
  reason: "חשבונית משרדית", needsReview: false, agent: { run: "r1", version: "v1", fact: "F1.1" }, ...overrides,
});

test("an ordinary invoice becomes a ready, active row whose values are those of the document", () => {
  const row = build();
  assert.deepEqual(row.values, ["20/02/26", "202", "paper", "Paper Shop", "512345679", "2002", "", "236.00", "200.00", "36.00", "100", "100"]);
  assert.deepEqual([row.rawNet, row.rawVat, row.vatPercent, row.reference, row.documentKind, row.documentTitle], ["200", "36", "18", "INV-2002", "expense_invoice", "Tax invoice"]);
  assert.deepEqual([row.active, row.statusClass, row.statusText, row.wouldInclude, row.autoExclude], [true, "ready", "מוכן לייצוא", "true", ""]);
  assert.deepEqual([row.agentOpinion, row.confidence, row.receivedAt, row.documentId], ["חשבונית משרדית", "92%", entry.addedAt, "agent-x-p0"]);
  assert.deepEqual(row.agent, { run: "r1", version: "v1", fact: "F1.1", file: entry.hash, page: null, reasons: [] });
  assert.deepEqual([row.imageFile, row.imageIndex, row.highlights, row.processing, row.pcnApproved, row.imageIndex], ["", 0, [], "", "", 0]);
});

test("recognition follows the business rule of the page: 25% of a home for utilities, 66.67% VAT for the mobile codes, none without VAT", () => {
  const power = record({ purpose: "חשמל", net: 800, vat: 144, total: 944 });
  assert.deepEqual(recognition({ record: power, account: "204", kind: "home" }), { expensePercent: 25, vatPercent: 25, amounts: { gross: "236.00", net: "200.00", vat: "36.00" } });
  assert.equal(recognition({ record: power, account: "204", kind: "office" }).expensePercent, 100, "an office client has no 25% rule");
  assert.equal(recognition({ record: record({ purpose: "חשמל" }), account: "204", kind: "home", accountName: "" }).expensePercent, 25);
  assert.equal(recognition({ record: record({ purpose: "מזון", document_title: "קבלה" }), account: "209", kind: "home" }).expensePercent, 100);
  assert.deepEqual(recognition({ record: record(), account: "807", kind: "office" }).vatPercent, 66.67);
  assert.deepEqual(recognition({ record: record(), account: "807", kind: "office" }).amounts, { gross: "236.00", net: "212.00", vat: "24.00" });
  const exempt = recognition({ record: record({ net: 500, vat: 0, total: 500 }), account: "807", kind: "home" });
  assert.deepEqual([exempt.vatPercent, exempt.amounts], [100, { gross: "500.00", net: "500.00", vat: "0.00" }]);
  const row = build({ record: power, kind: "home", account: "204" });
  assert.deepEqual([row.values[7], row.values[8], row.values[9], row.values[10], row.values[11], row.rawNet, row.rawVat], ["236.00", "200.00", "36.00", "25", "25", "800", "144"], "the table shows 25%, the row keeps the document amounts");
});

test("a document that the code excludes is an inactive row with its reason; the model's wish to include it changes nothing", () => {
  const duplicate = { reasons: ["duplicate"], exclude: "duplicate", year: { year: 2026 }, duplicates: { level: "strong", matches: [{ month: "2026-02", status: "open", position: 0 }] } };
  const row = build({ facts: duplicate });
  assert.deepEqual([row.active, row.autoExclude, row.statusClass, row.statusText, row.wouldInclude], [false, "duplicate", "review", "כפילות של שורה 1 בהצהרה זו", "true"]);
  assert.match(row.agentOpinion, /חשבונית משרדית · לבדיקה: כפילות$/);
  const previous = build({ facts: { reasons: ["previous_year"], exclude: "previous-year", year: { year: 2025 }, duplicates: { level: null, matches: [] } } });
  assert.deepEqual([previous.active, previous.statusText], [false, "מסמך משנה קודמת (2025) — לבדוק את התאריך; אפשר לכלול ידנית"]);
});

test("excludeText names where the same document already is", () => {
  const facts = (matches) => ({ exclude: "duplicate", year: { year: 2026 }, duplicates: { matches } });
  assert.equal(excludeText(facts([]), "2026-02"), "כפילות — המסמך כבר הוזן");
  assert.equal(excludeText(facts([{ month: "2026-02", status: "open", position: 4 }]), "2026-02"), "כפילות של שורה 5 בהצהרה זו");
  assert.equal(excludeText(facts([{ month: "2026-01", status: "closed", position: 0 }]), "2026-02"), "כפילות — המסמך כבר הוזן ב‑01/2026 (הצהרה נעולה)");
  assert.equal(excludeText(facts([{ month: "2026-01", status: "open", position: 0 }]), "2026-02"), "כפילות — המסמך כבר הוזן ב‑01/2026");
  assert.match(excludeText({ exclude: "previous-year", year: { year: null }, duplicates: { matches: [] } }, "2026-02"), /\(\?\)/);
});

test("only an expense with a valid account that the model does not doubt, with nothing in the facts and good confidence, is ready", () => {
  assert.equal(build().statusClass, "ready");
  assert.deepEqual([build({ needsReview: true }).statusClass, build({ needsReview: true }).statusText, build({ needsReview: true }).active], ["review", "נדרש עיון", true]);
  assert.deepEqual([build({ decision: "not_expense", account: null }).statusText, build({ decision: "not_expense", account: null }).active], ["לא הוצאה — נדרש אישור", false]);
  assert.deepEqual([build({ decision: "unclear", account: null }).statusText, build({ decision: "unclear", account: null }).active], ["נדרש עיון", false]);
  assert.deepEqual([build({ account: null }).statusText, build({ account: null }).active, build({ account: null }).values[1]], ["נדרש קוד מיון", false, ""]);
  assert.equal(build({ decision: "not_expense", account: "202" }).values[1], "", "an account is only for an expense");
  const warned = build({ facts: { ...noFacts, reasons: ["deduction_check"] } });
  assert.deepEqual([warned.statusClass, warned.statusText, warned.active], ["review", "נדרש עיון", true]);
  assert.match(warned.agentOpinion, /לבדיקה: חלפו 6 חודשים/);
  const unsure = build({ record: record({ confidence: READY_CONFIDENCE - 1 }) });
  assert.deepEqual([unsure.statusClass, unsure.confidence], ["review", "79%"]);
});

test("the table shows the last four digits of the reference and the date as DD/MM/YY; the full reference stays in the row", () => {
  const row = build({ record: record({ document_number: "025-01-01-001662", date: "2026-09-03" }) });
  assert.deepEqual([row.values[0], row.values[5], row.reference], ["03/09/26", "1662", "025-01-01-001662"]);
  assert.equal(build({ record: record({ document_number: "MQ1X196ZF6" }) }).values[5], "1966", "as the table does: the last four of its digits");
  assert.equal(build({ record: record({ document_number: "ABC" }) }).values[5], "ABC");
  assert.equal(build({ record: record({ document_number: null }) }).values[5], "");
  assert.equal(build({ record: record({ date: null }) }).values[0], "", "no readable date");
});

test("a row without an explanation from the model says so; every code reason of the facts has a Hebrew text", () => {
  assert.equal(build({ reason: "  " }).agentOpinion, "לא נמסר הסבר מהסוכן.");
  const codes = ["amounts_mismatch", "bad_vat_id", "no_date", "foreign_currency", "buyer_mismatch", "duplicate", "possible_duplicate", "previous_year", "future_year", "deduction_check", "deduction_late", "pcn_over", "pcn_allocation_missing", "month_locked", "low_confidence", "date_unclear", "amount_unclear", "blurred", "cropped", "handwritten", "other_language", "kind_payment_confirmation", "kind_income_report", "kind_other"];
  for (const code of codes) assert.ok(REASON_TEXT[code], code);
  assert.deepEqual(Object.keys(REASON_TEXT).sort(), [...codes].sort());
});

test("a page of a PDF is kept in the row's agent data", () => {
  assert.equal(build({ record: record({ page: 3 }) }).agent.page, 3);
});
