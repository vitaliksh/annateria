// How often the client files its VAT return and its advances: every month or every two months.
export const REPORT_PERIODS = ["monthly", "bimonthly"];

// Optional tax profile of a client: the VAT dealer number, the income tax file number (kept as typed, trimmed), the
// business address printed on the reports (one line) and whether the client must produce a detailed PCN874 file.
// Empty values are left out, so old files read as before.
export function normalizeClientTaxProfile(value) {
  const profile = {};
  for (const key of ["vatId", "incomeTaxFileId"]) {
    const text = String(value?.[key] ?? "").trim().slice(0, 20);
    if (text) profile[key] = text;
  }
  const address = String(value?.address ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (address) profile.address = address;
  if (value?.pcnRequired === true) profile.pcnRequired = true;
  return profile;
}

// Soft check of a nine-digit tax number; returns "" when it looks fine. The VAT dealer number also has the check digit
// of the Israeli ID number, the income tax file number is only checked for its length.
export function taxIdProblem(text, { checkDigit = false } = {}) {
  const value = String(text ?? "").trim();
  if (!value) return "";
  if (!/^\d{9}$/.test(value)) return "המספר צריך להכיל 9 ספרות.";
  if (!checkDigit) return "";
  const sum = [...value].reduce((total, digit, index) => {
    const product = Number(digit) * (index % 2 ? 2 : 1);
    return total + (product > 9 ? product - 9 : product);
  }, 0);
  return sum % 10 === 0 ? "" : "ספרת הביקורת של המספר אינה תקינה.";
}

// The new name of a client from the menu: trimmed, not empty, and not the name of another client (the folder of the client keeps
// its name; only the name that is shown changes). clients: [{ id, clientName }].
export function checkClientRename(value, clients, clientId) {
  const clientName = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!clientName) return { valid: false, error: "יש למלא את שם הלקוח." };
  const taken = clients.some((other) => other.id !== clientId && String(other.clientName).trim().toLowerCase() === clientName.toLowerCase());
  return taken ? { valid: false, error: "כבר קיים לקוח בשם הזה." } : { valid: true, clientName };
}

export function normalizeWorkspaceConfig(value) {
  if (!value || typeof value !== "object") return { valid: false, error: "קובץ הגדרות הלקוח אינו תקין." };
  const clientName = String(value.clientName ?? "").trim();
  const businessActivity = String(value.businessActivity ?? "").trim();
  const businessKind = String(value.businessKind ?? "").trim();
  if (!clientName || !businessActivity || !["home", "office"].includes(businessKind)) return { valid: false, error: "בקובץ הגדרות הלקוח חסרים נתונים או שיש בו ערכים לא חוקיים." };
  const periods = Object.fromEntries(["vatPeriod", "advancesPeriod"].filter((key) => REPORT_PERIODS.includes(value[key])).map((key) => [key, value[key]]));
  return { valid: true, config: { schemaVersion: 1, clientId: String(value.clientId ?? ""), clientName, businessActivity, businessKind, archived: Boolean(value.archived), ...periods, ...normalizeClientTaxProfile(value) } };
}
