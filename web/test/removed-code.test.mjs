// Code that was removed on purpose must not come back, not even as a leftover call: a call to a function that no longer exists only
// fails when the line runs (step 0.3 left two in workspace.js that broke the Excel import and the transfer after the sidebar refresh).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const sources = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
  if (item.name === "node_modules" || item.name === "test" || item.name === "fonts") return [];
  const path = join(directory, item.name);
  return item.isDirectory() ? sources(path) : item.name.endsWith(".js") ? [path] : [];
});

const REMOVED = ["loadTemplateFromRoot", "clearTemplate", "X-Upload-Token", "webauthn", "DeviceRegistry", "navigator.credentials", "rivhit-export", "TELEGRAM_TRANSFER_API"];

test("no source of the page mentions an identifier that was removed on purpose", () => {
  const files = sources(web);
  assert.ok(files.length > 60);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const name of REMOVED) assert.equal(text.toLowerCase().includes(name.toLowerCase()), false, `${file} mentions ${name}`);
  }
});

test("the refresh after a user action only rescans the clients", () => {
  const text = readFileSync(join(web, "workspace.js"), "utf8");
  const line = text.split("\n").find((item) => item.includes("const refreshFromUserAction"));
  assert.ok(line.includes("await scanClientsFromRoot(); };"), line);
});

test("the menu \"ייבוא ובדיקות\" is gone (4.7.6): every import goes through the inbox, and every kind of prepare_import has a wizard", async () => {
  const html = readFileSync(join(web, "index.html"), "utf8");
  for (const id of ["add-documents-menu", "import-income-report", "import-excel", "check-ledger"]) {
    assert.equal(html.includes(`id="${id}"`), false, id);
    for (const file of sources(web)) assert.equal(readFileSync(file, "utf8").includes(`#${id}`), false, `${file} mentions #${id}`);
  }
  assert.ok(html.includes('id="empty-open-inbox"'), "the empty table points to the inbox");
  const app = readFileSync(join(web, "app.js"), "utf8");
  const map = app.match(/const wizard = \{([^}]+)\}\[card\.kind\]/)[1];
  const { default: prepareImport } = await import("../agent/tools/prepare-import.js");
  const kinds = prepareImport.schema.properties.kind.enum;
  assert.deepEqual(kinds, ["journal", "ledger_codes", "ledger_check", "income_report"]);
  for (const kind of kinds) assert.match(map, new RegExp(`\\b${kind}: \\w+`), kind);
  // The dialogs themselves stay: the cards open them, the codes dialog also opens from the client card.
  for (const id of ["excel-import-dialog", "ledger-codes-dialog", "ledger-check-dialog"]) assert.ok(html.includes(`id="${id}"`), id);
});
