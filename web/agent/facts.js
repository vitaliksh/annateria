// What the code knows about one extracted fact for one client (docs/AGENT_TOOLS.md, facts_for). The tools facts_for and add_rows both
// use it, so that what the agent was told and what is written into the table are computed in one place: the month, the year gate,
// duplicates, the VAT deduction window, the ceiling for an allocation number, the 25% of a home. The model supplies nothing numeric.
import { ToolError } from "./errors.js";
import { intakeFacts, isPeriodDocument } from "../intake-facts.js";
import { isHomeUtility } from "../home-utilities.js";
import { pcnReview } from "../pcn-review.js";

// The two-month VAT period of a month: 2026-07 and 2026-08 are both "2026-07".
const pairOf = (month) => {
  const [year, number] = String(month).split("-").map(Number);
  return `${year}-${String(number % 2 ? number : number - 1).padStart(2, "0")}`;
};
export const sameVatPeriod = (vatPeriod, docMonth, targetMonth) => vatPeriod === "bimonthly" && Boolean(docMonth) && pairOf(docMonth) === pairOf(targetMonth);

export const LOW_CONFIDENCE = 80;
export const digits = (value) => String(value ?? "").replace(/\D/g, "").replace(/^0+/, "");

// The fact as a row in the draft-table format, which is what the intake rules read.
function candidateRow(record, entry, handle) {
  return {
    documentId: `fact:${handle}`, receivedAt: entry.addedAt, documentKind: record.kind, active: true,
    values: [record.date ?? "", "", record.purpose ?? "", record.supplier_name ?? "", record.supplier_vat_id ?? "", record.document_number ?? "", record.allocation_number ?? "", String(record.total), String(record.net), String(record.vat)],
    rawNet: record.net, rawVat: record.vat, reference: record.document_number ?? "",
  };
}

// args: { fact, client, month? } with handles; month defaults to the month of the run (step 9.6), which is where add_rows writes. Returns { output, facts, record, entry, profile, clientValue }: `output` is what facts_for
// answers, `facts` the raw result of intakeFacts (what the row builder reads).
export async function computeFacts(ctx, args) {
  const { entry, record } = ctx.handles.getFact(args.fact);
  const clientValue = ctx.handles.get("C", args.client);
  if (args.month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(args.month)) throw new ToolError("invalid_argument", "month must look like 2026-03.");
  const month = args.month ?? ctx.scope?.month ?? null;
  const [profile, intake] = await Promise.all([ctx.services.clients.profile(clientValue.clientId), ctx.services.intake.context(clientValue.clientId)]);
  const today = ctx.today();
  const row = candidateRow(record, entry, args.fact);
  const candidate = { row, month: month ?? today.toISOString().slice(0, 7), position: Number.MAX_SAFE_INTEGER, periodFrom: record.period_from ?? "", periodTo: record.period_to ?? "" };
  const facts = intakeFacts(candidate, {
    entries: [...intake.entries, ...ctx.run.addedEntries], lockedThrough: intake.lockedThrough, today, ...(month ? { targetMonth: month } : {}),
  });

  const declaration = intake.declarations.find((item) => item.month === facts.targetMonth);
  const monthState = declaration ? (declaration.status === "open" ? "open" : "locked") : intake.lockedThrough && facts.targetMonth <= intake.lockedThrough ? "locked" : "missing";
  const matches = facts.duplicates.matches.map((match) => ({
    level: match.level, month: match.month, status: match.status === "open" ? "open" : "locked", position: match.position + 1,
    // A row is told apart by its month and its number in the table: two rows can share one documentId (the groups of one invoice).
    ...(match.documentId ? { row: ctx.handles.create("R", `${clientValue.clientId}|${match.month}|${match.position + 1}`, { clientId: clientValue.clientId, month: match.month, documentId: match.documentId, position: match.position + 1 }) } : {}),
  }));
  const review = pcnReview([row], { pcnRequired: profile.pcnRequired })[0];
  const pcn = review.applies ? { applies: true, threshold: review.threshold, over: review.over, allocation_missing: review.missingAllocation } : { applies: false };
  const homeUtility = !record.booked && profile.kind === "home" && isHomeUtility({ texts: [record.purpose, record.document_title] });
  // A document the client issued names the client's customer as the buyer, which is no mismatch.
  const issuedByClient = Boolean(digits(profile.vatId) && digits(record.supplier_vat_id) === digits(profile.vatId));
  const buyerMismatch = !issuedByClient
    && Boolean(record.buyer_vat_id && digits(profile.vatId) && digits(record.buyer_vat_id) !== digits(profile.vatId));

  const reasons = new Set(record.issues);
  if (facts.exclude === "previous-year") reasons.add("previous_year");
  if (facts.exclude === "duplicate") reasons.add("duplicate");
  if (facts.duplicates.level === "possible") reasons.add("possible_duplicate");
  if (facts.year.status === "future-year") reasons.add("future_year");
  if (facts.year.status === "no-date") reasons.add("no_date");
  if (facts.deduction === "check") reasons.add("deduction_check");
  if (facts.deduction === "late") reasons.add("deduction_late");
  // A document dated after the month it goes into: its VAT cannot be deducted before its date (owner, 2 November 2026).
  // In a two-month period both months are reported together, so a document of the second month in the first is in its own period too.
  if (facts.docMonth && facts.docMonth > facts.targetMonth && !sameVatPeriod(profile.vatPeriod, facts.docMonth, facts.targetMonth)) reasons.add("doc_after_month");
  // A document of an earlier month goes into the open month, marked: the earlier month is filed and paid (owner, 6 November 2026).
  // A document for a period is judged by its period, and a previous year has its own reason.
  // A client who reports VAT for two months files both months together: a document of the first month in the second one is in
  // its own period, as in Anna's journals (July's rows in the journal of August). Not marked (7 November 2026).
  const samePeriod = sameVatPeriod(profile.vatPeriod, facts.docMonth, facts.targetMonth);
  const earlier = facts.docMonth && facts.docMonth < facts.targetMonth && facts.exclude !== "previous-year" && !samePeriod;
  if (earlier && !isPeriodDocument(record.period_from, record.period_to)) reasons.add("doc_before_month");
  if (buyerMismatch) reasons.add("buyer_mismatch");
  if (pcn.over) reasons.add("pcn_over");
  if (pcn.allocation_missing) reasons.add("pcn_allocation_missing");
  if (monthState === "locked") reasons.add("month_locked");
  if (record.confidence < LOW_CONFIDENCE) reasons.add("low_confidence");
  if (record.kind !== "expense_invoice") reasons.add(`kind_${record.kind}`);

  const output = {
    fact: args.fact, target_month: facts.targetMonth, doc_month: facts.docMonth, month_reason: !args.month && ctx.scope ? "open_month" : facts.monthReason, month_state: monthState,
    year: { status: facts.year.status, basis: facts.year.basis, year: facts.year.year, allowed_year: facts.year.allowedYear },
    duplicates: { level: facts.duplicates.level, matches }, deduction: facts.deduction, exclude: facts.exclude, pcn,
    home_utility: homeUtility, buyer_mismatch: buyerMismatch, amounts: { reconcile: !record.issues.includes("amounts_mismatch") },
    suggested_status: reasons.size ? "review" : "ready", reasons: [...reasons].sort(),
  };
  return { output, facts: { ...facts, reasons: output.reasons }, record, entry, profile, clientValue, intake };
}
