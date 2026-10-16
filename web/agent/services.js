// `services`: the only way for an agent tool to reach data (docs/AGENT_TOOLS.md, sections 1 and 6). It offers reading: the inbox
// index, what is inside a file, the client's profile, chart, rules and rows, the intake context of the duplicate search, and
// the vision call of extraction; plus asking whether a declaration is open and copying a table before the agent writes. It has
// no operation that closes, reopens, deletes or archives anything; a test lists its keys and fails when such a word appears.
// Tools do not import file stores: they only see what is here.
import { backupTable } from "../bookkeeper-flow.js";
import { readClientChart, readEffectiveChart } from "../chart-of-accounts.js";
import { loadDeclaration } from "../declaration-store.js";
import { entryFromRow } from "../intake-facts.js";
import { loadIntakeContext } from "../intake-index.js";
import { readInboxFile, readInboxIndex } from "../inbox-store.js";
import { readRules } from "../rules-store.js";
import { createDocumentReader } from "./adapters/documents.js";

// getDataRoot(): the data root handle (changes when the user picks another). getClients(): the workspace's active clients
// ({ id, clientName, directory, parent, entryName, config, declarations }). getLiveTable(): the table open in the page,
// { clientId, month, rows } in the draft-table format, or null: its rows count as they are on screen, saved or not.
// builtInChart(): { code: { name, type } } used when neither the client nor the root has a chart. reserved(): codes a chart may
// not reuse. documents: reads inside files (adapters/documents.js). extraction: the vision call (adapters/extraction.js), or null.
export function createServices({ getDataRoot, getClients, getLiveTable = () => null, builtInChart = () => ({}), reserved = () => ({}), documents = createDocumentReader(), extraction = null }) {
  const homeClients = () => (getClients() ?? []).filter((client) => client.parent && client.entryName);
  const find = (clientId) => {
    const client = homeClients().find((item) => item.id === clientId);
    if (!client) throw new Error("Unknown client.");
    return client;
  };
  const dataRoot = () => {
    const root = getDataRoot();
    if (!root) throw new Error("No data root.");
    return root;
  };
  const liveFor = (clientId) => {
    const live = getLiveTable();
    return live && live.clientId === clientId ? live : null;
  };
  const stateOf = (declaration) => (declaration.status === "open" ? "open" : "locked");

  return Object.freeze({
    inbox: Object.freeze({
      readIndex: () => readInboxIndex(dataRoot()),
    }),
    documents: Object.freeze({
      inspect: async (entry, options) => documents.inspect(await readInboxFile(dataRoot(), entry), entry, options),
    }),
    extraction: Object.freeze({
      run: async (entry, options) => {
        if (!extraction) throw new Error("Extraction is not configured.");
        return extraction.run(entry, await readInboxFile(dataRoot(), entry), options);
      },
    }),
    clients: Object.freeze({
      list: () => homeClients().map((client) => ({ clientId: client.id, clientName: client.clientName, vatId: client.config?.vatId ?? "" })),
      // { clientId, name, activity, kind, pcnRequired, vatId, vatPeriod, advancesPeriod, declarations: [{ month, status, rows }] }
      // `rows` counts the active rows of the saved table.
      profile: async (clientId) => {
        const client = find(clientId);
        const config = client.config ?? {};
        const declarations = [];
        for (const { declaration } of client.declarations ?? []) {
          if (declaration.archived) continue;
          const rows = await loadDeclaration(client.directory, declaration.month).then(({ draft }) => draft.rows.filter((row) => row.active !== false).length, () => 0);
          declarations.push({ month: declaration.month, status: stateOf(declaration), rows });
        }
        declarations.sort((a, b) => a.month.localeCompare(b.month));
        return {
          clientId, name: client.clientName, activity: config.businessActivity ?? "", kind: config.businessKind === "home" ? "home" : "office",
          pcnRequired: Boolean(config.pcnRequired), vatId: config.vatId ?? "", vatPeriod: config.vatPeriod ?? "monthly",
          advancesPeriod: config.advancesPeriod ?? config.vatPeriod ?? "monthly", declarations,
        };
      },
      // { accounts: { code: { name, type } }, source: "client" | "built-in" }: the client's own chart, else the shared chart of the
      // root, else the built-in map (all three but the first are "built-in" to the agent).
      chart: async (clientId) => {
        const client = find(clientId);
        if (await readClientChart(client.directory, reserved())) return { accounts: await readEffectiveChart(dataRoot(), client.directory, clientId, reserved()), source: "client" };
        const shared = await readEffectiveChart(dataRoot(), client.directory, clientId, reserved());
        return { accounts: Object.keys(shared).length ? shared : builtInChart(), source: "built-in" };
      },
    }),
    declarations: Object.freeze({
      // "open", "locked" or "missing"
      state: async (clientId, month) => {
        const item = find(clientId).declarations?.find((entry) => entry.declaration.month === month);
        return item ? stateOf(item.declaration) : "missing";
      },
    }),
    rows: Object.freeze({
      // [{ month, status, rows }] oldest month first; the rows of the table open in the page are the ones on screen.
      list: async (clientId, month = null) => {
        const client = find(clientId);
        const live = liveFor(clientId);
        const found = (client.declarations ?? []).map((entry) => entry.declaration).filter((declaration) => !declaration.archived && (!month || declaration.month === month));
        const result = [];
        for (const declaration of found.sort((a, b) => a.month.localeCompare(b.month))) {
          const rows = live?.month === declaration.month ? live.rows : (await loadDeclaration(client.directory, declaration.month)).draft.rows;
          result.push({ month: declaration.month, status: stateOf(declaration), rows });
        }
        return result;
      },
    }),
    intake: Object.freeze({
      // { entries, lockedThrough, declarations } for the duplicate search: every active row of every declaration, the open table as on screen.
      context: async (clientId) => {
        const client = find(clientId);
        const live = liveFor(clientId);
        const context = await loadIntakeContext(client.directory, { skipMonths: live ? [live.month] : [] });
        const entries = [...context.entries];
        live?.rows.forEach((row, position) => { if (row.active !== false) entries.push(entryFromRow(row, { month: live.month, position })); });
        return { entries, lockedThrough: context.lockedThrough, declarations: context.declarations };
      },
    }),
    rules: Object.freeze({
      read: (clientId) => readRules(find(clientId).directory),
    }),
    tables: Object.freeze({
      copyBeforeAgent: (clientId, month, now) => backupTable(find(clientId), month, now),
    }),
  });
}
