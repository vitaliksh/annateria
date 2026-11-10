// The representative exchange rate ("שער יציג") of the Bank of Israel for a currency on a day, for the app to put a foreign-currency
// document into shekels (the bookkeeper's rule, 8 November 2026: the rate of the day of payment). Only a currency code and a date go
// out; nothing of a client. The Bank's own series database, as its guide describes it (boi.org.il, "שליפת שערי חליפין יציגים ממאגר
// הסדרות החדש", checked 10 November 2026). It answers requests with no Origin only, so the Worker asks it, not the page.
const SERIES = "https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0";
const LOOK_BACK_DAYS = 10; // a weekend or a holiday has no rate: the last one before it counts

export class RateError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // invalid | not-found | unavailable
  }
}

// One line of CSV: a quoted cell may hold commas (the COMMENTS column of the Bank is free text).
const cellsOf = (line) => [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)].map((match) => match[1].replace(/^"|"$/g, "").replaceAll('""', '"')).slice(0, -1);
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

// Resolves with { currency, date, rate }: the rate published on `date`, or the last one before it.
export async function representativeRate({ currency, date, fetchImpl = fetch }) {
  const code = String(currency ?? "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(code) || code === "ILS") throw new RateError("invalid", "The currency must be a three-letter code other than ILS.");
  if (!isDate(date)) throw new RateError("invalid", "The date must be YYYY-MM-DD.");
  const from = new Date(Date.parse(`${date}T00:00:00Z`) - LOOK_BACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const url = `${SERIES}/RER_${code}_ILS?c%5BTIME_PERIOD%5D=ge:${from}%2Ble:${date}&format=csv`;
  let response;
  try {
    response = await fetchImpl(url, { headers: { accept: "text/csv" } });
  } catch {
    throw new RateError("unavailable", "The Bank of Israel did not answer.");
  }
  if (!response.ok) throw new RateError(response.status === 404 ? "not-found" : "unavailable", `The Bank of Israel answered ${response.status}.`);
  const lines = (await response.text()).trim().split(/\r?\n/);
  const head = cellsOf(lines.shift() ?? "");
  const [at, value] = [head.indexOf("TIME_PERIOD"), head.indexOf("OBS_VALUE")];
  if (at < 0 || value < 0) throw new RateError("unavailable", "The answer of the Bank of Israel has no rates.");
  const rates = lines.map(cellsOf).map((cells) => ({ date: cells[at], rate: Number(cells[value]) }))
    .filter((item) => isDate(item.date) && item.date <= date && item.rate > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const found = rates.at(-1);
  if (!found) throw new RateError("not-found", `No rate of ${code} up to ${date}.`);
  return { currency: code, date: found.date, rate: found.rate };
}
