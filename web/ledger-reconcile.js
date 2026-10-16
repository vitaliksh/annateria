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
      const values = row.values ?? [];
      const name = chart[String(values[1])]?.name ?? String(values[1]);
      const key = keyOf(month, name, isoDate(values[0]), Number(values[8]) || 0, Number(values[7]) || 0);
      if (!pool.has(key)) pool.set(key, []);
      pool.get(key).push({ month, date: isoDate(values[0]), name, details: String(values[3] || values[2] || ""), net: Number(values[8]) || 0, vat: Number(values[9]) || 0 });
    }
  }
  const missing = [];
  let matched = 0;
  for (const operation of operations) {
    const candidates = pool.get(operation.key);
    if (candidates?.length) {
      candidates.pop();
      matched += 1;
    } else {
      missing.push(operation);
    }
  }
  const extra = [...pool.values()].flat().sort((a, b) => a.month.localeCompare(b.month) || a.date.localeCompare(b.date));
  return { matched, missing, extra };
}
