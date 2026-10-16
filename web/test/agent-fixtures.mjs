// Shared pieces of the agent tests: a scripted model, a world of real stores on an in-memory data root, a panel that records.
import { saveClientChart } from "../chart-of-accounts.js";
import { createDeclaration, finalizeDeclaration, listDeclarations } from "../declaration-store.js";
import { addToInbox } from "../inbox-store.js";
import { createServices } from "../agent/services.js";
import { binaryDirectory } from "./memory-binary-directory.mjs";

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

const file = (name, content, type = "") => new File([new TextEncoder().encode(content)], name, { type, lastModified: Date.UTC(2026, 9, 1) });
export { file };

async function clientEntry(root, entryName, { clientName = entryName, vatId = "", months = [], locked = [], chart = {} } = {}) {
  const parent = await root.getDirectoryHandle("clients", { create: true });
  const directory = await parent.getDirectoryHandle(entryName, { create: true });
  const clientId = `id-${entryName}`;
  for (const month of months) {
    const { directory: monthDirectory, declaration } = await createDeclaration(directory, { clientId, month });
    if (locked.includes(month)) await finalizeDeclaration({ clientDirectory: directory, declarationDirectory: monthDirectory, declaration, finalExport: "no-export", rows: [] });
  }
  if (Object.keys(chart).length) await saveClientChart(directory, chart);
  return { id: clientId, clientName, directory, parent, entryName, config: { clientId, clientName, vatId }, declarations: await listDeclarations(directory) };
}

// Two clients (Levi: 01/2026 locked, 02/2026 open, own chart; Cohen: no declarations), and an inbox with three files.
export async function world() {
  const root = binaryDirectory("data");
  const levi = await clientEntry(root, "Levi", {
    clientName: "Levi Plumbing Ltd", vatId: "514123456", months: ["2026-01", "2026-02"], locked: ["2026-01"],
    chart: { 202: { name: "משרדיות", type: "expense" }, 206: { name: "ביטוח עסק", type: "outsideVatBase" } },
  });
  const cohen = await clientEntry(root, "Cohen", { clientName: "Cohen Studio", vatId: "035123459" });
  const clients = [levi, cohen];
  await addToInbox(root, [file("photo.jpg", "jpeg-bytes", "image/jpeg")], { now: "2026-10-16T08:00:00.000Z" });
  await addToInbox(root, [file("policy.pdf", "pdf-bytes", "application/pdf"), file("journal.xlsx", "xlsx-bytes")], { folder: "Levi", now: "2026-10-16T08:01:00.000Z" });
  const services = createServices({ getDataRoot: () => root, getClients: () => clients });
  return { root, levi, cohen, clients, services };
}

// A panel that records what it was shown. `answers` is a list of answers, or a function (card) => answer | Promise.
export function recordingUi({ answers = [] } = {}) {
  const ui = {
    cards: [], proposals: [],
    ask: async (card) => {
      ui.cards.push(card);
      return typeof answers === "function" ? answers(card) : answers.shift();
    },
    propose: async (proposal) => { ui.proposals.push(proposal); },
  };
  return ui;
}
