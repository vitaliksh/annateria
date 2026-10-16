import test from "node:test";
import assert from "node:assert/strict";
import { NO_EXPORT_MARKER, reopenDeclaration, closeDeclaration, declarationActions, createDraftTable, createOpenDeclaration, declarationMonth, normalizeDeclaration, normalizeDraftTable, setDeclarationArchived } from "../declaration-core.js";

const now = "2026-09-11T10:20:30.000Z";

test("создаёт открытую декларацию для календарного месяца", () => {
  const declaration = createOpenDeclaration({ clientId: "client-1", month: "2026-09", declarationId: "declaration-1", now });
  assert.equal(declaration.status, "open");
  assert.equal(declaration.month, "2026-09");
  assert.equal(declaration.closedAt, null);
});

test("месяц формируется по локальной дате и не принимает неверное значение", () => {
  assert.equal(declarationMonth(new Date(2026, 8, 1)), "2026-09");
  assert.equal(declarationMonth("2026-13"), null);
  assert.equal(declarationMonth("2026-09"), "2026-09");
});

test("отклоняет закрытую декларацию без следов финализации", () => {
  const result = normalizeDeclaration({ declarationId: "d", clientId: "c", month: "2026-09", status: "closed", createdAt: now, updatedAt: now });
  assert.equal(result.valid, false);
});

test("черновая таблица принадлежит только своей декларации", () => {
  const draft = createDraftTable({ declarationId: "d", rows: [{ values: [] }], now });
  assert.equal(normalizeDraftTable(draft, "d").valid, true);
  assert.equal(normalizeDraftTable(draft, "other").valid, false);
});

test("закрывает только открытую декларацию с финальным экспортом", () => {
  const open = createOpenDeclaration({ clientId: "client-1", month: "2026-09", declarationId: "declaration-1", now });
  const closed = closeDeclaration(open, { finalExport: "2026-09-12_11-00", now });
  assert.equal(closed.status, "closed"); assert.equal(closed.finalExport, "2026-09-12_11-00"); assert.throws(() => closeDeclaration(closed, { finalExport: "another", now }), /לסגור רק/);
});

test("архивирует декларацию без изменения её статуса", () => {
  const open = createOpenDeclaration({ clientId: "client-1", month: "2026-09", declarationId: "declaration-1", now });
  const archived = setDeclarationArchived(open, true, now);
  assert.equal(archived.archived, true); assert.equal(archived.status, "open");
  assert.equal(setDeclarationArchived(archived, false, now).archived, false);
});

test("closing without an export uses the no-export marker", () => {
  const open = createOpenDeclaration({ clientId: "client-1", month: "2026-09", declarationId: "declaration-1", now });
  const closed = closeDeclaration(open, { finalExport: NO_EXPORT_MARKER, now });
  assert.equal(closed.status, "closed");
  assert.equal(closed.finalExport, "no-export");
});

test("upload and close need an open declaration, not a Rivhit template", () => {
  const open = { status: "open" }, closed = { status: "closed" };
  assert.deepEqual(declarationActions({ dataRoot: {}, declaration: open, workspaceCommitted: {} }), { canStart: true, canClose: true, canReopen: false, open: true });
  assert.equal(declarationActions({ dataRoot: {}, declaration: open, workspaceCommitted: null }).canClose, false);
  assert.equal(declarationActions({ dataRoot: null, declaration: open, workspaceCommitted: {} }).canStart, false);
  assert.deepEqual(declarationActions({ dataRoot: {}, declaration: closed, workspaceCommitted: {} }), { canStart: false, canClose: false, canReopen: true, open: false });
  assert.equal(declarationActions({ dataRoot: {}, declaration: null, workspaceCommitted: {} }).canStart, false);
});

test("reopening a locked declaration needs a reason, clears the closing data and logs the reason", () => {
  const open = createOpenDeclaration({ clientId: "client-1", month: "2026-09", declarationId: "declaration-1", now });
  const locked = closeDeclaration(open, { finalExport: NO_EXPORT_MARKER, now });
  assert.throws(() => reopenDeclaration(open, { reason: "x", now }), /נעולה/);
  assert.throws(() => reopenDeclaration(locked, { reason: "  ", now }), /סיבה/);
  const later = "2026-09-20T08:00:00.000Z";
  const reopened = reopenDeclaration(locked, { reason: "late invoice", now: later });
  assert.equal(reopened.status, "open");
  assert.deepEqual([reopened.closedAt, reopened.finalExport, reopened.historyAppendedAt], [null, null, null]);
  assert.deepEqual(reopened.reopenLog, [{ at: later, reason: "late invoice" }]);
  const again = closeDeclaration(reopened, { finalExport: NO_EXPORT_MARKER, now: later });
  assert.equal(again.reopenLog.length, 1);
  assert.equal(normalizeDeclaration({ ...again, reopenLog: [{ at: "bad", reason: "x" }] }).valid, false);
});
