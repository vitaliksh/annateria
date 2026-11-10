// A document in a foreign currency is put into shekels by the code, at the representative rate of the Bank of Israel of the day of the
// document (the bookkeeper's rule, 8 November 2026: the rate of the day of payment; the owner, 10 November 2026: the agent does it, not
// the bookkeeper by hand). The Worker asks the Bank (worker/src/rate.js); only the currency and the date go out. The original amounts
// stay on the record and on the row, and the row says which rate was used (row-builder.js, foreignText).

export class RateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RateError";
    this.code = code; // login | network | not-found | unavailable
  }
}

// rate(currency, date) -> { currency, date, rate }; one call per currency and day for the life of the page.
export function createRatesClient({ api, access, fetchImpl = (...args) => fetch(...args) }) {
  const known = new Map();
  async function ask(currency, date) {
    const auth = access.authHeaders();
    if (!api) throw new RateError("unavailable", "No server.");
    if (!auth) throw new RateError("login", "Login required.");
    let response;
    try {
      response = await fetchImpl(`${api}/v1/rate?currency=${encodeURIComponent(currency)}&date=${encodeURIComponent(date)}`, { headers: auth });
    } catch {
      throw new RateError("network", "The server did not answer.");
    }
    const body = await response.json().catch(() => null);
    if (response.ok && Number(body?.rate) > 0) return { currency: body.currency, date: body.date, rate: Number(body.rate) };
    throw new RateError(response.status === 401 ? "login" : response.status === 404 ? "not-found" : "unavailable", body?.error ?? `HTTP ${response.status}`);
  }
  return {
    rate(currency, date) {
      const key = `${currency}|${date}`;
      if (!known.has(key)) known.set(key, ask(currency, date).catch((error) => { known.delete(key); throw error; }));
      return known.get(key);
    },
  };
}

const cents = (value) => Math.round(value * 100) / 100;

// record: a frozen fact record (agent/fact-record.js). Resolves with the record in shekels and `foreign` set to what the document says,
// or with the record as it was (still marked foreign_currency, for the user to convert) when there is no date or no rate.
export async function inShekels(record, rates) {
  if (!record || record.currency === "ILS" || !record.date || !rates) return record;
  let found;
  try {
    found = await rates.rate(record.currency, record.date);
  } catch {
    return record;
  }
  const total = cents(record.total * found.rate);
  const vat = cents(record.vat * found.rate);
  const foreign = { currency: record.currency, net: record.net, vat: record.vat, total: record.total, rate: found.rate, rate_date: found.date };
  return Object.freeze({
    ...record, currency: "ILS", net: cents(total - vat), vat, total, foreign: Object.freeze(foreign),
    issues: Object.freeze(record.issues.filter((issue) => issue !== "foreign_currency")),
  });
}
