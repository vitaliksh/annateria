// "צילום חדש" on a row (the owner, 9 November 2026): retake-flow.js and the dialog of retake-ui.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { normalizeRecord } from "../agent/fact-record.js";
import { pickRecord, recordFacts, retakeChanges, rowFacts, saveRetakeImage } from "../retake-flow.js";
import { setupRetake } from "../retake-ui.js";
import { rawRecord } from "./agent-fixtures.mjs";
import { binaryDirectory, listPaths, putFile } from "./memory-binary-directory.mjs";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const blankRow = { values: ["", "202", "x", "Paper Shop", "512345679", "2002", "", "", "", "", "100", "100"], rawNet: "", rawVat: "", reference: "INV-2002", unreadable: ["amounts", "date"] };

test("a retake of a bad photo offers the values it read, and only those that are read and new are ticked", () => {
  const record = normalizeRecord(rawRecord());
  const changes = retakeChanges(rowFacts(blankRow), recordFacts(record));
  assert.deepEqual(changes.map((change) => [change.key, change.from, change.to, change.apply]), [
    ["date", "", "20/02/26", true],
    ["supplier", "Paper Shop", "Paper Shop", false],
    ["supplierId", "512345679", "512345679", false],
    ["reference", "INV-2002", "INV-2002", false],
    ["gross", "", "236.00", true],
    ["vat", "", "36.00", true],
  ]);
  const stillBad = recordFacts(normalizeRecord(rawRecord({ issues: ["amount_unclear"] })));
  assert.deepEqual([stillBad.gross, stillBad.vat], ["", ""], "a new photo that is still unreadable gives no guess either");
});

test("of several documents in the new photo, the one with the row's number, else the nearest total, is taken", () => {
  const a = normalizeRecord(rawRecord({ document_number: "X-1", total: 50, net: 42.37, vat: 7.63 }));
  const b = normalizeRecord(rawRecord({ document_number: "INV-2002" }));
  assert.equal(pickRecord([a, b], rowFacts(blankRow)), b);
  assert.equal(pickRecord([a], { reference: "", gross: "50.00" }), a);
  assert.equal(pickRecord([], rowFacts(blankRow)), null);
});

test("the new photo is the next original of the month; the old one stays", async () => {
  const month = binaryDirectory("2026-09");
  await putFile(month, "images/001.jpg", "old photo");
  const saved = await saveRetakeImage(month, new File(["new photo"], "IMG_2.JPG", { type: "image/jpeg" }));
  assert.deepEqual(saved, { imageFile: "002.jpg", imageIndex: 2 });
  assert.deepEqual(await listPaths(month), ["images/001.jpg", "images/002.jpg"]);
});

test("the dialog reads the new photo, shows old and new values, and applies only the ticked fields after a click", async () => {
  const { window } = new JSDOM(html, { url: "https://vitaliksh.github.io/annateria/" });
  window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  window.HTMLDialogElement.prototype.close = function close() { this.open = false; };
  const applied = [];
  const retake = setupRetake({
    document: window.document,
    read: async () => normalizeRecord(rawRecord()),
    apply: async (row, file, record, keys) => { applied.push({ row, name: file.name, keys }); },
  });
  const file = new window.File(["photo"], "retake.jpg", { type: "image/jpeg" });
  await retake.open("row-1", blankRow, file);
  const dialog = retake.dialog;
  assert.equal(dialog.open, true);
  const lines = [...dialog.querySelectorAll("tbody tr")];
  assert.deepEqual(lines.map((tr) => tr.dataset.key), ["date", "supplier", "supplierId", "reference", "gross", "vat"]);
  assert.equal(applied.length, 0, "nothing is applied before the click");
  lines.find((tr) => tr.dataset.key === "vat").querySelector("input").checked = false;
  dialog.querySelector("#retake-apply").click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(applied, [{ row: "row-1", name: "retake.jpg", keys: ["date", "gross"] }]);
  assert.equal(dialog.open, false);
});
