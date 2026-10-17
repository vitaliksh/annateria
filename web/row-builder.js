// Builds a row of the monthly table (the draft-table format) from a fact that the agent extracted and the decision it made, without
// the page: the same row that the table shows after recognition, so that it can be put into the open table through restoreRow or
// written straight into the draft file of a month that is not open. Pure; the page and the files are the caller's.
// Rules (docs/AGENT_TOOLS.md, 5.3): the values of the document are copied from the fact; the recognition percentages come from the
// business rule (25% of a home for electricity, water, sewage and property tax; 66.67% VAT for the mobile phone codes); a duplicate or
// a document of a previous year is an inactive row with its reason; a row is "ready" only when the code and the model agree that
// nothing needs a look.
import { dateKey } from "./intake-facts.js";
import { isHomeUtility } from "./home-utilities.js";
import { formatMonth } from "./month-format.js";
import { recognisedAmounts } from "./row-calculations.js";

export const READY_CONFIDENCE = 80;
const LIMITED_VAT_CODES = ["806", "807", "812"];

// What a code reason of facts_for says in Hebrew, for the opinion column of the row.
export const REASON_TEXT = {
  amounts_mismatch: "הסכומים אינם מסתכמים",
  bad_vat_id: "ספרת הביקורת של ע.מ. הספק אינה תקינה",
  no_date: "אין תאריך קריא",
  foreign_currency: "מטבע זר",
  buyer_mismatch: "המסמך מיועד לקונה אחר",
  duplicate: "כפילות",
  possible_duplicate: "חשד לכפילות",
  previous_year: "מסמך משנה קודמת",
  future_year: "מסמך משנה עתידית",
  deduction_check: "חלפו 6 חודשים מתאריך המסמך — לבדוק את ניכוי המע״מ",
  deduction_late: "חלפו יותר מ‑6 חודשים מתאריך המסמך — לבדוק את ניכוי המע״מ מול רואה החשבון",
  pcn_over: "חשבונית מעל תקרת מספר הקצאה — נדרש אישור",
  pcn_allocation_missing: "חסר מספר הקצאה",
  month_locked: "החודש שנבחר נעול",
  low_confidence: "ביטחון נמוך בקריאה",
  date_unclear: "התאריך אינו ברור",
  amount_unclear: "הסכום אינו ברור",
  blurred: "המסמך מטושטש",
  cropped: "המסמך חתוך",
  handwritten: "כתב יד",
  other_language: "המסמך בשפה אחרת",
  kind_payment_confirmation: "אישור תשלום ולא חשבונית",
  kind_income_report: "דוח הכנסות",
  kind_other: "סוג מסמך לא ברור",
};

export const displayDate = (iso) => {
  const key = dateKey(iso);
  return key ? `${key.slice(8)}/${key.slice(5, 7)}/${key.slice(2, 4)}` : "";
};
// The table shows the last four digits of a reference; the full one is kept in `reference`.
const displayedReference = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? digits.slice(-4) : String(value ?? "").trim();
};

// The line shown for a row that the code itself excluded (a duplicate or a document of a previous year).
export function excludeText(facts, month) {
  if (facts.exclude === "previous-year") return `מסמך משנה קודמת (${facts.year.year ?? "?"}) — לבדוק את התאריך; אפשר לכלול ידנית`;
  const match = facts.duplicates.matches[0];
  if (!match) return "כפילות — המסמך כבר הוזן";
  if (match.month === month) return `כפילות של שורה ${match.position + 1} בהצהרה זו`;
  return `כפילות — המסמך כבר הוזן ב‑${formatMonth(match.month)}${match.status === "open" ? "" : " (הצהרה נעולה)"}`;
}

// The percentages of the business rule (the same as applyBusinessRule of the page) and the amounts they give.
export function recognition({ record, account, kind, accountName = "" }) {
  const homeUtility = kind === "home" && isHomeUtility({ accountName, texts: [record.purpose, record.document_title] });
  const expensePercent = homeUtility ? 25 : 100;
  const vatPercent = record.vat ? (homeUtility ? 25 : LIMITED_VAT_CODES.includes(account) ? 66.67 : 100) : 100;
  return { expensePercent, vatPercent, amounts: recognisedAmounts(record.net, record.vat, expensePercent, vatPercent) };
}

// record: the fact record (agent/fact-record.js). entry: the inbox entry of the file. decision: "expense" | "not_expense" | "unclear".
// account: a valid code of the client chart, or null. facts: what facts_for computed (target month, exclude, year, duplicates, reasons,
// deduction). kind: "home" | "office". documentId: the id that all the rows of one page of one file share. agent: { run, version, ... }.
export function buildRowSnapshot({ record, entry, documentId, decision, account, accountName = "", facts, kind, month, reason, needsReview, agent }) {
  const expense = decision === "expense";
  const coded = expense && Boolean(account);
  const excluded = Boolean(facts.exclude);
  const { expensePercent, vatPercent, amounts } = recognition({ record, account, kind, accountName });
  const warned = facts.reasons.length > 0 || record.confidence < READY_CONFIDENCE;
  const ready = coded && !needsReview && !warned && !excluded;

  let statusText = "מוכן לייצוא";
  if (excluded) statusText = excludeText(facts, month);
  else if (decision === "not_expense") statusText = "לא הוצאה — נדרש אישור";
  else if (decision === "unclear") statusText = "נדרש עיון";
  else if (!account) statusText = "נדרש קוד מיון";
  else if (!ready) statusText = "נדרש עיון";

  const notes = facts.reasons.map((code) => REASON_TEXT[code]).filter(Boolean);
  const opinion = [String(reason ?? "").trim() || "לא נמסר הסבר מהסוכן.", ...(notes.length ? [`לבדיקה: ${notes.join(", ")}`] : [])].join(" · ");

  return {
    documentId,
    imageIndex: 0,
    imageFile: "",
    receivedAt: entry.addedAt,
    values: [
      displayDate(record.date), coded ? account : "", record.purpose ?? "", record.supplier_name ?? "", record.supplier_vat_id ?? "",
      displayedReference(record.document_number), record.allocation_number ?? "", amounts.gross, amounts.net, amounts.vat,
      String(vatPercent), String(expensePercent),
    ],
    rawNet: String(record.net),
    rawVat: String(record.vat),
    vatPercent: String(record.vat_percent),
    form6111Code: "",
    documentKind: record.kind,
    reference: record.document_number ?? "",
    documentTitle: record.document_title ?? "",
    periodFrom: record.period_from ?? "",
    periodTo: record.period_to ?? "",
    processing: "",
    autoExclude: facts.exclude ?? "",
    wouldInclude: coded ? "true" : "",
    pcnApproved: "",
    highlights: [],
    active: coded && !excluded,
    agentOpinion: opinion,
    confidence: `${record.confidence}%`,
    statusText,
    statusClass: ready ? "ready" : "review",
    agent: { ...agent, file: entry.hash, page: record.page, reasons: [...facts.reasons] },
  };
}
