// Steps of checking declarations against the ledger without any DOM: prepare (read + compare) and commit (add rows).
import { readEffectiveChart } from "./chart-of-accounts.js";
import { createDeclaration, listDeclarations, loadDeclaration, saveDraft } from "./declaration-store.js";
import { buildImportedRows, markOtherMonthRows } from "./excel-import.js";
import { readLedgerFile } from "./ledger-rows.js";
import { ledgerOperations, reconcile } from "./ledger-reconcile.js";

const NOTE = "נוסף מהכרטסת";

// `client` is { directory, config: { clientId } }. A missing operation can be added when its class has a code in the client's
// chart and its declaration is open (or does not exist yet and is created). openMonth: the month shown in the page (step 9.7): everything
// chosen is added to it, whatever its date, and only a class without a code stops an operation.
export async function prepareReconcile(file, { dataRoot, client, reserved = {}, loadLibrary, loadPdf, openMonth = null } = {}) {
  const chart = await readEffectiveChart(dataRoot, client.directory, client.config.clientId, reserved);
  const ledger = await readLedgerFile(file, { loadLibrary, loadPdf });
  const declarations = [];
  for (const { declaration } of await listDeclarations(client.directory)) {
    if (!declaration.month.startsWith(`${ledger.year}-`)) continue;
    const loaded = await loadDeclaration(client.directory, declaration.month);
    declarations.push({ ...loaded, month: declaration.month, status: declaration.status, rows: loaded.draft.rows });
  }
  const operations = ledgerOperations(ledger);
  const result = reconcile(operations, declarations, chart);
  const known = new Set(Object.values(chart).map((account) => account.name));
  const byMonth = new Map(declarations.map((item) => [item.month, item]));
  const missing = result.missing.map((operation) => {
    const target = byMonth.get(operation.month);
    const unknown = !known.has(operation.name);
    if (openMonth) return { ...operation, problem: unknown ? "unknown-class" : null, creates: false, otherMonth: operation.month !== openMonth };
    return { ...operation, problem: unknown ? "unknown-class" : target && target.status !== "open" ? "locked" : null, creates: !target };
  });
  return { chart, year: ledger.year, operations: operations.length, matched: result.matched, missing, extra: result.extra, openMonth };
}

async function backupDraft(directory, draft, now) {
  const writable = await (await directory.getFileHandle(`draft-table.before-ledger-${now.replace(/[:.]/g, "-")}.json`, { create: true })).createWritable();
  try {
    await writable.write(JSON.stringify(draft, null, 2));
  } finally {
    await writable.close();
  }
}

const parsedRow = (operation) => ({
  kind: operation.income ? "income" : operation.net < 0 ? "credit" : "expense",
  net: operation.net,
  vat: operation.vat,
  gross: operation.gross,
  date: operation.date,
  details: operation.details,
  classificationName: operation.name,
  reference1: operation.ref1,
});

// `selected` holds the indexes of prepared.missing to add. Each declaration is saved once, after a copy of its old table.
export async function commitReconcile(prepared, { selected, client, now = new Date().toISOString() }) {
  const chosen = prepared.missing.filter((operation, index) => selected.has(index) && !operation.problem);
  const codes = Object.fromEntries(Object.entries(prepared.chart).map(([code, account]) => [account.name, code]));
  const monthOf = (operation) => prepared.openMonth ?? operation.month;
  const months = [...new Set(chosen.map(monthOf))].sort();
  for (const month of months) {
    let target;
    try {
      target = await loadDeclaration(client.directory, month);
    } catch (error) {
      if (error.name !== "NotFoundError") throw error;
      target = { ...(await createDeclaration(client.directory, { clientId: client.config.clientId, month })), draft: { rows: [] } };
    }
    if (target.declaration.status !== "open") throw new Error(`ההצהרה ${month} נעולה. לא ניתן להוסיף אליה שורות.`);
    const built = buildImportedRows(chosen.filter((operation) => monthOf(operation) === month).map(parsedRow), codes, { now })
      .map((row) => ({ ...row, agentOpinion: NOTE, statusText: NOTE }));
    const added = markOtherMonthRows(built, month);
    if (target.draft.rows.length) await backupDraft(target.directory, target.draft, now);
    await saveDraft(target.directory, target.declaration, [...target.draft.rows, ...added], now);
  }
  return { added: chosen.length, months };
}
