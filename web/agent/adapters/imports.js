// The backend of prepare_import (docs/AGENT_TOOLS.md, 5.6): runs the read-only preparer of the existing import wizard on an inbox
// file and boils the result down to what the model may see (counts and check results) and what the card shows to the user (the
// same, plus the totals). Nothing here writes: only the preparers (`prepareImport`, `prepareLedger`, `prepareReconcile`) and
// `inspectImportTarget` are used, never a commit function.
import { prepareImport } from "../../excel-import-flow.js";
import { inspectImportTarget } from "../../excel-import-store.js";
import { prepareLedger } from "../../ledger-codes-flow.js";
import { prepareReconcile } from "../../ledger-reconcile-flow.js";
import { readLedgerFile as readOperationsLedger } from "../../ledger-rows.js";

export class ImportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ImportError";
    this.code = code; // wrong_format
  }
}

// The errors of the parser that mean "this is not a journal" (the others are things the wizard lets the user look at).
const STRUCTURAL = new Set(["no-header", "no-rows"]);

// [{ code, severity, count, key? }]: the parser's errors and warnings, one entry per code (and footer key).
function groupProblems(prepared) {
  const groups = new Map();
  const add = (item, severity) => {
    const id = `${severity}|${item.code}|${item.key ?? ""}`;
    const group = groups.get(id) ?? { code: item.code, severity, count: 0, ...(item.key ? { key: item.key } : {}) };
    group.count += item.count ?? 1;
    groups.set(id, group);
  };
  for (const error of prepared.errors) add(error, "error");
  for (const warning of prepared.warnings) add(warning, "warning");
  return [...groups.values()];
}

// loadLibrary: loads SheetJS, loadPdf: pdf.js (tests pass their own). Built so far: journal (4.7.2), ledger_codes (4.7.3),
// ledger_check (4.7.4).
export function createImportReader({ loadLibrary, loadPdf } = {}) {
  async function journal(file, { dataRoot, client, reserved, month }) {
    let prepared;
    try {
      prepared = await prepareImport(file, { dataRoot, reserved, loadLibrary, clientId: client.config.clientId, clientDirectory: client.directory });
    } catch (error) {
      throw new ImportError("wrong_format", error.message);
    }
    const structural = prepared.errors.find((error) => STRUCTURAL.has(error.code));
    if (structural) throw new ImportError("wrong_format", structural.message);

    const problems = groupProblems(prepared);
    const found = prepared.suggestedMonth || "";
    const target = found || month || "";
    if (month && found && month !== found) problems.push({ code: "month_differs", severity: "warning", count: 1 });
    if (target) {
      const state = await inspectImportTarget(client.directory, target);
      if (state.state === "closed") problems.push({ code: "month_locked", severity: "error", count: 1 });
      else if (state.state === "rows") problems.push({ code: "month_has_rows", severity: "warning", count: state.count });
    }
    const rowErrors = prepared.errors.filter((error) => error.row).length;
    const footer = prepared.errors.filter((error) => error.code.startsWith("footer-")).length;
    const checks = [
      { code: "header_found", ok: true },
      { code: "rows_found", ok: true, count: prepared.rows.length },
      { code: "row_values", ok: rowErrors === 0, ...(rowErrors ? { count: rowErrors } : {}) },
      { code: "footer_totals", ok: footer === 0, ...(footer ? { count: footer } : {}) },
      { code: "month_in_header", ok: Boolean(found) },
    ];
    if (Object.keys(prepared.suggested).length) problems.push({ code: "types_suggested", severity: "warning", count: Object.keys(prepared.suggested).length });
    return {
      summary: {
        rows: prepared.rows.length, known_accounts: Object.keys(prepared.codes).length, new_accounts: prepared.unknown.length,
        month: found || null, own_chart: prepared.chartScope === "client",
      },
      checks,
      problems,
      // For the card only; the model is not told the sums.
      totals: prepared.totals,
    };
  }

  // The classification-codes ledger of Rivhit (PDF or .xlsx): its codes become the client's own chart in the dialog; rows imported
  // from Excel are moved to the new codes there. Here only the plan is made (prepareLedger reads the declarations, writes nothing).
  async function ledgerCodes(file, { dataRoot, client, reserved }) {
    // An operations ledger has code headers too, so the reader of codes takes it (seen 17 October: the agent called the same file
    // ledger_check once and ledger_codes once, and the client's codes were replaced by the 21 codes that had movements). A file with
    // dated movements is refused here.
    const movements = await readOperationsLedger(file, { loadLibrary, loadPdf })
      .then((ledger) => ledger.blocks.reduce((sum, block) => sum + block.rows.length, 0), () => 0);
    if (movements) throw new ImportError("wrong_format", `This is an operations ledger with ${movements} dated movements, not a classification-codes ledger: use kind ledger_check.`);
    let prepared;
    try {
      prepared = await prepareLedger(file, { dataRoot, client, reserved, loadLibrary, loadPdf });
    } catch (error) {
      throw new ImportError("wrong_format", error.message);
    }
    const accounts = Object.keys(prepared.accounts).length;
    const { plan, skipped } = prepared;
    const problems = [];
    if (prepared.hadOwnChart) problems.push({ code: "replaces_own_chart", severity: "warning", count: 1 });
    if (skipped.length) problems.push({ code: "lines_skipped", severity: "warning", count: skipped.length });
    if (plan.unresolved.length) problems.push({ code: "rows_not_remapped", severity: "warning", count: plan.unresolved.length });
    if (plan.locked.length) problems.push({ code: "locked_months_not_remapped", severity: "warning", count: plan.locked.length });
    return {
      summary: { accounts, had_own_chart: prepared.hadOwnChart, rows_to_remap: plan.changed, months_to_remap: plan.months, month: null },
      checks: [
        { code: "codes_found", ok: true, count: accounts },
        { code: "all_lines_read", ok: skipped.length === 0, ...(skipped.length ? { count: skipped.length } : {}) },
        { code: "imported_rows_remapped", ok: plan.unresolved.length === 0 && plan.locked.length === 0 },
      ],
      problems,
      totals: null,
    };
  }

  // The operations ledger (a "כרטסת" with dated movements per code) against the declarations of its year: how many operations are in
  // the tables, how many are missing and could be added in the dialog. prepareReconcile only reads and compares.
  async function ledgerCheck(file, { dataRoot, client, reserved }) {
    let prepared;
    try {
      prepared = await prepareReconcile(file, { dataRoot, client, reserved, loadLibrary, loadPdf });
    } catch (error) {
      throw new ImportError("wrong_format", error.message);
    }
    const { missing, extra } = prepared;
    const count = (problem) => missing.filter((operation) => operation.problem === problem).length;
    const addable = missing.filter((operation) => !operation.problem);
    const problems = [];
    // Almost nothing found although the tables have rows in the months of the ledger: the ledger is probably of another client (seen
    // on 17 October: 14 of 224 found; the same file against the client the agent had offered: 220 of 224).
    const months = new Set(missing.map((operation) => operation.month));
    const rowsInMonths = prepared.matched + extra.filter((item) => months.has(item.month)).length;
    if (prepared.operations >= 10 && prepared.matched < prepared.operations * 0.2 && rowsInMonths >= 3) problems.push({ code: "maybe_other_client", severity: "error", count: 1 });
    if (missing.length) problems.push({ code: "operations_missing", severity: "warning", count: missing.length });
    if (count("unknown-class")) problems.push({ code: "missing_unknown_class", severity: "warning", count: count("unknown-class") });
    if (count("locked")) problems.push({ code: "missing_in_locked_month", severity: "warning", count: count("locked") });
    if (extra.length) problems.push({ code: "rows_not_in_ledger", severity: "warning", count: extra.length });
    return {
      summary: {
        year: prepared.year, operations: prepared.operations, matched: prepared.matched, missing: missing.length, can_add: addable.length,
        months_created: new Set(addable.filter((operation) => operation.creates).map((operation) => operation.month)).size, extra: extra.length, month: null,
      },
      checks: [
        { code: "operations_found", ok: true, count: prepared.operations },
        { code: "all_in_declarations", ok: missing.length === 0 && extra.length === 0 },
      ],
      problems,
      totals: null,
    };
  }

  return {
    // file: the File of the inbox entry. options: { kind, dataRoot, client, reserved, month }. Resolves with { summary, checks, problems, totals }.
    async prepare(file, options) {
      if (options.kind === "journal") return journal(file, options);
      if (options.kind === "ledger_codes") return ledgerCodes(file, options);
      if (options.kind === "ledger_check") return ledgerCheck(file, options);
      throw new ImportError("wrong_format", `The kind ${options.kind} is not available yet.`);
    },
  };
}
