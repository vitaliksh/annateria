export const DECLARATION_SCHEMA_VERSION = 1;
export const DRAFT_TABLE_SCHEMA_VERSION = 1;

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function error(message) { return { valid: false, error: message }; }
function text(value) { return String(value ?? "").trim(); }
function validTimestamp(value) { return isoDatePattern.test(value) && !Number.isNaN(Date.parse(value)); }

export function declarationMonth(value) {
  if (typeof value === "string" && monthPattern.test(value)) return value;
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) return null;
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

export function createOpenDeclaration({ clientId, month = declarationMonth(new Date()), declarationId = crypto.randomUUID(), now = new Date().toISOString() } = {}) {
  const result = normalizeDeclaration({ schemaVersion: DECLARATION_SCHEMA_VERSION, declarationId, clientId, month, status: "open", archived: false, createdAt: now, updatedAt: now, closedAt: null, finalExport: null, historyAppendedAt: null });
  if (!result.valid) throw new Error(result.error);
  return result.declaration;
}

export function normalizeDeclaration(value) {
  if (!value || typeof value !== "object") return error("קובץ ההצהרה אינו תקין.");
  const declarationId = text(value.declarationId), clientId = text(value.clientId), month = text(value.month), status = text(value.status), createdAt = text(value.createdAt), updatedAt = text(value.updatedAt);
  if (!declarationId || !clientId || !declarationMonth(month) || !["open", "closed"].includes(status) || !validTimestamp(createdAt) || !validTimestamp(updatedAt)) return error("בקובץ ההצהרה חסרים נתונים או שיש בו ערכים לא חוקיים.");
  const closedAt = value.closedAt === null || value.closedAt === undefined || value.closedAt === "" ? null : text(value.closedAt);
  const finalExport = value.finalExport === null || value.finalExport === undefined || value.finalExport === "" ? null : text(value.finalExport);
  const historyAppendedAt = value.historyAppendedAt === null || value.historyAppendedAt === undefined || value.historyAppendedAt === "" ? null : text(value.historyAppendedAt);
  if (closedAt !== null && !validTimestamp(closedAt)) return error("תאריך סגירת ההצהרה אינו תקין.");
  if (historyAppendedAt !== null && !validTimestamp(historyAppendedAt)) return error("תאריך כתיבת ההיסטוריה אינו תקין.");
  const reopenLog = [];
  for (const entry of Array.isArray(value.reopenLog) ? value.reopenLog : []) {
    const at = text(entry?.at), reason = text(entry?.reason);
    if (!validTimestamp(at) || !reason) return error("יומן הפתיחה מחדש של ההצהרה אינו תקין.");
    reopenLog.push({ at, reason });
  }
  if (status === "open" && (closedAt || finalExport || historyAppendedAt)) return error("להצהרה פתוחה אסור להכיל נתוני סגירה.");
  if (status === "closed" && (!closedAt || !finalExport || !historyAppendedAt)) return error("להצהרה סגורה חסרים נתוני סגירה.");
  return { valid: true, declaration: { schemaVersion: DECLARATION_SCHEMA_VERSION, declarationId, clientId, month, status, archived: Boolean(value.archived), createdAt, updatedAt, closedAt, finalExport, historyAppendedAt, reopenLog } };
}

export function normalizeDraftTable(value, declarationId) {
  if (!value || typeof value !== "object") return error("קובץ טיוטת הטבלה אינו תקין.");
  const savedDeclarationId = text(value.declarationId), savedAt = text(value.savedAt);
  if (!savedDeclarationId || savedDeclarationId !== text(declarationId) || !validTimestamp(savedAt) || !Array.isArray(value.rows)) return error("טיוטת הטבלה אינה תואמת להצהרה או שאינה תקינה.");
  return { valid: true, draft: { schemaVersion: DRAFT_TABLE_SCHEMA_VERSION, declarationId: savedDeclarationId, savedAt, rows: value.rows } };
}

export function createDraftTable({ declarationId, rows = [], now = new Date().toISOString() } = {}) {
  const result = normalizeDraftTable({ schemaVersion: DRAFT_TABLE_SCHEMA_VERSION, declarationId, savedAt: now, rows }, declarationId);
  if (!result.valid) throw new Error(result.error);
  return result.draft;
}

export const NO_EXPORT_MARKER = "no-export";

// What the upload, lock and reopen buttons need: a data root, an open (or locked) declaration and a committed workspace.
export function declarationActions({ dataRoot, declaration, workspaceCommitted }) {
  const open = declaration?.status === "open";
  return { canStart: Boolean(dataRoot) && open, canClose: open && Boolean(workspaceCommitted), canReopen: declaration?.status === "closed" && Boolean(workspaceCommitted), open };
}

export function closeDeclaration(declaration, { finalExport, now = new Date().toISOString() } = {}) {
  const current = normalizeDeclaration(declaration);
  if (!current.valid) throw new Error(current.error);
  if (current.declaration.status !== "open") throw new Error("אפשר לסגור רק הצהרה פתוחה.");
  const result = normalizeDeclaration({ ...current.declaration, status: "closed", updatedAt: now, closedAt: now, finalExport, historyAppendedAt: now });
  if (!result.valid) throw new Error(result.error);
  return result.declaration;
}

// A locked (closed) declaration becomes open again; the reason is kept in reopenLog and the closing data is cleared.
export function reopenDeclaration(declaration, { reason, now = new Date().toISOString() } = {}) {
  const current = normalizeDeclaration(declaration);
  if (!current.valid) throw new Error(current.error);
  if (current.declaration.status !== "closed") throw new Error("אפשר לפתוח מחדש רק הצהרה נעולה.");
  const why = text(reason);
  if (!why) throw new Error("יש להזין סיבה לפתיחה מחדש.");
  const result = normalizeDeclaration({ ...current.declaration, status: "open", updatedAt: now, closedAt: null, finalExport: null, historyAppendedAt: null, reopenLog: [...current.declaration.reopenLog, { at: now, reason: why }] });
  if (!result.valid) throw new Error(result.error);
  return result.declaration;
}

export function setDeclarationArchived(declaration, archived, now = new Date().toISOString()) {
  const current = normalizeDeclaration(declaration);
  if (!current.valid) throw new Error(current.error);
  const result = normalizeDeclaration({ ...current.declaration, archived: Boolean(archived), updatedAt: now });
  if (!result.valid) throw new Error(result.error);
  return result.declaration;
}
