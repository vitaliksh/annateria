// Shared pieces of the agent tests: a scripted model, a world of real stores on an in-memory data root, a panel that records.
import { saveClientChart } from "../chart-of-accounts.js";
import { createDeclaration, finalizeDeclaration, listDeclarations, saveDraft } from "../declaration-store.js";
import { addToInbox } from "../inbox-store.js";
import { createDocumentReader } from "../agent/adapters/documents.js";
import { createDefaultRegistry } from "../agent/index.js";
import { createContext } from "../agent/run.js";
import { createServices } from "../agent/services.js";
import { binaryDirectory, putFile } from "./memory-binary-directory.mjs";

export const call = (name, args = {}, { id, signature } = {}) => ({ functionCall: { name, args, ...(id ? { id } : {}) }, ...(signature ? { thoughtSignature: signature } : {}) });
export const say = (text) => ({ text });
export const reply = (...parts) => ({ parts, finishReason: "STOP" });
export const modelError = (code, message = code) => Object.assign(new Error(message), { name: "ModelError", code });
export const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });

// script: replies, errors, or functions (request) => reply | Error. Records a copy of every request it receives.
export function scriptedModel(script) {
  const requests = [];
  let next = 0;
  return {
    requests,
    async step(request) {
      requests.push(structuredClone({ system: request.system, contents: request.contents, tools: request.tools }));
      const item = script[next];
      next += 1;
      if (item === undefined) throw new Error("The script has no more replies.");
      const value = typeof item === "function" ? await item(request) : item;
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

const file = (name, content, type = "") => new File([typeof content === "string" ? new TextEncoder().encode(content) : content], name, { type, lastModified: Date.UTC(2026, 9, 1) });
export { file };

// A row of a saved table (draft-table format). values: date, account, purpose, supplier, supplier id, reference, allocation, gross, net, vat.
export const tableRow = (documentId, values, extra = {}) => ({
  documentId, imageIndex: 0, imageFile: "", receivedAt: "2026-02-01T08:00:00.000Z", values, rawNet: values[8], rawVat: values[9], reference: "", documentKind: "expense_invoice",
  active: true, statusClass: "ready", statusText: "מוכן", ...extra,
});

async function clientEntry(root, entryName, { clientName = entryName, vatId = "", months = [], locked = [], rows = {}, chart = {}, config: more = {} } = {}) {
  const parent = await root.getDirectoryHandle("clients", { create: true });
  const directory = await parent.getDirectoryHandle(entryName, { create: true });
  const clientId = `id-${entryName}`;
  for (const month of months) {
    const { directory: monthDirectory, declaration } = await createDeclaration(directory, { clientId, month });
    if (rows[month]) await saveDraft(monthDirectory, declaration, rows[month]);
    if (locked.includes(month)) await finalizeDeclaration({ clientDirectory: directory, declarationDirectory: monthDirectory, declaration, finalExport: "no-export", rows: rows[month] ?? [] });
  }
  if (Object.keys(chart).length) await saveClientChart(directory, chart);
  return { id: clientId, clientName, directory, parent, entryName, config: { clientId, clientName, vatId, businessActivity: "plumbing", businessKind: "office", ...more }, declarations: await listDeclarations(directory) };
}

// Levi: 01/2026 locked, 02/2026 open with three rows, own chart. Cohen: a home client, no declarations. Pcn: a PCN client with one
// invoice above the ceiling. The inbox holds a photo (unsorted) and a PDF and a workbook (Levi).
// options: documents (readers for the inside of files), extraction (the vision adapter), imports (the import preparers), liveTable.
export async function world({ documents, extraction, imports, liveTable = () => null } = {}) {
  const root = binaryDirectory("data");
  const levi = await clientEntry(root, "Levi", {
    clientName: "Levi Plumbing Ltd", vatId: "514123456", months: ["2026-01", "2026-02"], locked: ["2026-01"],
    chart: { 202: { name: "משרדיות", type: "expense" }, 206: { name: "ביטוח עסק", type: "outsideVatBase" } },
    rows: {
      "2026-01": [tableRow("old-1", ["10/01/2026", "202", "pens", "Paper Shop", "512345679", "5", "", "118", "100", "18"], { reference: "INV-5" })],
      "2026-02": [
        tableRow("d-1", ["14/02/2026", "202", "paper", "Paper Shop", "512345679", "1001", "", "118", "100", "18"], { reference: "INV-1001" }),
        tableRow("d-2", ["15/02/2026", "206", "insurance", "Safe Insurance", "", "77", "", "500", "500", "0"], { statusClass: "review", statusText: "נדרש עיון", agent: { run: "r0" }, agentOpinion: "ביטוח עסק" }),
        tableRow("d-3", ["14/02/2026", "202", "paper", "Paper Shop", "512345679", "1001", "", "118", "100", "18"], { active: false, autoExclude: "duplicate", statusClass: "review", statusText: "כפילות — המסמך כבר הוזן" }),
      ],
    },
  });
  const cohen = await clientEntry(root, "Cohen", { clientName: "Cohen Studio", vatId: "035123459", config: { businessKind: "home" } });
  const pcn = await clientEntry(root, "Pcn", {
    clientName: "Pcn Trading", vatId: "514000018", months: ["2026-02"], config: { pcnRequired: true },
    rows: { "2026-02": [tableRow("p-1", ["10/02/2026", "202", "machine", "Big Supplier", "512222222", "9", "", "14160", "12000", "2160"], { reference: "BIG-9" })] },
  });
  const clients = [levi, cohen, pcn];
  await addToInbox(root, [file("photo.jpg", "jpeg-bytes", "image/jpeg")], { now: "2026-10-16T08:00:00.000Z" });
  await addToInbox(root, [file("policy.pdf", "pdf-bytes", "application/pdf"), file("journal.xlsx", "xlsx-bytes")], { folder: "Levi", now: "2026-10-16T08:01:00.000Z" });
  const services = createServices({ getDataRoot: () => root, getClients: () => clients, getLiveTable: liveTable, documents: documents ?? createDocumentReader(), extraction, imports });
  return { root, levi, cohen, pcn, clients, services, putFile: (path, content) => putFile(root, path, content) };
}

// A panel that records what it was shown. `answers` is a list of answers, or a function (card) => answer | Promise.
export function recordingUi({ answers = [] } = {}) {
  const ui = {
    cards: [], proposals: [], importCards: [],
    ask: async (card) => {
      ui.cards.push(card);
      return typeof answers === "function" ? answers(card) : answers.shift();
    },
    propose: async (proposal) => { ui.proposals.push(proposal); },
    importCard: async (card) => { ui.importCards.push(card); },
  };
  return ui;
}

// A vision adapter that answers from a list: each item is { records } or an Error, or a function (entry, options) => item.
export function scriptedExtraction(script) {
  const calls = [];
  let next = 0;
  return {
    calls,
    async run(entry, _file, options) {
      calls.push({ name: entry.name, ...options });
      const item = script[next];
      next += 1;
      if (item === undefined) throw new Error("The extraction script has no more answers.");
      const value = typeof item === "function" ? await item(entry, options) : item;
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

// A raw record as the model returns it (before the code cleans it).
export const rawRecord = (overrides = {}) => ({
  kind: "expense_invoice", page: null, date: "2026-02-20", period_from: null, period_to: null, document_title: "Tax invoice", supplier_name: "Paper Shop",
  supplier_vat_id: "512345679", buyer_name: "Levi Plumbing", buyer_vat_id: "514123456", document_number: "INV-2002", allocation_number: null, currency: "ILS",
  net: 200, vat: 36, total: 236, vat_percent: 18, purpose: "paper", confidence: 92, issues: [], ...overrides,
});

// A context for calling tools directly: dispatch(name, args), client(name) -> handle, files() -> { name: handle }.
export async function toolContext({ answers, limits, ...worldOptions } = {}) {
  const w = await world(worldOptions);
  const ui = recordingUi({ answers });
  const base = createContext({ services: w.services });
  const ctx = createContext({ services: w.services, ui, limits: { ...base.limits, ...limits }, now: () => "2026-10-16T09:00:00.000Z" });
  const registry = createDefaultRegistry();
  const dispatch = (name, args = {}) => registry.dispatch({ name, args }, ctx);
  const client = async (name) => (await dispatch("find_client", { name })).matches[0].client;
  const files = async () => Object.fromEntries((await dispatch("list_inbox")).files.map((item) => [item.name, item.file]));
  return { w, ui, ctx, dispatch, client, files };
}
