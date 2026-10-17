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
