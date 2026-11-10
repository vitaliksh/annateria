import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";
import { base64url, signToken } from "../src/access.js";
import { RateError, representativeRate } from "../src/rate.js";

const ORIGIN = "https://vitaliksh.github.io";
const SIGNING_KEY = base64url(crypto.getRandomValues(new Uint8Array(32)));
// The shape the Bank of Israel answers with (format=csv), cut to the columns that matter and one more.
const CSV = "SERIES_CODE,TIME_PERIOD,OBS_VALUE\nRER_USD_ILS,2026-10-22,3.098\nRER_USD_ILS,2026-10-23,3.112\n";
const answer = (body, status = 200) => async (url) => {
  answer.urls.push(url);
  return new Response(body, { status });
};
answer.urls = [];

test("the rate of the day itself, asked for a window of days before it", async () => {
  answer.urls = [];
  const rate = await representativeRate({ currency: "usd", date: "2026-10-23", fetchImpl: answer(CSV) });
  assert.deepEqual(rate, { currency: "USD", date: "2026-10-23", rate: 3.112 });
  assert.match(answer.urls[0], /RER_USD_ILS\?c%5BTIME_PERIOD%5D=ge:2026-10-13%2Ble:2026-10-23&format=csv$/);
});

test("a weekend takes the last rate before it, and a later rate never counts", async () => {
  const weekend = await representativeRate({ currency: "USD", date: "2026-10-25", fetchImpl: answer(CSV) });
  assert.deepEqual([weekend.date, weekend.rate], ["2026-10-23", 3.112]);
  const before = await representativeRate({ currency: "USD", date: "2026-10-22", fetchImpl: answer(CSV) });
  assert.deepEqual([before.date, before.rate], ["2026-10-22", 3.098]);
});

test("the whole answer of the Bank is read, a comment with commas in quotes included", async () => {
  const head = "SERIES_CODE,FREQ,BASE_CURRENCY,COUNTER_CURRENCY,UNIT_MEASURE,DATA_TYPE,DATA_SOURCE,TIME_COLLECT,CONF_STATUS,PUB_WEBSITE,UNIT_MULT,COMMENTS,TIME_PERIOD,OBS_VALUE,RELEASE_STATUS";
  const body = `${head}\nRER_USD_ILS,D,USD,ILS,ILS,OF00,BOI_MRKT,V,F,Y,0,,2026-09-02,3.042,YP\nRER_USD_ILS,D,USD,ILS,ILS,OF00,BOI_MRKT,V,F,Y,0,"a, ""b"" c",2026-09-03,3.025,YP\n`;
  const rate = await representativeRate({ currency: "USD", date: "2026-09-03", fetchImpl: answer(body) });
  assert.deepEqual([rate.date, rate.rate], ["2026-09-03", 3.025]);
});

test("a wrong currency or date, no rate and a silent Bank are errors with a code", async () => {
  const code = (promise) => promise.then(() => "resolved", (error) => (error instanceof RateError ? error.code : error.message));
  assert.equal(await code(representativeRate({ currency: "ILS", date: "2026-10-23", fetchImpl: answer(CSV) })), "invalid");
  assert.equal(await code(representativeRate({ currency: "USD", date: "23/10/2026", fetchImpl: answer(CSV) })), "invalid");
  assert.equal(await code(representativeRate({ currency: "USD", date: "2026-10-01", fetchImpl: answer(CSV) })), "not-found");
  assert.equal(await code(representativeRate({ currency: "XYZ", date: "2026-10-23", fetchImpl: answer("", 404) })), "not-found");
  assert.equal(await code(representativeRate({ currency: "USD", date: "2026-10-23", fetchImpl: answer("", 500) })), "unavailable");
  const down = async () => {
    throw new TypeError("network");
  };
  assert.equal(await code(representativeRate({ currency: "USD", date: "2026-10-23", fetchImpl: down })), "unavailable");
  assert.equal(await code(representativeRate({ currency: "USD", date: "2026-10-23", fetchImpl: answer("a,b\n1,2") })), "unavailable");
});

async function send(path, { authorization, method = "GET" } = {}) {
  const token = (await signToken("anna", SIGNING_KEY)).token;
  const request = new Request(`https://worker.test${path}`, {
    method,
    headers: { origin: ORIGIN, authorization: authorization === undefined ? `Bearer ${token}` : authorization },
  });
  const response = await worker.fetch(request, { ALLOWED_ORIGINS: ORIGIN, TOKEN_SIGNING_KEY: SIGNING_KEY });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

test("GET /v1/rate answers a logged-in page only, with the CORS of the site", async (t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = answer(CSV);
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  const ok = await send("/v1/rate?currency=USD&date=2026-10-25");
  assert.deepEqual([ok.status, ok.body], [200, { currency: "USD", date: "2026-10-23", rate: 3.112 }]);
  assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal((await send("/v1/rate?currency=USD&date=2026-10-25", { authorization: "" })).status, 401);
  assert.equal((await send("/v1/rate?currency=USD&date=bad")).status, 400);
  assert.equal((await send("/v1/rate?currency=USD&date=2026-10-01")).status, 404);
  assert.equal((await send("/v1/rate?currency=USD&date=2026-10-25", { method: "POST" })).status, 405);
});
