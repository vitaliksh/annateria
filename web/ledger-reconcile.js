// Compares the operations of the classification ledger with the rows of a client's declarations. The ledger is complete,
// the exported journals may miss operations (found at two real clients), so what the ledger has and the declarations lack
// can be added. Pure functions; the folder work is in ledger-reconcile-flow.js.
import { sectionType } from "./ledger-chart.js";

const round2 = (value) => Math.round(value * 100) / 100;
const cents = (value) => round2(value).toFixed(2);
const pad = (value) => String(value).padStart(2, "0");

// "20/01/26" (as the table shows dates) -> "2026-01-20"
function isoDate(display) {
  const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(String(display ?? ""));
  return match ? `20${match[3]}-${match[2]}-${match[1]}` : String(display ?? "");
}

const keyOf = (month, name, date, net, gross) => [month, name, date, cents(net), cents(gross)].join("|");
const withoutMonth = (key) => key.slice(key.indexOf("|") + 1);

// The ledger shows expenses negative and credits positive; the declarations keep expenses positive (VAT with the sign of
// the net). Income is the same in both.
export function ledgerOperations({ year, blocks }) {
  const operations = [];
  for (const block of blocks) {
    const income = sectionType(block.section) === "income";
    for (const row of block.rows) {
      const sign = income ? 1 : -1;
      const net = round2(sign * row.net);
      const gross = round2(sign * row.gross);
      const vat = round2((net < 0 ? -1 : 1) * Math.abs(row.vat));
      const month = `${year}-${pad(row.month)}`;
      operations.push({
        key: keyOf(month, block.name, row.date, net, gross),
        month, income, code: block.code, name: block.name, date: row.date, details: row.details, ref1: row.ref1, line: row.line, net, vat, gross,
      });
    }
  }
  return operations;
}

// declarations: [{ month, rows }] with rows in the draft-table format; chart: code -> { name }.
export function reconcile(operations, declarations, chart) {
  const pool = new Map();
  for (const { month, rows } of declarations) {
    for (const row of rows) {
      // A line of moved VAT (step 9.8) is no operation: its document is the source row in its own month.
      if (row.vatMovedFrom) continue;
      const values = row.values ?? [];
      const name = chart[String(values[1])]?.name ?? String(values[1]);
      const key = keyOf(month, name, isoDate(values[0]), Number(values[8]) || 0, Number(values[7]) || 0);
      if (!pool.has(key)) pool.set(key, []);
      pool.get(key).push({ month, date: isoDate(values[0]), name, details: String(values[3] || values[2] || ""), net: Number(values[8]) || 0, vat: Number(values[9]) || 0 });
    }
  }
  const unmatched = [];
  const matchedMonths = [];
  for (const operation of operations) {
    const candidates = pool.get(operation.key);
    if (candidates?.length) {
      matchedMonths.push(candidates.pop().month);
    } else {
      unmatched.push(operation);
    }
  }
  // An operation added to the open month (step 9.7) or moved keeps its date: it is found in any month of the ledger's year.
  const missing = [];
  for (const operation of unmatched) {
    const found = [...pool].find(([key, candidates]) => candidates.length && withoutMonth(key) === withoutMonth(operation.key));
    if (found) {
      matchedMonths.push(found[1].pop().month);
    } else {
      missing.push(operation);
    }
  }
  const extra = [...pool.values()].flat().sort((a, b) => a.month.localeCompare(b.month) || a.date.localeCompare(b.date));
  return { matched: matchedMonths.length, matchedMonths, missing, extra };
}

// Is the ledger probably another client's? Only the months in which the tables have rows can tell: there, almost no operation of the
// ledger is found. Months the books do not have yet say nothing (7 November 2026: after the first of six journals of a client, 36 of
// 36 operations of that month were found, and the 188 of the months not imported yet raised "another client's ledger").
export function suspectOtherClient({ matchedMonths, missing, extra }) {
  const booked = new Set([...matchedMonths, ...extra.map((row) => row.month)]);
  const matched = matchedMonths.length;
  const missingThere = missing.filter((operation) => booked.has(operation.month)).length;
  const rowsThere = matched + extra.length;
  return matched + missingThere >= 10 && matched < (matched + missingThere) * 0.2 && rowsThere >= 3;
}
