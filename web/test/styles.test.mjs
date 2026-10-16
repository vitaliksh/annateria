import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((match) => match[1]);
const css = Object.fromEntries(sheets.map((name) => [name, readFileSync(join(root, name), "utf8")]));

test("the page loads tokens and base first and the shell last", () => {
  assert.equal(sheets[0], "tokens.css");
  assert.equal(sheets[1], "base.css");
  assert.equal(sheets.at(-1), "shell.css");
});

test("every var(--token) used in a stylesheet is defined in tokens.css", () => {
  const defined = new Set([...css["tokens.css"].matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
  for (const [name, text] of Object.entries(css)) {
    for (const [, token] of text.matchAll(/var\((--[a-z0-9-]+)/g)) assert.ok(defined.has(token), `${name} uses undefined ${token}`);
  }
});

test("colours live in tokens.css only", () => {
  for (const [name, text] of Object.entries(css)) {
    if (name === "tokens.css") continue;
    assert.deepEqual(text.match(/#[0-9a-fA-F]{3,8}\b/g) || [], [], `${name} has a hard-coded colour`);
  }
});

test("the shell has the top bar, a scrolling workspace and a status bar with the ids app.js expects", () => {
  const shell = html.slice(html.indexOf('<div class="app-shell">'), html.indexOf('<div id="report-print"'));
  for (const id of ["open-workspaces-drawer", "current-client", "declaration-badge", "stop-processing", "open-reports", "start", "import-excel", "close-declaration", "reopen-declaration", "create-pdf", "inactive", "active", "journal-title", "count", "records", "upload-requirements", "status", "breadcrumb", "clients-view", "client-view", "journal-view", "import-pdf-menu", "reports-view", "nav-reports"]) {
    assert.ok(shell.includes(`id="${id}"`), id);
  }
  assert.match(shell, /<header class="topbar">/);
  assert.match(shell, /<main class="workspace">/);
  assert.match(shell, /<footer class="statusbar">/);
  assert.match(html, /<title>ANNATERIA<\/title>/);
});
