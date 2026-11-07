// Expenses of a business run from home that are recognised at 25%: electricity, water, sewage and property tax
// (Anna's list of 12 October 2026). The rule follows what the document is, not a Rivhit code number, because the
// codes differ from client to client. Pure; no DOM.

const KEYWORDS = ["חשמל", "מים", "ביוב", "ארנונה"];
// The old rule by built-in account names: "מסים ואגרות" held the property tax. Kept so that nothing recognised before changes.
const LEGACY_ACCOUNTS = ["מסים ואגרות"];

const HEBREW = "\\u05d0-\\u05ea";
const wordPatterns = KEYWORDS.map((word) => new RegExp(`(^|[^${HEBREW}])[והבלמכש]?${word}($|[^${HEBREW}])`));
// Goods named after electricity are no bill for it: "מוצרי חשמל" of a computer shop got 25% (M4 exam, 7 November 2026).
const GOODS = /(מוצרי|מוצר|כלי|מכשירי|מכשיר|ציוד|חנות|אביזרי)\s+חשמל/g;
const hasKeyword = (text) => {
  const plain = String(text ?? "").replace(GOODS, " ");
  return wordPatterns.some((pattern) => pattern.test(plain));
};

// accountName: the name of the chosen account in the chart of the client. texts: the purpose and the title of the
// document (not the supplier: "…חשמל בע״מ" may sell electrical goods).
export function isHomeUtility({ accountName = "", texts = [] } = {}) {
  const name = String(accountName ?? "").trim();
  return LEGACY_ACCOUNTS.includes(name) || hasKeyword(name) || texts.some(hasKeyword);
}

// VAT of a vehicle (fuel, upkeep, road and parking, also on an account of its own: Anna books parking at two thirds) and of a mobile phone is deducted at two thirds (VAT Regulations,
// reg. 18(b)(2); Anna, 21 October 2026). The built-in codes 806, 807 and 812 had it; a client's own chart has other codes, so the name
// of the account decides as well, as for the 25% above (M4 exam, 7 November 2026: fuel, a car wash and a mobile bill of client B were
// "ready" with the whole VAT). A vehicle licence or insurance has no VAT, so the share changes nothing there.
const LIMITED_VAT_CODES = ["806", "807", "812"];
const LIMITED_VAT_WORDS = ["רכב", "דלק", "סלולר", "סלולרי", "נייד", "חניה", "חנייה"];
const limitedPatterns = LIMITED_VAT_WORDS.map((word) => new RegExp(`(^|[^${HEBREW}])[והבלמכש]?${word}($|[^${HEBREW}])`));

export function isLimitedVat({ account = "", accountName = "" } = {}) {
  if (LIMITED_VAT_CODES.includes(String(account))) return true;
  const name = String(accountName ?? "");
  return limitedPatterns.some((pattern) => pattern.test(name));
}
