import test from "node:test";
import assert from "node:assert/strict";
import { createRatesClient, inShekels, RateError } from "../currency.js";
import { loadDeclaration } from "../declaration-store.js";
import { normalizeRecord } from "../agent/fact-record.js";
import { foreignText } from "../row-builder.js";
import { rawRecord, scriptedExtraction, toolContext } from "./agent-fixtures.mjs";

const access = (token = "t1") => ({ authHeaders: () => (token ? { Authorization: `Bearer ${token}` } : null) });
const bank = (rate = 3.112, date = "2026-10-23") => ({
  asked: [],
  async rate(currency, day) {
    this.asked.push([currency, day]);
    return { currency, date, rate };
  },
});
const zoom = (overrides = {}) => normalizeRecord(rawRecord({
  date: "2026-10-25", supplier_name: "Zoom", supplier_vat_id: null, document_number: "INV-77", currency: "usd", net: 16.99, vat: 0, total: 16.99,
  vat_percent: 0, purpose: "subscription", buyer_vat_id: null, ...overrides,
}));

test("the rates client asks the Worker once per currency and day, with the token, and names what went wrong", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ currency: "USD", date: "2026-10-23", rate: 3.112 }), { status: 200 });
  };
  const rates = createRatesClient({ api: "https://worker.test", access: access(), fetchImpl });
  assert.deepEqual(await rates.rate("USD", "2026-10-25"), { currency: "USD", date: "2026-10-23", rate: 3.112 });
  await rates.rate("USD", "2026-10-25");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://worker.test/v1/rate?currency=USD&date=2026-10-25");
  assert.equal(calls[0].init.headers.Authorization, "Bearer t1");

  const failing = (status) => createRatesClient({ api: "https://worker.test", access: access(), fetchImpl: async () => new Response("{}", { status }) });
  const code = (promise) => promise.then(() => "resolved", (error) => (error instanceof RateError ? error.code : error.message));
  assert.equal(await code(failing(404).rate("XYZ", "2026-10-25")), "not-found");
  assert.equal(await code(failing(401).rate("USD", "2026-10-25")), "login");
  assert.equal(await code(failing(502).rate("USD", "2026-10-25")), "unavailable");
  const down = createRatesClient({ api: "https://worker.test", access: access(), fetchImpl: async () => { throw new TypeError("offline"); } });
  assert.equal(await code(down.rate("USD", "2026-10-25")), "network");
  assert.equal(await code(createRatesClient({ api: "https://worker.test", access: access(null), fetchImpl }).rate("USD", "2026-10-25")), "login");
  // A failure is not remembered: the next try asks again.
  let tries = 0;
  const flaky = createRatesClient({ api: "https://worker.test", access: access(), fetchImpl: async () => (tries++ ? new Response(JSON.stringify({ currency: "USD", date: "2026-10-23", rate: 3.1 })) : new Response("{}", { status: 502 })) });
  assert.equal(await code(flaky.rate("USD", "2026-10-25")), "unavailable");
  assert.equal((await flaky.rate("USD", "2026-10-25")).rate, 3.1);
});

test("a foreign document is put into shekels at the rate of its day; the original stays on the record", async () => {
  const rates = bank();
  const record = await inShekels(zoom(), rates);
  assert.deepEqual(rates.asked, [["USD", "2026-10-25"]]);
  assert.deepEqual([record.currency, record.total, record.net, record.vat], ["ILS", 52.87, 52.87, 0]);
  assert.deepEqual(record.foreign, { currency: "USD", net: 16.99, vat: 0, total: 16.99, rate: 3.112, rate_date: "2026-10-23" });
  assert.equal(record.issues.includes("foreign_currency"), false);
  assert.equal(Object.isFrozen(record), true);
  assert.equal(foreignText(record.foreign), "הומר לשקלים: 16.99 USD לפי השער היציג 3.112 מיום 23/10/26");
  // VAT is converted on its own and the net is what is left, so the three amounts still add up.
  const taxed = await inShekels(zoom({ net: 100, vat: 18, total: 118 }), bank(3.3333));
  assert.deepEqual([taxed.total, taxed.vat, taxed.net], [393.33, 60, 333.33]);
});

test("a shekel document, one without a date and one without a rate stay as they are; the last two are still marked", async () => {
  const shekels = normalizeRecord(rawRecord());
  assert.equal(await inShekels(shekels, bank()), shekels);
  const undated = zoom({ date: null });
  assert.equal(await inShekels(undated, bank()), undated);
  const noRate = { rate: async () => { throw new RateError("network", "offline"); } };
  const kept = await inShekels(zoom(), noRate);
  assert.deepEqual([kept.currency, kept.total, kept.issues.includes("foreign_currency")], ["USD", 16.99, true]);
  assert.equal(await inShekels(zoom(), null).then((item) => item.currency), "USD");
});

test("extract_document gives the agent the document in shekels, and the row says what it was and at which rate", async () => {
  const rates = bank();
  const tools = await toolContext({ extraction: scriptedExtraction([{ records: [rawRecord({ ...zoom(), currency: "USD", issues: [] })] }]), rates });
  const handles = await tools.files();
  const read = await tools.dispatch("extract_document", { file: handles["photo.jpg"] });
  assert.deepEqual([read.documents[0].currency, read.documents[0].total, read.documents[0].foreign.total], ["ILS", 52.87, 16.99]);
  const levi = await tools.client("Levi");
  const result = await tools.dispatch("add_rows", {
    client: levi, rows: [{ fact: read.documents[0].fact, decision: "expense", account: "202", needs_review: false, reason: "מנוי תוכנה" }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows[0].reasons.includes("foreign_currency"), false);
  const row = (await loadDeclaration(tools.w.levi.directory, "2026-02")).draft.rows.at(-1);
  assert.deepEqual(row.values.slice(7, 10), ["52.87", "52.87", "0.00"]);
  assert.equal(row.foreign.rate, 3.112);
  assert.match(row.agentOpinion, /^מנוי תוכנה · הומר לשקלים: 16\.99 USD לפי השער היציג 3\.112 מיום 23\/10\/26/);
});

test("without the rates the foreign document is written as read and marked to look at, as before", async () => {
  const tools = await toolContext({ extraction: scriptedExtraction([{ records: [rawRecord({ ...zoom(), currency: "USD", issues: [] })] }]) });
  const handles = await tools.files();
  const read = await tools.dispatch("extract_document", { file: handles["photo.jpg"] });
  assert.deepEqual([read.documents[0].currency, read.documents[0].total, "foreign" in read.documents[0]], ["USD", 16.99, false]);
  assert.equal(read.documents[0].issues.includes("foreign_currency"), true);
});
