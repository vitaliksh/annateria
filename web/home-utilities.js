// Expenses of a business run from home that are recognised at 25%: electricity, water, sewage and property tax
// (Anna's list of 12 October 2026). The rule follows what the document is, not a Rivhit code number, because the
// codes differ from client to client. Pure; no DOM.

const KEYWORDS = ["חשמל", "מים", "ביוב", "ארנונה"];
// The old rule by built-in account names: "מסים ואגרות" held the property tax. Kept so that nothing recognised before changes.
const LEGACY_ACCOUNTS = ["מסים ואגרות"];

const HEBREW = "\\u05d0-\\u05ea";
const wordPatterns = KEYWORDS.map((word) => new RegExp(`(^|[^${HEBREW}])[והבלמכש]?${word}($|[^${HEBREW}])`));
const hasKeyword = (text) => wordPatterns.some((pattern) => pattern.test(String(text ?? "")));

// accountName: the name of the chosen account in the chart of the client. texts: the purpose and the title of the
// document (not the supplier: "…חשמל בע״מ" may sell electrical goods).
export function isHomeUtility({ accountName = "", texts = [] } = {}) {
  const name = String(accountName ?? "").trim();
  return LEGACY_ACCOUNTS.includes(name) || hasKeyword(name) || texts.some(hasKeyword);
}
