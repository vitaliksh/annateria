// Runs the bookkeeper agent on the rows of the open table that wait for it, without any DOM: builds the request from the
// rows, the facts of intake-facts.js and the client's own chart, calls the agent through a host function and turns every
// answer into a plan the host applies. What the code decides (a duplicate, a previous year) is decided here from the
// facts, not by the model. Nothing here changes a table: the host applies the plans.
import { chartForClient, readClientChart } from "./chart-of-accounts.js";
import { loadDeclaration } from "./declaration-store.js";
import { entryFromRow, intakeFacts } from "./intake-facts.js";
import { loadIntakeContext } from "./intake-index.js";
import { formatMonth } from "./month-format.js";

export const BATCH_SIZE = 40;

const DEDUCTION_NOTES = {
  check: "לניכוי המע״מ: חלפו 6 חודשים מתאריך המסמך — לבדוק",
  late: "לניכוי המע״מ: חלפו יותר מ‑6 חודשים מתאריך המסמך — לבדוק מול רואה החשבון",
};

// The table is copied before the agent changes it, like before an import or a move.
export async function backupTable(client, month, now = new Date().toISOString()) {
  const { directory, draft } = await loadDeclaration(client.directory, month);
  const handle = await directory.getFileHandle(`draft-table.before-agent-${now.replace(/[:.]/g, "-")}.json`, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(JSON.stringify(draft, null, 2));
  } finally {
    await writable.close();
  }
}

// Every active row of the other declarations plus the rows of the open table (which may not be saved yet).
async function intakeContext(client, month, snapshots) {
  const context = await loadIntakeContext(client.directory, { skipMonths: [month] });
  const own = snapshots.flatMap((snapshot, position) => (snapshot.active === false ? [] : [entryFromRow(snapshot, { month, position })]));
  return { entries: [...context.entries, ...own], lockedThrough: context.lockedThrough };
}

const candidateOf = (snapshots, index, month) => ({
  row: snapshots[index],
  month,
  position: index,
  periodFrom: snapshots[index].periodFrom ?? "",
  periodTo: snapshots[index].periodTo ?? "",
});

// Facts about one row again, for example after the user corrected its date.
export async function recheckIntake({ client, month, snapshots, index, today = new Date() }) {
  const { entries, lockedThrough } = await intakeContext(client, month, snapshots);
  return intakeFacts(candidateOf(snapshots, index, month), { entries, lockedThrough, today });
}

// One row as the agent receives it. n is the position in the table plus one. Amounts are the source amounts.
export function agentRow(snapshot, n, facts) {
  const values = snapshot.values ?? [];
  const net = Number(snapshot.rawNet) || 0;
  const vat = Number(snapshot.rawVat) || 0;
  const hasSource = net !== 0 || vat !== 0;
  const shown = (column) => Number(values[column]) || 0;
  return {
    n,
    document_kind: snapshot.documentKind ?? "",
    document_title: snapshot.documentTitle ?? "",
    date: String(values[0] ?? ""),
    supplier_name: String(values[3] ?? ""),
    supplier_vat_id: String(values[4] ?? ""),
    reference: String(snapshot.reference || values[5] || ""),
    purpose: String(values[2] ?? ""),
    total: hasSource ? net + vat : shown(7),
    net: hasSource ? net : shown(8),
    vat: hasSource ? vat : shown(9),
    period_from: snapshot.periodFrom ?? "",
    period_to: snapshot.periodTo ?? "",
    ocr_code: String(values[1] ?? ""),
    facts: { year: facts.year.status, duplicate: facts.duplicates.level, exclude: facts.exclude, deduction: facts.deduction },
  };
}

// The line shown for a row that the code itself excluded.
export function excludeText(facts, month) {
  if (facts.exclude === "previous-year") return `מסמך משנה קודמת (${facts.year.year ?? "?"}) — לבדוק את התאריך; אפשר לכלול ידנית`;
  const match = facts.duplicates.matches[0];
  if (!match) return "כפילות — המסמך כבר הוזן";
  if (match.month === month) return `כפילות של שורה ${match.position + 1} בהצהרה זו`;
  return `כפילות — המסמך כבר הוזן ב‑${formatMonth(match.month)}${match.status === "open" ? "" : " (הצהרה נעולה)"}`;
}

// What the host applies to one row. statusText is null when the row is an ordinary ready or review row (the host decides
// by its own rules); include is the final export flag; exclude is "duplicate", "previous-year" or "".
export function buildPlan(index, facts, result, month) {
  const decision = ["expense", "not_expense", "unclear"].includes(result?.decision) ? result.decision : "unclear";
  const rivhitCode = decision === "expense" && result?.rivhit_code ? String(result.rivhit_code) : null;
  const wouldInclude = decision === "expense" && Boolean(rivhitCode);
  const exclude = facts.exclude ?? "";
  const review = result?.needs_review !== false;
  let statusText = null;
  if (exclude) statusText = excludeText(facts, month);
  else if (decision === "not_expense") statusText = "לא הוצאה — נדרש אישור";
  else if (decision === "unclear") statusText = "נדרש עיון";
  else if (!rivhitCode) statusText = "נדרש קוד מיון";
  else if (review) statusText = "נדרש עיון";
  const reason = String(result?.reason ?? "").trim() || "לא נמסר הסבר מהסוכן.";
  const note = DEDUCTION_NOTES[facts.deduction] ?? "";
  return {
    index,
    decision,
    rivhitCode,
    reason: note ? `${reason} · ${note}` : reason,
    include: wouldInclude && !exclude,
    wouldInclude,
    exclude,
    review: Boolean(statusText),
    statusText,
    facts,
  };
}

// snapshots: every row of the open table in the draft-table format; waiting: positions of the rows to process.
// call(body) asks the agent and returns { results }; onBatch(plans) is awaited after every batch so that the host can
// apply it. Returns every plan. A failing call rejects: batches already applied stay applied.
export async function runBookkeeper({ client, month, snapshots, waiting, call, onBatch, reserved = {}, today = new Date() }) {
  const { entries, lockedThrough } = await intakeContext(client, month, snapshots);
  const own = await readClientChart(client.directory, reserved);
  const chart = own
    ? Object.entries(chartForClient(own, client.config?.clientId)).map(([code, account]) => ({ code, name: account.name, type: account.type }))
    : [];
  const factsOf = new Map(waiting.map((index) => [index, intakeFacts(candidateOf(snapshots, index, month), { entries, lockedThrough, today })]));
  const plans = [];
  for (let start = 0; start < waiting.length; start += BATCH_SIZE) {
    const batch = waiting.slice(start, start + BATCH_SIZE);
    const body = {
      client: { activity: client.config?.businessActivity ?? "", kind: client.config?.businessKind === "home" ? "home" : "office" },
      declarationMonth: month,
      chart,
      rows: batch.map((index) => agentRow(snapshots[index], index + 1, factsOf.get(index))),
    };
    const { results = [] } = await call(body);
    const made = batch.map((index) => buildPlan(index, factsOf.get(index), results.find((item) => item.n === index + 1), month));
    plans.push(...made);
    await onBatch?.(made);
  }
  return plans;
}
