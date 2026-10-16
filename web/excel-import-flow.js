// Steps of the Excel import wizard without any DOM: prepare (read + parse + match) and commit (write).
import {
  SEED_CHART_OF_ACCOUNTS,
  addAccount,
  chartForClient,
  classTypesFromChart,
  matchClassNames,
  normaliseChart,
  readChartOfAccounts,
  readClientChart,
  saveChartOfAccounts,
  saveClientChart,
  setAccountType,
  setClientType,
} from "./chart-of-accounts.js";
import { buildImportedRows, importWarnings } from "./excel-import.js";
import { importRowsIntoDeclaration } from "./excel-import-store.js";
import { footerErrors, parseJournalGrid, suggestClassTypes } from "./excel-journal.js";
import { readJournalGrid } from "./excel-journal-reader.js";

const round2 = (value) => Math.round(value * 100) / 100;

const FOOTER_CODES = ["footer-missing", "footer-mismatch"];

// Class types as parseJournalGrid expects them, from { classification name: type }.
function classTypesOf(typesByName) {
  const namesOf = (type) => Object.keys(typesByName).filter((name) => typesByName[name] === type);
  return { income: namesOf("income"), equipment: namesOf("equipment"), outsideVatBase: namesOf("outsideVatBase") };
}

// The file's errors with the footer checks re-run for the given types ({ classification name: type }, every name of
// the file). Footer checks are skipped while rows have errors, as in parseJournalGrid.
export function recheckImport(prepared, typesByName) {
  const others = prepared.errors.filter((error) => !FOOTER_CODES.includes(error.code));
  if (!prepared.rows.length || others.some((error) => error.row)) return prepared.errors;
  return [...others, ...footerErrors(prepared.rows, prepared.footer, classTypesOf(typesByName))];
}

// `reserved` holds codes the chart must not use (built-in and custom Rivhit codes). `clientId` selects the client's
// own class types for the footer checks; `types` maps every known name of the file to that type. A client that has a
// chart of its own (loaded from its ledger) is imported against that chart, which `chartScope` reports.
export async function prepareImport(file, { dataRoot, reserved = {}, loadLibrary, clientId, clientDirectory } = {}) {
  const own = await readClientChart(clientDirectory, reserved);
  const existing = own ?? (await readChartOfAccounts(dataRoot, reserved));
  const chart = existing ?? normaliseChart({ accounts: SEED_CHART_OF_ACCOUNTS }, reserved);
  const clientChart = chartForClient(chart, clientId);
  const parsed = parseJournalGrid(await readJournalGrid(file, { loadLibrary }), { classTypes: classTypesFromChart(clientChart) });
  const { codes, unknown } = matchClassNames(parsed.rows.map((row) => row.classificationName), chart);
  const sum = (field) => round2(parsed.rows.reduce((total, row) => total + row[field], 0));
  const { month, year } = parsed.declarationMonth ?? {};
  const prepared = {
    chart,
    chartIsNew: existing === null,
    chartScope: own ? "client" : "root",
    codes,
    unknown,
    types: Object.fromEntries(Object.entries(codes).map(([name, code]) => [name, clientChart[code].type])),
    suggested: {},
    footer: parsed.footer,
    rows: parsed.rows,
    errors: parsed.errors,
    warnings: [...parsed.warnings, ...importWarnings(parsed.rows)],
    suggestedMonth: month ? `${year}-${String(month).padStart(2, "0")}` : "",
    totals: { net: sum("net"), vat: sum("vat"), gross: sum("gross") },
  };
  prepared.suggested = suggestTypes(prepared);
  return prepared;
}

// Class types ({ name: type }, only those that differ from the current ones) under which the footer of the file adds
// up, or {} when it already does or no assignment fits. A suggestion is kept only if recheckImport confirms it.
function suggestTypes(prepared) {
  if (!prepared.errors.some((error) => error.code === "footer-mismatch") || prepared.errors.some((error) => error.row)) return {};
  const current = Object.fromEntries(prepared.rows.map(({ classificationName: name }) => [name, prepared.types[name] ?? "expense"]));
  const found = suggestClassTypes(prepared.rows, prepared.footer, current);
  if (!found || recheckImport(prepared, found).length) return {};
  return Object.fromEntries(Object.entries(found).filter(([name, type]) => type !== current[name]));
}

// `newAccounts` is [{ name, code, type }] for every name in prepared.unknown; `typeChanges` is [{ name, type }] for
// known names whose type this client sees differently (stored for this client only). The chart is saved first:
// imported rows refer to its codes, and an extended chart is harmless if the import then fails.
export async function commitImport(prepared, { newAccounts = [], typeChanges = [], month, closeNow, replace = false, dataRoot, client, reserved = {}, now }) {
  const types = { ...prepared.types };
  for (const { name, type } of [...newAccounts, ...typeChanges]) types[name] = type;
  if (recheckImport(prepared, types).length) throw new Error("בקובץ יש שגיאות. לא ניתן לייבא.");
  let chart = prepared.chart;
  for (const account of newAccounts) chart = addAccount(chart, account, reserved);
  const own = prepared.chartScope === "client";
  for (const { name, type } of typeChanges) {
    chart = own ? setAccountType(chart, prepared.codes[name], type) : setClientType(chart, prepared.codes[name], client.config.clientId, type);
  }
  const { codes, unknown } = matchClassNames(prepared.rows.map((row) => row.classificationName), chart);
  if (unknown.length) throw new Error(`חסר קוד מיון עבור: ${unknown.join(", ")}`);
  const rows = buildImportedRows(prepared.rows, codes, { now });
  chart = own ? await saveClientChart(client.directory, chart, { reserved, now }) : await saveChartOfAccounts(dataRoot, chart, reserved);
  const declaration = await importRowsIntoDeclaration({
    clientDirectory: client.directory,
    clientId: client.config.clientId,
    month,
    rows,
    closeNow,
    replace,
    now,
  });
  return { declaration, chart, rowCount: rows.length };
}
