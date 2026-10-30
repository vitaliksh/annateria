// Loads the real index.html + app.js into jsdom. app.js is bundled in memory with a
// footer that exposes selected module-scope functions, so app.js itself stays untouched.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const exposed = [
  "applyRecord", "addPendingRecord", "restoreRow", "rowSnapshot", "recalculateRow", "manualAmountChanged",
  "displayDate", "displayedReference", "normalReference", "receivedAtText", "cellValue",
  "nextFreeClassificationCode", "applyBusinessRules", "loadCustomMapping", "showError", "activateDeclaration", "saveCurrentDraft",
  "appendSnapshots", "attachRowImages", "setRowImage", "openPhoto", "applyProposalToTable", "updateWorkspace",
];

async function bundleApp() {
  const footer = `\nglobalThis.__app = { ${exposed.join(", ")} };\n`;
  const result = await build({
    stdin: { contents: readFileSync(join(root, "app.js"), "utf8") + footer, resolveDir: root, sourcefile: "app.js" },
    bundle: true,
    format: "iife",
    write: false,
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

export async function loadApp({ businessKind = "" } = {}) {
  const html = readFileSync(join(root, "index.html"), "utf8").replace(/<script\b[^>]*><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://vitaliksh.github.io/ocr/" });
  const { window } = dom;
  window.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  window.URL.createObjectURL = () => "blob:test";
  window.eval(readFileSync(join(root, "config.js"), "utf8"));
  // The tests never talk to the real Worker (and jsdom has no modal dialogs for the login): no Worker is configured.
  window.ANNATERIA_API = "";
  window.eval(readFileSync(join(root, "rivhit-mapping.js"), "utf8"));
  const globalsBefore = new Set(Object.getOwnPropertyNames(window));
  window.eval(await bundleApp());
  // app.js runs as an ES module (strict mode) in a browser, where assigning to an undeclared variable throws. jsdom lets
  // it through and creates a global, so a forgotten `let` shows up here as a new window property.
  const leaked = Object.getOwnPropertyNames(window).filter((name) => !globalsBefore.has(name) && name !== "__app");
  if (leaked.length) throw new Error(`app.js created undeclared globals: ${leaked.join(", ")}`);
  if (businessKind) window.document.querySelector("#business-kind").value = businessKind;
  return { window, document: window.document, app: window.__app, rows: () => [...window.document.querySelectorAll("#records tr[data-document-id]")] };
}
