// `services`: the only way for an agent tool to reach data (docs/AGENT_TOOLS.md, sections 1 and 6). It offers reading: the inbox
// index, what is inside a file, the client's profile, chart, rules and rows, the intake context of the duplicate search, and
// the vision call of extraction; asking whether a declaration is open and copying a table before the agent writes; and the few things
// the agent may write: a new open declaration, rows into an open one, the image of those rows, and the move of an inbox original into
// the images of a declaration. It has no operation that closes, reopens, deletes or archives anything; a test lists its keys and
// fails when such a word appears.
// Tools do not import file stores: they only see what is here.
import { backupTable } from "../bookkeeper-flow.js";
import { readClientChart, readEffectiveChart } from "../chart-of-accounts.js";
import { createDeclaration, getDeclarationDirectory, listDeclarations, loadDeclaration, saveDraft } from "../declaration-store.js";
import { entryFromRow } from "../intake-facts.js";
import { loadIntakeContext } from "../intake-index.js";
import { copyToDeclarationImages, moveOutOfInbox, readInboxFile, readInboxIndex } from "../inbox-store.js";
import { readRules } from "../rules-store.js";
import { createDocumentReader } from "./adapters/documents.js";

// getDataRoot(): the data root handle (changes when the user picks another). getClients(): the workspace's active clients
// ({ id, clientName, directory, parent, entryName, config, declarations }). getLiveTable(): the table open in the page,
// { clientId, month, rows, append(snapshots) -> positions, attachImage({ fileHash, imageFile, imageIndex }) -> count, flush() } in the
// draft-table format, or null: its rows count as they are on screen, saved or not, and rows for that month are added through it.
// onDeclarationCreated(clientId, month) is told when a declaration was made (the sidebar must show it).
// builtInChart(): { code: { name, type } } used when neither the client nor the root has a chart. reserved(): codes a chart may
// not reuse. documents: reads inside files (adapters/documents.js). extraction: the vision call (adapters/extraction.js), or null.
export function createServices({ getDataRoot, getClients, getLiveTable = () => null, builtInChart = () => ({}), reserved = () => ({}), documents = createDocumentReader(), extraction = null, onDeclarationCreated = () => {} }) {
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
      list: () => homeClients().map((client) => ({ clientId: client.id, clientName: client.clientName, vatId: client.config?.vatId ?? "", folder: client.entryName })),
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
      // Makes an open declaration for a month that has none. Refuses a month that exists.
      create: async (clientId, month) => {
        const client = find(clientId);
        await createDeclaration(client.directory, { clientId: client.config.clientId ?? clientId, month });
        client.declarations = await listDeclarations(client.directory);
        onDeclarationCreated(clientId, month);
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
      // Adds rows (snapshots) at the end of an open table; resolves with their numbers in the table (1-based). The table open in the
      // page takes them through the page, any other goes straight into its draft file.
      append: async (clientId, month, snapshots) => {
        const live = liveFor(clientId);
        if (live?.month === month) return live.append(snapshots);
        const client = find(clientId);
        const { directory, declaration, draft } = await loadDeclaration(client.directory, month);
        await saveDraft(directory, declaration, [...draft.rows, ...snapshots]);
        return snapshots.map((_, index) => draft.rows.length + index + 1);
      },
      // Gives the rows made from one file their image; resolves with the number of rows that got it.
      attachImage: async (clientId, month, fileHash, image) => {
        const live = liveFor(clientId);
        if (live?.month === month) return live.attachImage({ fileHash, ...image });
        const client = find(clientId);
        const { directory, declaration, draft } = await loadDeclaration(client.directory, month);
        let count = 0;
        const rows = draft.rows.map((row) => {
          if (row.agent?.file !== fileHash) return row;
          count += 1;
          return { ...row, imageFile: image.imageFile, imageIndex: image.imageIndex };
        });
        if (count) await saveDraft(directory, declaration, rows);
        return count;
      },
    }),
    files: Object.freeze({
      // Copies an inbox original into the images of a declaration and reads the copy back: { imageFile, imageIndex }.
      copyToDeclaration: async (entry, clientId, month) => copyToDeclarationImages(dataRoot(), entry, await getDeclarationDirectory(find(clientId).directory, month)),
      // After the copy: the entry leaves the inbox index and the original leaves the inbox folder.
      moveOutOfInbox: (entry) => moveOutOfInbox(dataRoot(), entry),
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
      // The open table is saved first, so that the copy holds what is on screen.
      copyBeforeAgent: async (clientId, month, now) => {
        const live = liveFor(clientId);
        if (live?.month === month) await live.flush?.();
        return backupTable(find(clientId), month, now);
      },
    }),
  });
}
