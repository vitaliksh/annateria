// The bookkeeper agent (text only, no images): decides for rows that OCR has already read whether they are expense
// documents and which account of the client they belong to. Pure helpers; the route and the Gemini call are in index.js.
// It never changes what OCR read and never touches recognition percentages (the browser computes them).

export const MAX_ROWS = 80;
const MAX_CHART = 200;
const MAX_BODY_CHARS = 250_000;
const DECISIONS = ["expense", "not_expense", "unclear"];

export const BOOKKEEPER_SCHEMA = {
  type: "OBJECT",
  properties: {
    results: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          n: { type: "INTEGER" },
          decision: { type: "STRING", enum: DECISIONS },
          rivhit_code: { type: "STRING", nullable: true },
          needs_review: { type: "BOOLEAN" },
          reason: { type: "STRING" },
        },
        required: ["n", "decision", "rivhit_code", "needs_review", "reason"],
      },
    },
  },
  required: ["results"],
};

const clean = (value, limit = 300) =>
  typeof value === "string" ? value.replace(/[\t\r\n]+/g, " ").trim().slice(0, limit) : "";
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);

// The one-line description of a software fact, or null when there is nothing to say.
function factsOf(raw) {
  const facts = {};
  if (["previous-year", "future-year", "no-date"].includes(raw?.year)) facts.year = raw.year;
  if (["strong", "likely", "possible"].includes(raw?.duplicate)) facts.duplicate = raw.duplicate;
  if (["previous-year", "duplicate"].includes(raw?.exclude)) facts.exclude = raw.exclude;
  if (["check", "late"].includes(raw?.deduction)) facts.deduction = raw.deduction;
  return Object.keys(facts).length ? facts : null;
}

// Returns { error } or { value } with the input cut to safe sizes.
export function parseBookkeeperInput(input) {
  if (!input || typeof input !== "object" || !Array.isArray(input.rows) || !input.rows.length)
    return { error: "Rows are required." };
  if (input.rows.length > MAX_ROWS) return { error: `At most ${MAX_ROWS} rows per request.` };
  if (JSON.stringify(input).length > MAX_BODY_CHARS) return { error: "The request is too large." };
  const chart = [];
  for (const account of Array.isArray(input.chart) ? input.chart.slice(0, MAX_CHART) : []) {
    const code = clean(account?.code, 3);
    const name = clean(account?.name, 120);
    if (/^\d{3}$/.test(code) && name && account.type !== "income") {
      const type = ["expense", "outsideVatBase", "equipment"].includes(account.type) ? account.type : "expense";
      chart.push({ code, name, type });
    }
  }
  const rows = input.rows.map((row, index) => ({
    n: Number.isInteger(row?.n) ? row.n : index + 1,
    document_kind: clean(row?.document_kind, 30),
    document_title: clean(row?.document_title, 120),
    date: clean(row?.date, 12),
    supplier_name: clean(row?.supplier_name, 120),
    supplier_vat_id: clean(row?.supplier_vat_id, 20),
    reference: clean(row?.reference, 40),
    purpose: clean(row?.purpose, 160),
    total: finite(row?.total),
    net: finite(row?.net),
    vat: finite(row?.vat),
    period_from: clean(row?.period_from, 10),
    period_to: clean(row?.period_to, 10),
    ocr_code: clean(row?.ocr_code, 3),
    facts: factsOf(row?.facts),
  }));
  if (new Set(rows.map((row) => row.n)).size !== rows.length) return { error: "Row numbers must be unique." };
  return {
    value: {
      client: { activity: clean(input.client?.activity, 500), kind: input.client?.kind === "home" ? "home" : "office" },
      declarationMonth: /^\d{4}-\d{2}$/.test(input.declarationMonth ?? "") ? input.declarationMonth : "",
      chart,
      rows,
    },
  };
}

// codes: { code → name } the agent may return. The client's own chart wins; without one the built-in map is used.
export function allowedCodes(chart, mapping, customCodes) {
  if (chart.length) return Object.fromEntries(chart.map((account) => [account.code, account.name]));
  const codes = {};
  for (const [code, name] of Object.values(mapping)) codes[code] = name;
  return { ...codes, ...customCodes };
}

export function bookkeeperPrompt(value, codes, hasChart) {
  const accounts = Object.entries(codes).map(([code, name]) => {
    const type = value.chart.find((account) => account.code === code)?.type;
    return `- ${code} ${name}${type && type !== "expense" ? ` (${type})` : ""}`;
  });
  return `You are the bookkeeper agent of an Israeli bookkeeping office. OCR has already read the client's documents. You receive the rows as JSON (user message), facts that software computed for some rows, and the accounts of the client. For EVERY row n return one result: decision, rivhit_code, needs_review and a short Hebrew reason.

Client activity: ${value.client.activity || "(not given)"}. Declaration month: ${value.declarationMonth || "(not given)"}.

BOUNDARIES: Never change or reinterpret what OCR read (date, supplier, supplier ID, references, amounts, currency). Never decide recognition percentages; software does. The software facts in "facts" are final: if facts.exclude is set, the row is excluded by software (a duplicate of a document already entered, or a document of a previous year); do not argue, and mention that in the reason.

DECISION:
- expense: a document that proves a purchase of the business: a tax invoice, a tax invoice-receipt, a receipt, a utility bill (electricity, water, telephone, internet), a fuel receipt. ALSO an insurance policy, a policy renewal or an insurer's letter about a payment (for example “אישור תשלום לפוליסה”, “חידוש לביטוח”): these are valid expense documents even though they are not invoices (rule of the owner, confirmed).
- not_expense: a document that confirms a payment that is not a purchase of the business: a payment of VAT, income-tax advances or other taxes to the tax authority, a National Insurance (ביטוח לאומי) payment. This rule is common practice and NOT yet confirmed by the bookkeeper, so always set needs_review true for it and say so.
- unclear: anything else you cannot place with confidence (a licence fee, a fine, a donation, a personal-looking purchase, an unreadable row). Set needs_review true.
Judge by the facts and the title of the document, not by document_kind alone: OCR sometimes labels an insurance policy as an invoice and the other way round.

CLASSIFICATION (expense only; for not_expense and unclear return null): choose the one account below whose name best fits the supplier and what was bought${hasChart ? ". These are the client's OWN accounts; return only a code from this list and prefer it over any general knowledge of Form 6111" : ""}. A business insurance goes to the business-insurance account; a vehicle policy (vehicle, motor, licence-and-insurance wording) to the vehicle account that mentions insurance; fuel to the fuel account; electricity, water, telephone and so on to the account of that name. An account marked outsideVatBase or equipment is valid when it fits. Never invent a code. ocr_code is the first guess of OCR: keep it only when it is in the list and fits, otherwise change it. Choose the account even for a row that software excluded, so that the code is right if the user includes it. If the best account is only a loose fit (the client has no account of that kind, for example internet or software charged to a general maintenance account), return it but set needs_review true and say so in the reason. If no account fits at all, return null and set needs_review true.

REASON: one short Hebrew sentence: what the document is, the decision and the account name; add the software fact (duplicate, previous year, late VAT deduction) when there is one.

ACCOUNTS (the only codes you may return):
${accounts.join("\n") || "(none)"}`;
}

// raw: the parsed Gemini answer. Every input row gets exactly one result; codes outside the allowed list are dropped.
export function normalizeBookkeeperAnswer(raw, rows, codes) {
  const answers = new Map();
  for (const item of Array.isArray(raw?.results) ? raw.results : []) {
    if (Number.isInteger(item?.n) && !answers.has(item.n)) answers.set(item.n, item);
  }
  return rows.map((row) => {
    const item = answers.get(row.n);
    if (!item) {
      return { n: row.n, decision: "unclear", rivhit_code: null, needs_review: true, reason: "הסוכן לא החזיר תשובה לשורה זו." };
    }
    const decision = DECISIONS.includes(item.decision) ? item.decision : "unclear";
    const known = typeof item.rivhit_code === "string" && codes[item.rivhit_code];
    const code = decision === "expense" && known ? item.rivhit_code : null;
    const needsReview = decision !== "expense" || !code || item.needs_review !== false;
    const reason = clean(item.reason) || "לא נמסר הסבר מהסוכן.";
    return { n: row.n, decision, rivhit_code: code, needs_review: needsReview, reason };
  });
}
