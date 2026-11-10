// The eval of the agent (WORK_PLAN step 5.3): synthetic cases with the expected decisions. A case builds a data root in memory,
// runs the agent of the dock on it (assistant-flow.js: the same skills, loop, tools and stores) and checks what was written, not
// how the model put it. The vision call is replaced by the facts of the case, so the eval measures the decisions of the
// orchestrator and its skills. run-eval.mjs runs it against the real model through the Worker; test/eval.test.mjs against a
// scripted model. All names, numbers and amounts of the cases are invented.
// Reading mode (run-eval --read): a file of a case with `source` (a synthetic document under eval/files/) is read by the real vision
// call, and what it read is checked against the records of the case (date, number, currency, total, VAT), so the reading is measured too.
// A source may be an absolute path: the lab keeps cases with real documents outside the repository (run-eval --cases <folder>).
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMessage, createAssistantFlow } from "../assistant-flow.js";
import { saveClientChart } from "../chart-of-accounts.js";
import { createDeclaration, finalizeDeclaration, listDeclarations, loadDeclaration, saveDraft } from "../declaration-store.js";
import { addToInbox, readInboxIndex } from "../inbox-store.js";
import { binaryDirectory } from "../test/memory-binary-directory.mjs";

const EVAL_DIRECTORY = dirname(fileURLToPath(import.meta.url));
// A handle the user must never read (docs/AGENT_TOOLS.md, section 3).
const HANDLE = /\b[CFRQPI][1-9]\d*(?:\.[1-9]\d*)?\b/;
const TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", pdf: "application/pdf" };

// What the vision model would return for a document when the case does not say otherwise.
const BLANK_RECORD = {
  kind: "expense_invoice", page: null, date: null, period_from: null, period_to: null, document_title: "חשבונית מס", supplier_name: null,
  supplier_vat_id: null, buyer_name: null, buyer_vat_id: null, document_number: null, allocation_number: null, currency: "ILS",
  net: null, vat: null, total: null, vat_percent: 18, purpose: null, confidence: 95, issues: [],
};

export async function loadCases(directory, only = []) {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  const cases = await Promise.all(names.map(async (name) => JSON.parse(await readFile(join(directory, name), "utf8"))));
  const wanted = only.length ? cases.filter((item) => only.includes(item.name)) : cases;
  const unknown = only.filter((name) => !cases.some((item) => item.name === name));
  if (unknown.length) throw new Error(`Unknown case: ${unknown.join(", ")}`);
  return wanted;
}

// The text of a skill from web/skills on disk, as the page fetches it from the site.
export const diskSkills = (webDirectory) => (name) => readFile(join(webDirectory, "skills", name, "SKILL.md"), "utf8");

// A row of a saved table (draft-table format) from the short form of a case.
function tableRow(row, index) {
  const values = [row.date, row.account ?? "", row.purpose ?? "", row.supplier ?? "", row.supplierId ?? "", row.number ?? "", row.allocation ?? "",
    String(row.gross), String(row.net), String(row.vat)];
  return {
    documentId: `case-${index + 1}`, imageIndex: 0, imageFile: "", receivedAt: "2026-01-01T08:00:00.000Z", values,
    rawNet: values[8], rawVat: values[9], reference: row.number ?? "", documentKind: "expense_invoice", active: true,
    statusClass: "ready", statusText: "מוכן",
  };
}

// clients: [{ folder, name, vatId, kind, pcn, chart, months: { "YYYY-MM": [rows] }, locked: [months] }];
// open: { client: folder, month } of the run (step 9.6); inbox: [{ name, records }], every file of the open month.
// Resolves with { root, clients } in the shape the page gives to the services.
export async function buildWorld(spec) {
  const root = binaryDirectory("data");
  const parent = await root.getDirectoryHandle("clients", { create: true });
  const clients = [];
  for (const item of spec.clients) {
    const directory = await parent.getDirectoryHandle(item.folder, { create: true });
    const clientId = `id-${item.folder}`;
    for (const [month, rows] of Object.entries(item.months ?? {})) {
      const { directory: monthDirectory, declaration } = await createDeclaration(directory, { clientId, month });
      const table = rows.map(tableRow);
      if (table.length) await saveDraft(monthDirectory, declaration, table);
      if ((item.locked ?? []).includes(month)) {
        await finalizeDeclaration({
          clientDirectory: directory, declarationDirectory: monthDirectory, declaration, finalExport: "no-export", rows: table,
        });
      }
    }
    if (item.chart) await saveClientChart(directory, item.chart);
    const config = {
      clientId, clientName: item.name, vatId: item.vatId ?? "", businessActivity: item.activity ?? "", businessKind: item.kind ?? "office",
      ...(item.pcn ? { pcnRequired: true } : {}),
    };
    const declarations = await listDeclarations(directory);
    clients.push({ id: clientId, clientName: item.name, directory, parent, entryName: item.folder, config, declarations });
  }
  for (const file of spec.inbox) {
    const type = TYPES[file.name.split(".").pop().toLowerCase()] ?? "";
    // The bytes only have to differ per file: the stand-in of the vision call never reads them. A file with a source is the real document.
    const bytes = file.source ? await readFile(resolve(EVAL_DIRECTORY, file.source)) : new TextEncoder().encode(`${spec.name}/${file.name}`);
    const folder = spec.open ? { folder: spec.open.client, month: spec.open.month } : {};
    const added = new File([bytes], file.name, { type, lastModified: Date.UTC(2026, 0, 1) });
    await addToInbox(root, [added], { now: `${spec.today}T08:00:00.000Z`, ...folder });
  }
  return { root, clients };
}

// The stand-in of the vision call: the records of the case for the file, as the model would return them (the tool cleans them).
// reader: the real vision adapter in reading mode; it reads every file that has a source, and `readings` keeps what it read.
export function extractionFor(spec, { reader = null } = {}) {
  const byName = new Map(spec.inbox.map((file) => [file.name, file.records]));
  const sources = new Set(spec.inbox.filter((file) => file.source).map((file) => file.name));
  const calls = [];
  const readings = {};
  return {
    calls,
    readings,
    async run(entry, file, options) {
      calls.push(entry.name);
      if (reader && sources.has(entry.name)) {
        const result = await reader.run(entry, file, options);
        readings[entry.name] = result.records;
        return result;
      }
      const records = byName.get(entry.name);
      if (!records) throw new Error(`The case has no facts for ${entry.name}.`);
      return { records: records.map((record) => ({ ...BLANK_RECORD, ...record })), model: "eval-facts" };
    },
  };
}

// The user of the case: answers: { labels: [text of a button to click] }. Anything else is dismissed.
export function answerCard(card, answers = {}) {
  for (const label of answers.labels ?? []) {
    const chosen = card.options.find((option) => option.label.includes(label));
    if (chosen) return { type: "option", id: chosen.id };
  }
  return { type: "dismissed" };
}

// The rows of this run in every table of every client, in a short form for the checks.
async function agentRows(clients, runId) {
  const rows = [];
  for (const client of clients) {
    for (const { declaration } of await listDeclarations(client.directory)) {
      const { draft } = await loadDeclaration(client.directory, declaration.month);
      for (const [index, row] of draft.rows.entries()) {
        if (row.agent?.run !== runId) continue;
        rows.push({
          client: client.entryName, month: declaration.month, position: index + 1, reference: row.reference,
          account: row.values[1], status: row.statusClass, active: row.active !== false, expensePercent: row.values[11], gross: row.values[7],
          reasons: row.agent.reasons ?? [], opinion: row.agentOpinion,
        });
      }
    }
  }
  return rows;
}

// modelClient: createModelClient(...) or anything with generate(). Resolves with what the checks read and the reports keep.
// rates: the representative rates (currency.js); the real Worker's in npm run eval, a fixed one in the tests.
export async function runCase(spec, { modelClient, fetchSkill, getModels, signal, onProgress, reader = null, rates = null } = {}) {
  const { root, clients } = await buildWorld(spec);
  const cards = [];
  const proposals = [];
  const ui = {
    ask: async (card) => {
      cards.push(card);
      return answerCard(card, spec.answers);
    },
    propose: async (proposal) => { proposals.push(proposal); },
    importCard: async () => {},
  };
  const extraction = extractionFor(spec, { reader });
  const flow = createAssistantFlow({
    modelClient, getDataRoot: () => root, getClients: () => clients, fetchSkill, now: () => `${spec.today}T09:00:00.000Z`, extraction, rates,
    ...(getModels ? { getModels } : {}),
  });
  // A case is "process the inbox" unless it gives the words of the user (request); it runs on the open client and month.
  const open = spec.open ? clients.find((client) => client.entryName === spec.open.client) : null;
  const active = open ? { clientName: open.clientName, month: spec.open.month } : null;
  const scope = open ? { clientId: open.id, month: spec.open.month } : null;
  const message = buildMessage({ kind: spec.request ? "text" : "process", text: spec.request ?? "", today: spec.today, active });
  const result = await flow.run({ message, ui, signal, onProgress, scope });
  const left = (await readInboxIndex(root)).files.map((entry) => entry.name);
  const called = (result.log?.entries ?? []).filter((entry) => entry.kind === "tool").map((entry) => entry.name);
  const states = {};
  for (const client of clients) {
    for (const { declaration } of await listDeclarations(client.directory)) states[`${client.entryName} ${declaration.month}`] = declaration.status;
  }
  return { result, cards, proposals, extracted: extraction.calls, readings: extraction.readings, rows: result.runId ? await agentRows(clients, result.runId) : [], left, called, states };
}

const check = (name, ok, detail = "") => ({ name, ok: Boolean(ok), detail: ok ? "" : detail });
const FIELDS = ["client", "month", "account", "status", "active", "expensePercent", "gross"];

// expect: { rows: [{ reference, client?, month?, account?, status?, active?, expensePercent?, gross? }], inactive: [reference],
// notReady: [reference], questions: { max?, min? }, filed: [file name], kept: [file name], called: [tool name],
// stillOpen: ["<client folder> YYYY-MM"] }. Every case also checks that
// the run completed and that the answer holds no handle.
export function checkCase(spec, outcome) {
  const { result, rows, cards, left } = outcome;
  const expect = spec.expect ?? {};
  const why = `status ${result.status}${result.error ? `: ${result.error}` : ""}${result.reason ? ` (${result.reason})` : ""}`;
  const handle = (result.text ?? "").match(HANDLE)?.[0];
  const checks = [check("completed", result.status === "completed", why), check("no handles in the answer", !handle, `"${handle}" in the answer`)];
  for (const wanted of expect.rows ?? []) {
    const found = rows.filter((row) => row.reference === wanted.reference && (!wanted.client || row.client === wanted.client));
    const name = `row ${wanted.reference}`;
    if (found.length !== 1) {
      checks.push(check(name, false, found.length ? `${found.length} rows` : "no row"));
      continue;
    }
    const wrong = FIELDS.filter((field) => field in wanted && found[0][field] !== wanted[field]);
    const told = wrong.map((field) => `${field} ${JSON.stringify(found[0][field])}, expected ${JSON.stringify(wanted[field])}`);
    checks.push(check(name, !wrong.length, told.join("; ")));
  }
  for (const reference of expect.inactive ?? []) {
    const active = rows.filter((row) => row.reference === reference && row.active);
    const where = active.map((row) => `${row.client} ${row.month}`).join(", ");
    checks.push(check(`no active row ${reference}`, !active.length, `${active.length} active (${where})`));
  }
  for (const reference of expect.notReady ?? []) {
    const ready = rows.filter((row) => row.reference === reference && row.status === "ready");
    checks.push(check(`not ready ${reference}`, !ready.length, `${ready.length} ready`));
  }
  const questions = expect.questions ?? {};
  const asked = cards.map((card) => card.question).join(" | ");
  if (questions.max !== undefined) {
    checks.push(check(`at most ${questions.max} questions`, cards.length <= questions.max, `${cards.length}: ${asked}`));
  }
  if (questions.min !== undefined) {
    checks.push(check(`at least ${questions.min} questions`, cards.length >= questions.min, `${cards.length}`));
  }
  for (const name of expect.filed ?? []) checks.push(check(`filed ${name}`, !left.includes(name), "still in the inbox"));
  for (const name of expect.kept ?? []) checks.push(check(`kept ${name}`, left.includes(name), "left the inbox"));
  for (const name of expect.called ?? []) checks.push(check(`called ${name}`, outcome.called.includes(name), `called: ${outcome.called.join(", ")}`));
  for (const key of expect.stillOpen ?? []) checks.push(check(`still open ${key}`, outcome.states[key] === "open", `${outcome.states[key]}`));
  checks.push(...readingChecks(spec, outcome.readings ?? {}));
  return checks;
}

// Reading mode: every record of a file with a source must be found among what the model read, with the same facts.
const READ_FIELDS = ["date", "document_number", "currency", "total", "vat"];
// A document number is compared by its letters and digits: "US 551" and "US-551" are one number.
const plain = (value) => String(value ?? "").toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
const MONEY_FIELDS = new Set(["total", "vat"]);
const sameFact = (field, read, wanted) => (MONEY_FIELDS.has(field) ? Math.abs(Number(read ?? 0) - Number(wanted)) < 0.005 : plain(read) === plain(wanted));
function readingChecks(spec, readings) {
  const checks = [];
  for (const file of spec.inbox.filter((item) => item.source && readings[item.name])) {
    const read = readings[file.name];
    checks.push(check(`read ${file.name}: ${file.records.length} documents`, read.length === file.records.length, `${read.length} read`));
    for (const wanted of file.records) {
      const fields = READ_FIELDS.filter((field) => wanted[field] !== undefined && wanted[field] !== null);
      const best = read.find((record) => sameFact("document_number", record.document_number, wanted.document_number)) ?? read[0];
      const wrong = fields.filter((field) => !best || !sameFact(field, best[field], wanted[field]));
      const told = wrong.map((field) => `${field} ${JSON.stringify(best?.[field])}, expected ${JSON.stringify(wanted[field])}`);
      checks.push(check(`read ${file.name} ${wanted.document_number ?? ""}`.trim(), !wrong.length, told.join("; ")));
    }
  }
  return checks;
}
