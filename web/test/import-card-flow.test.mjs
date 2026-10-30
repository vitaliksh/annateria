import test from "node:test";
import assert from "node:assert/strict";
import { NOT_ADDED, NOT_IMPORTED, watchWizard } from "../import-card-flow.js";

// A stand-in for the wizard's <dialog>: jsdom has no modal dialogs, and only `open` and the close event matter here.
function fakeDialog() {
  const dialog = new EventTarget();
  dialog.open = true;
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new Event("close")); };
  return dialog;
}

test("a wizard closed before it wrote tells the card that the file was not imported (the August case)", () => {
  const dialog = fakeDialog();
  const reports = [];
  const watch = watchWizard({ dialog, report: (item) => reports.push(item) });
  watch.opened();
  dialog.close();
  assert.deepEqual(reports, [{ text: NOT_IMPORTED, state: "unfinished" }]);
  dialog.close();
  assert.equal(reports.length, 1, "a later close of the same dialog belongs to another card");
});

test("a wizard that wrote says nothing more on close: the card already says it is done", () => {
  const dialog = fakeDialog();
  const reports = [];
  const watch = watchWizard({ dialog, report: (item) => reports.push(item) });
  watch.opened();
  watch.committed();
  dialog.close();
  assert.deepEqual(reports, []);
});

test("a wizard that never opened leaves its dialog alone", () => {
  const dialog = fakeDialog();
  dialog.open = false;
  const reports = [];
  watchWizard({ dialog, report: (item) => reports.push(item) }).opened();
  dialog.close();
  assert.deepEqual(reports, []);
});

test("the income report has no dialog: a cancelled confirmation says the rows were not added", () => {
  const reports = [];
  watchWizard({ report: (item) => reports.push(item) }).opened();
  assert.deepEqual(reports, [{ text: NOT_ADDED, state: "unfinished" }]);
  const done = [];
  const watch = watchWizard({ report: (item) => done.push(item) });
  watch.committed();
  watch.opened();
  assert.deepEqual(done, []);
});

test("the page tells every card how its wizard ended", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(source, /const watch = watchWizard\(/);
  assert.match(source, /watch\.committed\(\);/);
  assert.match(source, /watch\.opened\(\);/);
});
