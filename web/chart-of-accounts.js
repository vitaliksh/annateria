// Per-root chart of accounts for imported journals: classification name -> code and VAT treatment, with optional
// per-client types ({ clientId: type } in `clientTypes`) where a client's Rivhit treats a class differently.
// Stored as common/chart-of-accounts.json next to custom-rivhit-mapping.json (docs/EXCEL_IMPORT_SPEC.md).
const filename = "chart-of-accounts.json";
export const ACCOUNT_TYPES = ["income", "expense", "outsideVatBase", "equipment"];

// Seeded from the Rivhit classification ledger of the migrated client; only codes seen in the data.
export const SEED_CHART_OF_ACCOUNTS = Object.freeze({
  160: { name: "הכנסות", type: "income" },
  202: { name: "משרדיות", type: "expense" },
  203: { name: "אחזקה", type: "expense" },
  204: { name: "חשמל", type: "expense" },
  205: { name: "ארנונה", type: "outsideVatBase" },
  206: { name: "ביטוח עסק", type: "outsideVatBase" },
  207: { name: "טלפון", type: "expense" },
  208: { name: "טלפון סלולרי", type: "expense" },
  212: { name: "השתלמות וספרות", type: "expense" },
  213: { name: "כיבוד", type: "expense" },
  215: { name: "נסיעות", type: "expense" },
  216: { name: "מים", type: "expense" },
  217: { name: "רכב רשוי וביטוח", type: "expense" },
  218: { name: "אינטרנט", type: "expense" },
  219: { name: 'הנה"ח', type: "expense" },
  223: { name: "שרות מקצועי", type: "expense" },
  224: { name: "פרסום", type: "expense" },
  229: { name: "טעינת רכב", type: "expense" },
  230: { name: "הוצאות רכב", type: "expense" },
  234: { name: "חניה פנגו", type: "expense" },
  900: { name: "רכישת ציוד/רכוש קבוע", type: "equipment" },
});

const validCode = (value) => /^\d{3}$/.test(String(value ?? ""));
const cleanName = (value) => String(value ?? "").replace(/[\t\r\n]+/g, " ").trim().slice(0, 120);

// Drops invalid entries, entries whose code is reserved, and later duplicates of a name.
export function normaliseChart(value, reserved = {}) {
  const accounts = {};
  const names = new Set();
  for (const [code, account] of Object.entries(value?.accounts ?? {})) {
    const name = cleanName(account?.name);
    if (!validCode(code) || reserved[code] || !name || names.has(name) || !ACCOUNT_TYPES.includes(account?.type)) continue;
    accounts[code] = { name, type: account.type };
    const clientTypes = Object.fromEntries(
      Object.entries(account.clientTypes ?? {}).filter(([clientId, type]) => clientId && ACCOUNT_TYPES.includes(type) && type !== account.type),
    );
    if (Object.keys(clientTypes).length) accounts[code].clientTypes = clientTypes;
    names.add(name);
  }
  return accounts;
}

// One client's view of the chart: per-client types (Rivhit settings differ between clients) replace the default type.
export function chartForClient(accounts, clientId) {
  return Object.fromEntries(
    Object.entries(accounts).map(([code, account]) => [code, { name: account.name, type: account.clientTypes?.[clientId] ?? account.type }]),
  );
}

// Sets the type of an account for one client; the default type itself removes the client's override.
export function setClientType(accounts, code, clientId, type) {
  const account = accounts[code];
  if (!account || !clientId || !ACCOUNT_TYPES.includes(type)) throw new Error("קוד המיון או הסוג אינם תקינים.");
  const { [clientId]: _previous, ...others } = account.clientTypes ?? {};
  const clientTypes = type === account.type ? others : { ...others, [clientId]: type };
  const { clientTypes: _old, ...base } = account;
  return { ...accounts, [code]: Object.keys(clientTypes).length ? { ...base, clientTypes } : base };
}

export function addAccount(accounts, { code, name, type }, reserved = {}) {
  if (accounts[code]) throw new Error("קוד או שם החשבון אינם תקינים או כבר קיימים.");
  const result = normaliseChart({ accounts: { ...accounts, [code]: { name, type } } }, reserved);
  if (!result[code]) throw new Error("קוד או שם החשבון אינם תקינים או כבר קיימים.");
  return result;
}

// Names per type in the shape parseJournalGrid expects as `classTypes`.
export function classTypesFromChart(accounts) {
  const namesOf = (type) => Object.values(accounts).filter((account) => account.type === type).map((a) => a.name);
  return { income: namesOf("income"), equipment: namesOf("equipment"), outsideVatBase: namesOf("outsideVatBase") };
}

// Maps classification names to codes; `unknown` lists names the user still has to map.
export function matchClassNames(names, accounts) {
  const byName = new Map(Object.entries(accounts).map(([code, account]) => [account.name, code]));
  const codes = {};
  const unknown = [];
  for (const name of new Set(names)) {
    if (byName.has(name)) codes[name] = byName.get(name);
    else unknown.push(name);
  }
  return { codes, unknown };
}

async function readJson(directory, name) {
  return JSON.parse(await (await directory.getFileHandle(name)).getFile().then((file) => file.text()));
}

// Returns null when the root has no chart yet, so the import wizard can offer the seed.
export async function readChartOfAccounts(dataRoot, reserved = {}) {
  if (!dataRoot) return null;
  try {
    return normaliseChart(await readJson(await dataRoot.getDirectoryHandle("common"), filename), reserved);
  } catch (error) {
    if (error.name === "NotFoundError") return null;
    throw error;
  }
}

export async function saveChartOfAccounts(dataRoot, accounts, reserved = {}) {
  if (!dataRoot) throw new Error("יש לבחור תחילה תיקיית נתונים.");
  const normalised = normaliseChart({ accounts }, reserved);
  const common = await dataRoot.getDirectoryHandle("common", { create: true });
  const writable = await (await common.getFileHandle(filename, { create: true })).createWritable();
  try {
    await writable.write(JSON.stringify({ schemaVersion: 1, accounts: normalised }, null, 2));
  } finally {
    await writable.close();
  }
  return normalised;
}

// A client's own chart (Rivhit codes differ between clients) lives in the client folder and replaces the root chart.
const clientFilename = "classification-codes.json";

export function setAccountType(accounts, code, type) {
  if (!accounts[code] || !ACCOUNT_TYPES.includes(type)) throw new Error("קוד המיון או הסוג אינם תקינים.");
  return { ...accounts, [code]: { ...accounts[code], type } };
}

// Returns null when the client has no chart of its own.
export async function readClientChart(clientDirectory, reserved = {}) {
  if (!clientDirectory) return null;
  try {
    return normaliseChart(await readJson(clientDirectory, clientFilename), reserved);
  } catch (error) {
    if (error.name === "NotFoundError") return null;
    throw error;
  }
}

export async function saveClientChart(clientDirectory, accounts, { source = "ledger", reserved = {}, now = new Date().toISOString() } = {}) {
  if (!clientDirectory) throw new Error("יש לבחור תחילה לקוח.");
  const normalised = normaliseChart({ accounts }, reserved);
  const writable = await (await clientDirectory.getFileHandle(clientFilename, { create: true })).createWritable();
  try {
    await writable.write(JSON.stringify({ schemaVersion: 1, source, savedAt: now, accounts: normalised }, null, 2));
  } finally {
    await writable.close();
  }
  return normalised;
}

// The chart in effect for one client: its own chart, else the root chart with the client's types.
export async function readEffectiveChart(dataRoot, clientDirectory, clientId, reserved = {}) {
  const own = await readClientChart(clientDirectory, reserved);
  if (own) return own;
  return chartForClient((await readChartOfAccounts(dataRoot, reserved)) ?? {}, clientId);
}
