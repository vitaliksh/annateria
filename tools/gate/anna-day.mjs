// "Anna's day", the gate of milestone M3: a real browser, the real page, synthetic data, and a scripted model behind a fake Worker.
// It runs before every push that changes web/ (AGENTS.md). Nothing here touches the lab, the real data or Gemini.
//
//   node tools/gate/anna-day.mjs            headless; the exit code says whether the day worked
//   node tools/gate/anna-day.mjs --show     the same in a visible window
//
// What it does, by the buttons: open the page, type a code, choose a data folder (the one replaced dialog: the folder picker answers
// with a folder of the browser's private file system, so no real disk is touched), create a client from nothing, open its month by
// the click on "reopen", bring a scanned PDF above the request limit into the month's inbox (the file input gets the file: the second
// replaced dialog), press "check new documents", and see the row and the original filed. The scripted model reads the requests as
// Gemini would and answers with the tool calls of a good run; the fake Worker answers the reading of the document.
//
// The three bugs of 6 November 2026 fail it: an undeclared name in the run of the assistant; the month opened by click refused by
// the agent; the large PDF refused as "too large".
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHROME = process.env.GATE_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PAGE_PORT = 8100;
const WORKER_PORT = 8101;
const SHOW = process.argv.includes("--show");
const CLIENT = "לקוח בדיקה";
const SUPPLIER = "ספק השער בע\"מ";

// --- the fake Worker and its scripted model ---------------------------------------------------------------------------------

const call = (name, args) => ({ functionCall: { name, args } });
const responses = (content) => (content?.parts ?? []).map((part) => part.functionResponse).filter(Boolean);
const answer = (parts) => ({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, totalTokenCount: 1 } });

// What a good run does: list the inbox, read each file, write a row per document, file the original, say so.
function orchestrator(request, log) {
  const last = responses(request.contents.at(-1));
  const first = request.contents[0]?.parts?.[0]?.text ?? "";
  if (!last.length) {
    log.push(`run starts: ${first.split("\n")[0].slice(0, 160)}`);
    return answer([call("list_inbox", {})]);
  }
  const named = (name) => last.filter((item) => item.name === name).map((item) => item.response);
  if (named("list_inbox").length) {
    const files = named("list_inbox")[0].files ?? [];
    log.push(`inbox: ${files.length} file(s)`);
    return answer(files.map((item) => call("extract_document", { file: item.file })));
  }
  if (named("extract_document").length) {
    const results = named("extract_document");
    const failed = results.filter((item) => item.ok === false);
    if (failed.length) {
      log.push(`extract_document failed: ${JSON.stringify(failed[0]).slice(0, 300)}`);
      return answer([{ text: "לא הצלחתי לקרוא את המסמך." }]);
    }
    const facts = results.flatMap((item) => (item.documents ?? []).map((document) => document.fact));
    log.push(`read: ${facts.length} document(s)`);
    const client = /\(handle (C\d+)\)/.exec(first)?.[1] ?? "C1";
    const rows = facts.map((fact) => ({ fact, decision: "expense", account: "202", needs_review: false, reason: "ציוד משרדי." }));
    return answer([call("add_rows", { client, rows })]);
  }
  if (named("add_rows").length) {
    const result = named("add_rows")[0];
    const written = (result.rows ?? []).filter((row) => row.month);
    log.push(`add_rows: ${written.length} written, ${JSON.stringify(result).slice(0, 300)}`);
    if (!written.length) return answer([{ text: "השורות לא נכתבו." }]);
    return answer([call("move_file_to_declaration", { file: "F1" })]);
  }
  if (named("move_file_to_declaration").length) {
    log.push(`move_file: ${JSON.stringify(named("move_file_to_declaration")[0]).slice(0, 200)}`);
    return answer([{ text: "סיימתי: נוספה שורה אחת והמקור צורף." }]);
  }
  log.push(`unexpected step: ${JSON.stringify(last).slice(0, 200)}`);
  return answer([{ text: "סיימתי." }]);
}

// The reading of a document: one invoice per request, on its first page.
function extraction(request, log) {
  const parts = request.contents?.[0]?.parts ?? [];
  const inline = parts.find((part) => part.inlineData);
  log.push(`extraction: ${inline?.inlineData?.mimeType} of ${Math.round(((inline?.inlineData?.data?.length ?? 0) * 3) / 4 / 1024 / 1024)} MiB`);
  const record = {
    kind: "expense_invoice", page: 1, date: "2026-01-15", period_from: null, period_to: null, document_title: "חשבונית מס", supplier_name: SUPPLIER,
    supplier_vat_id: "514216910", buyer_name: CLIENT, buyer_vat_id: null, document_number: "77001", allocation_number: null, currency: "ILS",
    net: 100, vat: 18, total: 118, vat_percent: 18, purpose: "נייר מדפסת", confidence: 95, issues: [],
  };
  return answer([{ text: JSON.stringify({ documents: [record] }) }]);
}

function fakeWorker(log) {
  let holder = null;
  const server = createServer(async (request, response) => {
    const headers = {
      "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Content-Type": "application/json; charset=utf-8",
    };
    const send = (status, value) => { response.writeHead(status, headers); response.end(JSON.stringify(value)); };
    if (request.method === "OPTIONS") return send(204, {});
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    const path = new URL(request.url, "http://gate").pathname;
    if (process.env.GATE_DEBUG) log.push(`worker: ${request.method} ${path} ${request.headers.authorization ? "auth" : "-"}`);
    const now = Date.now();
    if (path === "/health") return send(200, { ok: true, version: "gate" });
    if (path === "/v1/auth") return send(200, { token: "gate-token", user: "gate", expiresAt: now + 3600000 });
    if (path === "/v1/baton") return send(200, { now, live: Boolean(holder), holder, snapshot: null });
    if (path === "/v1/baton/beat") {
      holder = { device: body.device, deviceName: body.deviceName, user: "gate", since: holder?.since ?? now, lastBeat: now, released: false };
      return send(200, { now, live: true, holder, snapshot: null, took: true });
    }
    if (path === "/v1/baton/release") { holder = null; return send(200, { now, live: false, holder: null, snapshot: null }); }
    if (path === "/v1/model") {
      const { request: model } = body;
      return send(200, model.generationConfig?.responseMimeType ? extraction(model, log) : orchestrator(model, log));
    }
    return send(404, { error: "Not found." });
  });
  return new Promise((ready) => server.listen(WORKER_PORT, "127.0.0.1", () => ready(server)));
}

// --- a scanned PDF above the request limit ----------------------------------------------------------------------------------

// Two pages, each an uncompressed noise image of about 11 MiB: like a scan of a phone app, and too big for one request together.
function bigScan(path) {
  const [width, height] = [2200, 1700];
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 7;
  for (let i = 0; i < pixels.length; i += 1) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; pixels[i] = 200 + (seed % 56); }
  const objects = [];
  const add = (text) => objects.push(Buffer.isBuffer(text) ? text : Buffer.from(text, "latin1"));
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>");
  for (let page = 0; page < 2; page += 1) {
    const first = 3 + page * 3;
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im${page} ${first + 1} 0 R >> >> /Contents ${first + 2} 0 R >>`);
    add(Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n`, "latin1"),
      pixels, Buffer.from("\nendstream", "latin1"),
    ]));
    const draw = `q 612 0 0 792 0 0 cm /Im${page} Do Q`;
    add(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  }
  const parts = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offsets = [];
  let size = parts[0].length;
  objects.forEach((object, index) => {
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, "latin1"), object, Buffer.from("\nendobj\n", "latin1")]);
    offsets.push(size);
    parts.push(chunk);
    size += chunk.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)].join("");
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`, "latin1"));
  writeFileSync(path, Buffer.concat(parts));
  return size;
}

// --- the day, by the buttons ----------------------------------------------------------------------------------------------

async function day(page, scanPath, log) {
  const click = (selector) => page.locator(selector).first().click({ timeout: 10000 });
  const clickText = (text) => page.getByRole("button", { name: text, exact: true }).first().click({ timeout: 10000 });
  const step = (name) => log.push(`step: ${name}`);

  step("open and log in");
  await page.goto(`http://127.0.0.1:${PAGE_PORT}/`);
  await page.locator("#access-code").fill("GATE01");
  await click("#access-submit");
  await page.locator("#access-code").waitFor({ state: "hidden" });

  step("choose the data folder");
  await clickText("בחירת תיקיית נתונים");
  await page.getByText("אין לקוחות בתיקייה זו").first().waitFor({ timeout: 10000 });

  step("create a client from nothing");
  await click("#show-new-client");
  await page.locator("#new-client-name").fill(CLIENT);
  await page.locator("#new-client-activity").fill("שירותים");
  await page.locator("#new-client-month").fill("01/2026");
  await click("#create-client");
  await page.getByRole("button", { name: CLIENT }).first().waitFor();

  step("create a second client in the same dialog");
  await click("#show-new-client");
  await page.locator("#new-client-name").fill(`${CLIENT} 2`, { timeout: 5000 });
  await page.locator("#new-client-activity").fill("שירותים");
  await click("#create-client");
  await page.getByRole("button", { name: `${CLIENT} 2` }).first().waitFor();

  step("reload the page, which closes the month, and open it again by the click on reopen");
  await page.reload();
  await page.locator("#access-code").fill("GATE01");
  await click("#access-submit");
  await page.locator("#access-code").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: CLIENT }).first().click();
  await page.getByRole("button", { name: "01/2026" }).first().click();
  await page.waitForFunction(() => document.querySelector("header")?.innerText.includes("נעולה"));
  await click("#reopen-declaration");
  await page.locator("#close-declaration").waitFor({ state: "attached" });
  await page.waitForFunction(() => document.querySelector("header")?.innerText.includes("פתוחה"));

  step("bring the scan into the month's inbox");
  await click("#open-month-inbox");
  await page.locator("#inbox-file").setInputFiles(scanPath);
  await page.locator("#inbox-dialog").getByText("scan-big.pdf").waitFor({ timeout: 20000 });
  await click("#inbox-check");

  step("wait for the run");
  await page.waitForFunction(() => {
    const cancel = document.querySelector("#assistant-cancel");
    return cancel && cancel.offsetParent === null && document.querySelector("#assistant-feed")?.innerText.includes("בדוק מסמכים חדשים");
  }, null, { timeout: 120000, polling: 500 });
  await page.waitForTimeout(500);

  step("look at the table and the feed");
  const rows = await page.locator("#journal-table tbody tr[data-document-id]").count();
  const table = await page.locator("#journal-table").innerText();
  const feed = await page.locator("#assistant-feed").innerText();
  return { rows, hasSupplier: table.includes(SUPPLIER.slice(0, 8)), feed };
}

async function main() {
  const log = [];
  const pageErrors = [];
  const folder = mkdtempSync(join(tmpdir(), "anna-day-"));
  const scanPath = join(folder, "scan-big.pdf");
  const scanSize = bigScan(scanPath);
  log.push(`scan: ${(scanSize / 1024 / 1024).toFixed(1)} MiB`);
  const worker = await fakeWorker(log);
  const site = spawn(process.execPath, [join(REPOSITORY, "tools", "lab.mjs"), "page"], {
    env: { ...process.env, LAB_PAGE_PORT: String(PAGE_PORT), LAB_WORKER_PORT: String(WORKER_PORT) }, stdio: "ignore",
  });
  const browser = await chromium.launch({ executablePath: CHROME, headless: !SHOW, args: ["--no-first-run"] });
  let outcome = null;
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
    // The one replaced dialog: the folder picker answers with an empty folder of the page's own private file system.
    await context.addInitScript(() => {
      window.showDirectoryPicker = async () => {
        const root = await navigator.storage.getDirectory();
        return root.getDirectoryHandle(`anna-day-${Date.now()}`, { create: true });
      };
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource/.test(message.text())) pageErrors.push(message.text()); });
    await new Promise((ready) => setTimeout(ready, 600));
    try {
      outcome = await day(page, scanPath, log);
    } catch (error) {
      const picture = join(tmpdir(), "anna-day-failed.png");
      await page.screenshot({ path: picture }).catch(() => {});
      throw Object.assign(error, { picture });
    }
  } catch (error) {
    log.push(`FAILED at the last step: ${error.message.split("\n")[0]}${error.picture ? ` (picture: ${error.picture})` : ""}`);
  } finally {
    await browser.close();
    site.kill();
    worker.close();
    rmSync(folder, { recursive: true, force: true });
  }
  const problems = [];
  if (!outcome) problems.push("the day did not finish");
  else {
    if (outcome.rows !== 1) problems.push(`the table has ${outcome.rows} rows, 1 expected`);
    if (!outcome.hasSupplier) problems.push("the row of the scanned invoice is not in the table");
    if (/שגיאה|נכשל|לא הצלחתי|is not defined|not allowed|נעול/.test(outcome.feed)) problems.push(`the feed reports a problem: ${outcome.feed.slice(-300)}`);
  }
  if (!log.some((line) => line.startsWith("extraction:"))) problems.push("the document was never sent for reading");
  for (const error of pageErrors) problems.push(`page error: ${error}`);
  console.log(log.join("\n"));
  if (problems.length) {
    console.log(`\nANNA'S DAY FAILED:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nAnna's day passed.");
}

await main();
