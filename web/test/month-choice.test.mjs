// Step 9.5: the dialog that asks for a client and a month before the inbox opens from outside a month.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { setupMonthChoice } from "../month-choice.js";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const month = (value, archived = false) => ({ declaration: { month: value, archived } });

function setup(clients, current = null) {
  const { window } = new JSDOM(html);
  const dialog = window.document.querySelector("#month-choice-dialog");
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new window.Event("close")); };
  let empty = 0;
  const choice = setupMonthChoice({ dialog, getClients: () => clients, getCurrentClientId: () => current, onEmpty: () => { empty += 1; } });
  const q = (id) => dialog.querySelector(`#${id}`);
  return { window, dialog, choice, q, empty: () => empty };
}
const texts = (select) => [...select.options].map((option) => option.textContent);

test("lists the clients of the data root that have months, the current one first chosen, its months newest first", async () => {
  const clients = [
    { id: "a", clientName: "Alpha", parent: {}, declarations: [month("2026-09"), month("2026-10"), month("2026-08", true)] },
    { id: "b", clientName: "Beta", parent: {}, declarations: [month("2026-07")] },
    { id: "c", clientName: "No months", parent: {}, declarations: [] },
    { id: "d", clientName: "Outside", parent: null, declarations: [month("2026-07")] },
  ];
  const ui = setup(clients, "b");
  const pending = ui.choice.choose();
  assert.equal(ui.dialog.open, true);
  assert.deepEqual(texts(ui.q("month-choice-client")), ["Alpha", "Beta"]);
  assert.equal(ui.q("month-choice-client").value, "b");
  assert.deepEqual(texts(ui.q("month-choice-month")), ["07/2026"]);
  ui.q("month-choice-client").value = "a";
  ui.q("month-choice-client").dispatchEvent(new ui.window.Event("change"));
  assert.deepEqual(texts(ui.q("month-choice-month")), ["10/2026", "09/2026"], "an archived month is not offered");
  ui.q("month-choice-month").value = "2026-09";
  ui.q("month-choice-accept").click();
  assert.deepEqual(await pending, { clientId: "a", month: "2026-09" });
});

test("cancel resolves with null; without any client that has a month nothing opens and onEmpty is called", async () => {
  const ui = setup([{ id: "a", clientName: "Alpha", parent: {}, declarations: [month("2026-10")] }]);
  const pending = ui.choice.choose();
  ui.dialog.close();
  assert.equal(await pending, null);
  const none = setup([{ id: "c", clientName: "No months", parent: {}, declarations: [] }]);
  assert.equal(await none.choice.choose(), null);
  assert.equal(none.dialog.open, false);
  assert.equal(none.empty(), 1);
});
