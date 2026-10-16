// facts_for (docs/AGENT_TOOLS.md, 5.1): everything the code knows about one fact in the context of one client. This is the only
// place where the rules of the bookkeeper are computed: the month, the year gate, duplicates, the VAT deduction window, the
// ceiling for an allocation number, the 25% of a home. The model never supplies a number here.
import { ToolError } from "../errors.js";
import { intakeFacts } from "../../intake-facts.js";
import { isHomeUtility } from "../../home-utilities.js";
import { pcnReview } from "../../pcn-review.js";

const LOW_CONFIDENCE = 80;
const digits = (value) => String(value ?? "").replace(/\D/g, "").replace(/^0+/, "");

// The fact as a row in the draft-table format, which is what the intake rules read.
function candidateRow(record, entry, handle) {
  return {
    documentId: `fact:${handle}`, receivedAt: entry.addedAt, documentKind: record.kind, active: true,
    values: [record.date ?? "", "", record.purpose ?? "", record.supplier_name ?? "", record.supplier_vat_id ?? "", record.document_number ?? "", record.allocation_number ?? "", String(record.total), String(record.net), String(record.vat)],
    rawNet: record.net, rawVat: record.vat, reference: record.document_number ?? "",
  };
}

export default {
  name: "facts_for",
  description: "What the code knows about one extracted fact for one client: the month it belongs to, the year check, duplicates among all declarations and this run, the VAT deduction window, the allocation-number ceiling for PCN clients, the 25% rule for home clients, whether it is addressed to this client, and the reasons a row would need a look. Give month only when the user asked for a month.",
  schema: {
    type: "object",
    required: ["fact", "client"],
    properties: {
      fact: { type: "string", maxLength: 12, description: "Fact handle, for example F1.1." },
      client: { type: "string", maxLength: 12, description: "Client handle." },
      month: { type: "string", maxLength: 7, description: "YYYY-MM, only when the user asked for this month." },
    },
  },
  async run(args, ctx) {
    const { entry, record } = ctx.handles.getFact(args.fact);
    const client = ctx.handles.get("C", args.client);
    if (args.month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(args.month)) throw new ToolError("invalid_argument", "month must look like 2026-03.");
    const [profile, intake] = await Promise.all([ctx.services.clients.profile(client.clientId), ctx.services.intake.context(client.clientId)]);
    const today = ctx.today();
    const row = candidateRow(record, entry, args.fact);
    const candidate = { row, month: args.month ?? today.toISOString().slice(0, 7), position: Number.MAX_SAFE_INTEGER, periodFrom: record.period_from ?? "", periodTo: record.period_to ?? "" };
    const facts = intakeFacts(candidate, {
      entries: [...intake.entries, ...ctx.run.addedEntries], lockedThrough: intake.lockedThrough, today, ...(args.month ? { targetMonth: args.month } : {}),
    });

    const declaration = intake.declarations.find((item) => item.month === facts.targetMonth);
    const monthState = declaration ? (declaration.status === "open" ? "open" : "locked") : intake.lockedThrough && facts.targetMonth <= intake.lockedThrough ? "locked" : "missing";
    const matches = facts.duplicates.matches.map((match) => ({
      level: match.level, month: match.month, status: match.status === "open" ? "open" : "locked", position: match.position + 1,
      ...(match.documentId ? { row: ctx.handles.create("R", `${client.clientId}|${match.documentId}`, { clientId: client.clientId, month: match.month, documentId: match.documentId }) } : {}),
    }));
    const review = pcnReview([row], { pcnRequired: profile.pcnRequired })[0];
    const pcn = review.applies ? { applies: true, threshold: review.threshold, over: review.over, allocation_missing: review.missingAllocation } : { applies: false };
    const homeUtility = profile.kind === "home" && isHomeUtility({ texts: [record.purpose, record.document_title] });
    const buyerMismatch = Boolean(record.buyer_vat_id && digits(profile.vatId) && digits(record.buyer_vat_id) !== digits(profile.vatId));

    const reasons = new Set(record.issues);
    if (facts.exclude === "previous-year") reasons.add("previous_year");
    if (facts.exclude === "duplicate") reasons.add("duplicate");
    if (facts.duplicates.level === "possible") reasons.add("possible_duplicate");
    if (facts.year.status === "future-year") reasons.add("future_year");
    if (facts.year.status === "no-date") reasons.add("no_date");
    if (facts.deduction === "check") reasons.add("deduction_check");
    if (facts.deduction === "late") reasons.add("deduction_late");
    if (buyerMismatch) reasons.add("buyer_mismatch");
    if (pcn.over) reasons.add("pcn_over");
    if (pcn.allocation_missing) reasons.add("pcn_allocation_missing");
    if (monthState === "locked") reasons.add("month_locked");
    if (record.confidence < LOW_CONFIDENCE) reasons.add("low_confidence");
    if (record.kind !== "expense_invoice") reasons.add(`kind_${record.kind}`);

    return {
      fact: args.fact, target_month: facts.targetMonth, doc_month: facts.docMonth, month_reason: facts.monthReason, month_state: monthState,
      year: { status: facts.year.status, basis: facts.year.basis, year: facts.year.year, allowed_year: facts.year.allowedYear },
      duplicates: { level: facts.duplicates.level, matches }, deduction: facts.deduction, exclude: facts.exclude, pcn,
      home_utility: homeUtility, buyer_mismatch: buyerMismatch, amounts: { reconcile: !record.issues.includes("amounts_mismatch") },
      suggested_status: reasons.size ? "review" : "ready", reasons: [...reasons].sort(),
    };
  },
};
