// Steps of loading a client's classification ledger without any DOM: prepare (read + plan) and commit (write).
import {
  chartForClient,
  readChartOfAccounts,
  readClientChart,
  saveClientChart,
} from "./chart-of-accounts.js";
import { listDeclarations, loadDeclaration, saveDraft } from "./declaration-store.js";
import { readLedgerFile } from "./ledger-chart.js";

const isImported = (row) => String(row.documentId ?? "").startsWith("import-");

// Rewrites the codes of rows imported from Excel from the old chart to the new one, matching classes by name. Rows
// whose class is unknown to either chart keep their code and are reported.
export function remapImportedRows(rows, fromChart, toChart) {
  const codeByName = Object.fromEntries(Object.entries(toChart).map(([code, account]) => [account.name, code]));
  const unresolved = new Set();
  let changed = 0;
  const result = rows.map((row) => {
    if (!isImported(row)) return row;
    const code = String(row.values?.[1] ?? "");
    const next = fromChart[code] ? codeByName[fromChart[code].name] : undefined;
    if (next === undefined) {
      unresolved.add(fromChart[code]?.name ?? code);
      return row;
    }
    if (next === code) return row;
    changed += 1;
    return { ...row, values: row.values.map((value, index) => (index === 1 ? next : value)) };
  });
  return { rows: result, changed, unresolved: [...unresolved] };
}

// What loading the chart would do to the declarations of the client: open ones are remapped, locked ones with imported
// rows are only reported.
export async function planRemap(clientDirectory, fromChart, toChart) {
  const plan = { declarations: [], changed: 0, unresolved: [], locked: [] };
  const unresolved = new Set();
  for (const { declaration } of await listDeclarations(clientDirectory)) {
    const loaded = await loadDeclaration(clientDirectory, declaration.month);
    if (!loaded.draft.rows.some(isImported)) continue;
    if (declaration.status !== "open") {
      plan.locked.push(declaration.month);
      continue;
    }
    const result = remapImportedRows(loaded.draft.rows, fromChart, toChart);
    result.unresolved.forEach((name) => unresolved.add(name));
    if (!result.changed) continue;
    plan.changed += result.changed;
    plan.declarations.push({ ...loaded, month: declaration.month, rows: result.rows });
  }
  plan.unresolved = [...unresolved];
  plan.months = plan.declarations.map((item) => item.month).sort();
  return plan;
}

async function backupDraft(directory, draft, now) {
  const stamp = now.replace(/[:.]/g, "-");
  const writable = await (await directory.getFileHandle(`draft-table.before-codes-${stamp}.json`, { create: true })).createWritable();
  try {
    await writable.write(JSON.stringify(draft, null, 2));
  } finally {
    await writable.close();
  }
}

// `client` is { directory, config: { clientId } }. Types known for this client carry over by class name.
export async function prepareLedger(file, { dataRoot, client, reserved = {}, loadLibrary, loadPdf } = {}) {
  const clientId = client.config.clientId;
  const root = (await readChartOfAccounts(dataRoot, reserved)) ?? {};
  const own = await readClientChart(client.directory, reserved);
  const previous = own ?? chartForClient(root, clientId);
  const typeByName = Object.fromEntries(Object.values(previous).map((account) => [account.name, account.type]));
  const ledger = await readLedgerFile(file, { loadLibrary, loadPdf, typeByName, reserved });
  return {
    accounts: ledger.accounts,
    skipped: ledger.skipped,
    previous,
    hadOwnChart: own !== null,
    plan: await planRemap(client.directory, previous, ledger.accounts),
  };
}

// `types` maps code -> type chosen in the dialog. Backups and remapped tables are written first, the chart last; the
// plan is computed in memory beforehand so a failure leaves the originals next to their copies.
export async function commitLedger(prepared, { types = {}, client, reserved = {}, now = new Date().toISOString() }) {
  const accounts = Object.fromEntries(
    Object.entries(prepared.accounts).map(([code, account]) => [code, { ...account, type: types[code] ?? account.type }]),
  );
  const plan = await planRemap(client.directory, prepared.previous, accounts);
  for (const item of plan.declarations) await backupDraft(item.directory, item.draft, now);
  for (const item of plan.declarations) await saveDraft(item.directory, item.declaration, item.rows, now);
  const chart = await saveClientChart(client.directory, accounts, { source: "ledger", reserved, now });
  return { chart, plan };
}
