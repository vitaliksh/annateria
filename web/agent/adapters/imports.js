// The backend of prepare_import (docs/AGENT_TOOLS.md, 5.6): runs the read-only preparer of the existing import wizard on an inbox
// file and boils the result down to what the model may see (counts and check results) and what the card shows to the user (the
// same, plus the totals). Nothing here writes: only `prepareImport` and `inspectImportTarget` are used, never a commit function.
import { prepareImport } from "../../excel-import-flow.js";
import { inspectImportTarget } from "../../excel-import-store.js";

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

// loadLibrary: loads SheetJS (tests pass their own). Only the journal is built so far (step 4.7.2).
export function createImportReader({ loadLibrary } = {}) {
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

  return {
    // file: the File of the inbox entry. options: { kind, dataRoot, client, reserved, month }. Resolves with { summary, checks, problems, totals }.
    async prepare(file, options) {
      if (options.kind === "journal") return journal(file, options);
      throw new ImportError("wrong_format", `The kind ${options.kind} is not available yet.`);
    },
  };
}
