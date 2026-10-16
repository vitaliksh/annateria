import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createDeclaration, finalizeDeclaration, loadDeclaration, saveDraft, saveSourceImage } from "../declaration-store.js";
import { binaryDirectory } from "./memory-binary-directory.mjs";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const NOW = "2026-10-07T10:00:00.000Z";
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const row = (id, date, gross, imageFile = "", code = "202") => ({
  documentId: id, imageIndex: imageFile ? 1 : 0, imageFile, receivedAt: NOW, active: true,
  values: [date, code, "ספק לדוגמה", "ספק לדוגמה", "", "1", "", gross.toFixed(2), (gross / 1.18).toFixed(2), (gross - gross / 1.18).toFixed(2), "100", "100"],
});

async function setup({ rows, october, beforeOpen, onBeforeWrite } = {}) {
  const { window } = new JSDOM(html, { url: "https://vitaliksh.github.io/ocr/" });
  Object.assign(globalThis, { document: window.document, window, Option: window.Option });
  const dialog = window.document.querySelector("#rows-move-dialog");
  dialog.showModal = () => { dialog.open = true; };
  const clientDirectory = binaryDirectory("client");
  const client = { directory: clientDirectory, config: { clientId: "c1", clientName: "Client A" } };
  const august = await createDeclaration(clientDirectory, { clientId: "c1", month: "2026-08" });
  await finalizeDeclaration({ clientDirectory, declarationDirectory: august.directory, declaration: august.declaration, finalExport: "excel-import", rows: [row("import-1", "10/08/26", 118)], now: NOW });
  const current = await createDeclaration(clientDirectory, { clientId: "c1", month: "2026-09" });
  await saveDraft(current.directory, current.declaration, rows ?? [row("p1", "23/09/26", 118, "001.jpg"), row("p2", "26/08/26", 236), row("p3", "05/10/26", 59, "", "110"), row("import-2", "14/05/26", 10)], NOW);
  await saveSourceImage(current.directory, "001.jpg", new Uint8Array([7]));
  if (october) {
    const next = await createDeclaration(clientDirectory, { clientId: "c1", month: "2026-10" });
    await saveDraft(next.directory, next.declaration, october, NOW);
  }
  const calls = { errors: [], saved: [], before: 0 };
  const { setupRowsMove } = await import("../rows-move-ui.js");
  const move = setupRowsMove({
    button: window.document.querySelector("#move-rows"),
    dialog,
    getContext: () => ({ client, month: "2026-09", isIncomeCode: (code) => code === "110" }),
    beforeOpen,
    onBeforeWrite: async () => { calls.before += 1; await onBeforeWrite?.(); },
    onSaved: async (result) => { calls.saved.push(result); },
    onError: (message) => calls.errors.push(message),
    now: () => new Date(2026, 9, 7),
  });
  const q = (id) => dialog.querySelector(`#${id}`);
  const selects = () => [...dialog.querySelectorAll("select[data-index]")];
  const byIndex = (index) => selects().find((select) => select.dataset.index === String(index));
  return { window, dialog, client, calls, move, q, selects, byIndex, current };
}

test("the dialog lists rows with a proposal other than their month first, with the proposed month selected", async () => {
  const { dialog, move, q, selects } = await setup();
  assert.equal(await move.open(), true);
  assert.equal(dialog.open, true);
  assert.match(q("rows-move-client").textContent, /Client A.*09\/2026/);
  assert.match(q("rows-move-summary").textContent, /מוצע להעביר 1 מתוך 4 שורות/);
  assert.match(q("rows-move-summary").textContent, /08\/2026 נעולים/);
  assert.deepEqual([...q("rows-move-list").querySelectorAll("select")].map((select) => select.dataset.index), ["2"]);
  assert.deepEqual(selects().map((select) => [select.dataset.index, select.value]).sort(), [["0", "2026-09"], ["1", "2026-09"], ["2", "2026-10"], ["3", "2026-09"]]);
  assert.equal(q("rows-move-run").textContent, "העברת 1 שורות");
  assert.equal(q("rows-move-rest").hidden, false);
  assert.match(q("rows-move-rest-title").textContent, /\(3\)/);
});

test("option labels mark this declaration and months that will be created; filed months are not offered", async () => {
  const { move, byIndex } = await setup();
  await move.open();
  const labels = [...byIndex(0).options].map((option) => option.textContent);
  assert.deepEqual(labels, ["09/2026 · הצהרה זו", "10/2026 (תיווצר)", "11/2026 (תיווצר)"]);
});

test("running the move writes the months, reports the result and hands the table back to the host", async () => {
  const { client, calls, move, q, byIndex } = await setup();
  await move.open();
  byIndex(0).value = "2026-10";
  byIndex(0).dispatchEvent(new window.Event("change"));
  assert.equal(q("rows-move-run").textContent, "העברת 2 שורות");
  q("rows-move-run").click();
  for (let i = 0; i < 50 && !calls.saved.length; i += 1) await settle();
  assert.equal(calls.before, 1);
  assert.deepEqual(calls.saved[0], { moved: 2, months: ["2026-10"] });
  assert.match(q("rows-move-summary").textContent, /הועברו 2 שורות להצהרות 10\/2026/);
  assert.deepEqual((await loadDeclaration(client.directory, "2026-10")).draft.rows.map((item) => item.documentId), ["p1", "p3"]);
  assert.deepEqual((await loadDeclaration(client.directory, "2026-09")).draft.rows.map((item) => item.documentId), ["p2", "import-2"]);
});

test("a row can be sent to a month by hand, and the VAT deduction warning follows the chosen month", async () => {
  const { move, q, byIndex } = await setup();
  await move.open();
  const note = () => byIndex(1).closest(".move-line").querySelector(".move-note").textContent;
  assert.match(note(), /התאריך בחודש שכבר הוגש/);
  assert.doesNotMatch(note(), /ניכוי/);
  const option = new window.Option("04/2027", "2027-04");
  byIndex(1).append(option);
  byIndex(1).value = "2027-04";
  byIndex(1).dispatchEvent(new window.Event("change"));
  assert.match(note(), /יותר מ‑6 חודשים/);
  assert.equal(q("rows-move-run").disabled, false);
});

test("income rows get no deduction warning", async () => {
  const { move, byIndex } = await setup({ rows: [row("inc", "26/08/26", 118, "", "110")] });
  await move.open();
  const select = byIndex(0);
  select.append(new window.Option("04/2027", "2027-04"));
  select.value = "2027-04";
  select.dispatchEvent(new window.Event("change"));
  assert.doesNotMatch(select.closest(".move-line").querySelector(".move-note").textContent, /ניכוי/);
});

test("offer opens only when some row belongs elsewhere; otherwise it stays closed", async () => {
  const quiet = await setup({ rows: [row("p1", "23/09/26", 118), row("import-2", "14/05/26", 10)] });
  assert.equal(await quiet.move.offer(), false);
  assert.notEqual(quiet.dialog.open, true);
  assert.deepEqual(quiet.calls.errors, []);
  const busy = await setup();
  assert.equal(await busy.move.offer(), true);
  assert.equal(busy.dialog.open, true);
});

test("opening by hand with nothing to propose still shows all rows, closed under one heading", async () => {
  const { dialog, move, q } = await setup({ rows: [row("p1", "23/09/26", 118)] });
  assert.equal(await move.open(), true);
  assert.equal(dialog.open, true);
  assert.equal(q("rows-move-list").children.length, 0);
  assert.equal(q("rows-move-rest").open, true);
  assert.match(q("rows-move-summary").textContent, /לכל 1 השורות יש חודש מתאים/);
  assert.equal(q("rows-move-run").disabled, true);
});

test("a refusal from the host keeps the dialog closed and is reported only for a manual open", async () => {
  const { dialog, calls, move } = await setup({ beforeOpen: async () => "ממתינים לסיום עיבוד של 2 תמונות." });
  assert.equal(await move.open(), false);
  assert.deepEqual(calls.errors, ["ממתינים לסיום עיבוד של 2 תמונות."]);
  assert.equal(await move.offer(), false);
  assert.equal(calls.errors.length, 1);
  assert.notEqual(dialog.open, true);
});

test("a failed move shows the error, keeps the button usable and still lets the host reload the table", async () => {
  const { calls, move, q, client } = await setup();
  await move.open();
  const loaded = await loadDeclaration(client.directory, "2026-09");
  await saveDraft(loaded.directory, loaded.declaration, loaded.draft.rows.slice(1), NOW);
  q("rows-move-run").click();
  for (let i = 0; i < 50 && !calls.saved.length; i += 1) await settle();
  assert.match(q("rows-move-error").textContent, /הטבלה השתנתה/);
  assert.deepEqual(calls.saved, [null]);
  assert.equal(q("rows-move-run").disabled, false);
});

test("moving a row next to an identical one in the target month shows a duplicate warning", async () => {
  const { move, byIndex } = await setup({ rows: [row("p3", "05/10/26", 59), row("p4", "23/09/26", 118)], october: [row("twin", "05/10/26", 59)] });
  await move.open();
  const note = (index) => byIndex(index).closest(".move-line").querySelector(".move-note").textContent;
  assert.equal(byIndex(0).value, "2026-10");
  assert.match(note(0), /בהצהרה 10\/2026 כבר יש שורה עם אותו תאריך, קוד וסכום/);
  assert.doesNotMatch(note(1), /כבר יש שורה/);
});
