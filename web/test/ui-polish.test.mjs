import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { addTitles, firstField, primaryAction, setupDialogs, setupMenuOpeners } from "../ui-polish.js";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8").replace(/<script\b[^>]*><\/script>/g, "");
const visible = (element) => !element.closest("[hidden]");
const page = () => new JSDOM(html, { url: "https://vitaliksh.github.io/ocr/" }).window;

test("the primary action of a dialog is its first enabled non-secondary footer button", () => {
  const { document } = page();
  assert.equal(primaryAction(document.querySelector("#confirm-dialog"), visible).id, "confirm-dialog-accept");
  assert.equal(primaryAction(document.querySelector("#new-client-dialog"), visible).id, "create-client");
  assert.equal(primaryAction(document.querySelector("#export-result-dialog"), visible), null);
  document.querySelector("#create-client").disabled = true;
  assert.equal(primaryAction(document.querySelector("#new-client-dialog"), visible), null);
});

test("in the import wizard the primary action follows the step", () => {
  const { document } = page();
  const dialog = document.querySelector("#excel-import-dialog");
  const idAt = (step) => { dialog.dataset.step = step; return primaryAction(dialog, visible)?.id || primaryAction(dialog, visible)?.textContent || null; };
  assert.equal(idAt("file"), null);
  assert.equal(idAt("check"), "excel-import-next");
  document.querySelector("#excel-import-run").disabled = false;
  assert.equal(idAt("month"), "excel-import-run");
  assert.equal(idAt("done"), "סגירה");
});

test("the first field of a dialog is its first visible input or select", () => {
  const { document } = page();
  assert.equal(firstField(document.querySelector("#new-client-dialog"), visible).id, "new-client-name");
  assert.equal(firstField(document.querySelector("#confirm-dialog"), visible), null);
  assert.equal(firstField(document.querySelector("#excel-import-dialog"), visible).id, "excel-import-file");
});

test("Enter in a field presses the primary action instead of closing the dialog; Enter on a checkbox does nothing", () => {
  const window = page();
  const { document } = window;
  setupDialogs(document, { visible });
  const dialog = document.querySelector("#new-client-dialog");
  let clicks = 0;
  document.querySelector("#create-client").addEventListener("click", () => { clicks += 1; });
  const press = (target) => {
    const event = new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(press(document.querySelector("#new-client-name")), true);
  assert.equal(clicks, 1);
  const wizard = document.querySelector("#excel-import-dialog");
  assert.equal(press(wizard.querySelector("#excel-import-close")), false);
  assert.equal(press(dialog.querySelector(".dialog-close")), false);
  assert.equal(clicks, 1);
});

test("a dialog that opens focuses its first field, or its primary button when it has none", async () => {
  const window = page();
  const { document } = window;
  setupDialogs(document, { visible });
  const wait = () => new Promise((resolve) => setTimeout(resolve, 20));
  document.querySelector("#new-client-dialog").setAttribute("open", "");
  await wait();
  assert.equal(document.activeElement.id, "new-client-name");
  document.querySelector("#confirm-dialog").setAttribute("open", "");
  await wait();
  assert.equal(document.activeElement.id, "confirm-dialog-accept");
});

test("icon buttons and navigation items get tooltips without overwriting existing ones", () => {
  const { document } = page();
  const close = document.querySelector("#new-client-dialog .dialog-close");
  assert.equal(close.hasAttribute("title"), false);
  document.querySelector("#open-workspaces-drawer").title = "custom";
  addTitles(document);
  assert.equal(close.title, "סגור");
  assert.equal(document.querySelector("#open-workspaces-drawer").title, "custom");
  assert.equal(document.querySelector("#nav-clients").title, "כל הלקוחות");
  assert.equal(document.querySelector("#open-settings").title, "הגדרות");
});

test("an open-menu button opens its menu", () => {
  const { document } = page();
  setupMenuOpeners(document);
  const menu = document.querySelector("#add-documents-menu");
  assert.equal(menu.open, false);
  document.querySelector("[data-open-menu]").click();
  assert.equal(menu.open, true);
});
