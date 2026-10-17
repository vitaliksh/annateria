// The limits of the agent that docs/AGENT_TOOLS.md promises, checked from the outside: which tools exist, what `services` can
// do, what each source file may import. A new tool or operation changes these lists on purpose (and needs the owner's OK).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultRegistry } from "../agent/index.js";
import { createServices } from "../agent/services.js";

const here = dirname(fileURLToPath(import.meta.url));
const webDirectory = join(here, "..");
const agentDirectory = join(webDirectory, "agent");
const doc = readFileSync(join(webDirectory, "..", "docs", "AGENT_TOOLS.md"), "utf8");

// A tool name must not start with an action that changes or ends something (ready_to_close only reads); an operation of
// `services` must not contain such a word anywhere.
const FORBIDDEN_TOOL = /^(close|reopen|delete|archive|remove|finalize|unlock|lock|write|erase|clear|drop|save|create_client|edit_client|set_)/;
const FORBIDDEN_OPERATION = /close|reopen|delete|archive|remove|finalize|unlock|erase|clear|write|save/i;

const BUILT_TOOLS = [
  "add_rows", "ask_user", "extract_document", "facts_for", "find_client", "get_client_context", "list_inbox", "move_file_to_declaration", "prepare_import", "propose_change",
  "query_rows", "read_document",
];
// Tools of docs/AGENT_TOOLS.md that no step has built yet. Each step that builds one moves it to BUILT_TOOLS.
const PENDING_TOOLS = ["ready_to_close", "run_report"];

const documented = [...doc.matchAll(/^#### `([a-z_]+)`$/gm)].map((match) => match[1]);

test("the registry holds exactly the tools built so far", () => {
  assert.deepEqual(createDefaultRegistry().names(), BUILT_TOOLS);
});

test("the document and the registry cannot drift: every documented tool is built or pending, and nothing else exists", () => {
  assert.equal(documented.length, 14);
  assert.deepEqual([...BUILT_TOOLS, ...PENDING_TOOLS].sort(), [...documented].sort());
});

test("no tool can close, reopen, delete, archive or write files; declarations are well formed for Gemini", () => {
  const registry = createDefaultRegistry();
  for (const name of registry.names()) assert.doesNotMatch(name, FORBIDDEN_TOOL, name);
  for (const name of PENDING_TOOLS) assert.doesNotMatch(name, FORBIDDEN_TOOL, name);
  for (const name of ["close_month", "delete_row", "reopen_declaration", "write_file", "archive_client", "save_rule"]) assert.match(name, FORBIDDEN_TOOL, `the guard itself: ${name}`);
  for (const declaration of registry.declarations()) {
    assert.match(declaration.name, /^[a-z_]+$/);
    assert.ok(declaration.description.length > 20, declaration.name);
    assert.equal(declaration.parameters.type, "OBJECT");
    for (const key of declaration.parameters.required ?? []) assert.ok(key in declaration.parameters.properties, `${declaration.name}.${key}`);
    assert.doesNotMatch(JSON.stringify(declaration.parameters), /additionalProperties/);
  }
});

test("`services` offers a fixed list of operations, none of which changes a declaration, deletes or closes anything", () => {
  const services = createServices({ getDataRoot: () => null, getClients: () => [] });
  const operations = Object.entries(services).flatMap(([group, members]) => Object.keys(members).map((name) => `${group}.${name}`));
  assert.deepEqual(operations.sort(), [
    "clients.aliases", "clients.chart", "clients.list", "clients.open", "clients.profile", "declarations.create", "declarations.state", "documents.inspect", "extraction.run",
    "files.copyToDeclaration", "files.moveOutOfInbox", "imports.prepare", "inbox.readIndex", "intake.context", "rows.append", "rows.attachImage", "rows.list", "rules.read",
    "tables.copyBeforeAgent",
  ]);
  for (const operation of operations) assert.doesNotMatch(operation, FORBIDDEN_OPERATION, operation);
  assert.equal(Object.isFrozen(services) && Object.values(services).every(Object.isFrozen), true);
});

const sources = (directory) => readdirSync(directory).filter((name) => name.endsWith(".js")).map((name) => join(directory, name));
const importsOf = (file) => [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s+"([^"]+)"/g)].map((match) => match[1]);
// Imports that leave the agent folder, as paths relative to web/.
const outsideImports = (file) => importsOf(file).map((specifier) => relative(webDirectory, join(dirname(file), specifier)).replaceAll("\\", "/")).filter((path) => path.startsWith("..") || !path.startsWith("agent/"));

const PURE = [
  "intake-facts.js", "pcn-review.js", "row-calculations.js", "home-utilities.js", "reports.js", "month-format.js", "month-distribution.js", "workspace-core.js",
  "row-builder.js", "rule-text.js", "client-alias.js",
];
const ALLOWED_OUTSIDE = {
  "agent/services.js": ["chart-of-accounts.js", "table-backup.js", "declaration-store.js", "inbox-store.js", "intake-facts.js", "intake-index.js", "rules-store.js", "aliases-store.js"],
  "agent/aliases.js": ["client-alias.js"],
  "agent/fact-record.js": ["intake-facts.js", "workspace-core.js"],
  "agent/facts.js": ["intake-facts.js", "home-utilities.js", "pcn-review.js"],
  "agent/adapters/documents.js": ["pdf-import.js"],
  "agent/adapters/imports.js": ["excel-import-flow.js", "excel-import-store.js", "ledger-codes-flow.js", "ledger-reconcile-flow.js", "ledger-rows.js", "income-report.js"],
};

test("every source of the agent imports outside its folder only what is listed here: tools and the loop see pure helpers or nothing, only services.js reaches the stores", () => {
  const files = [...sources(agentDirectory), ...sources(join(agentDirectory, "tools")), ...sources(join(agentDirectory, "adapters"))];
  assert.ok(files.length >= 20);
  for (const file of files) {
    const name = relative(webDirectory, file).replaceAll("\\", "/");
    const allowed = ALLOWED_OUTSIDE[name] ?? (name.startsWith("agent/tools/") ? PURE : []);
    for (const path of outsideImports(file)) assert.ok(allowed.includes(path), `${name} imports ${path}`);
  }
});

test("the pure helpers that tools may import really are pure: they import nothing but each other", () => {
  for (const name of PURE) for (const specifier of importsOf(join(webDirectory, name))) assert.ok(PURE.includes(specifier.replace("./", "")), `${name} imports ${specifier}`);
});

test("no source of the agent touches the network, a picker or a file directly; only the adapters use the browser's canvas", () => {
  const patterns = [/\bfetch\(/, /\bwindow\./, /showDirectoryPicker|showOpenFilePicker|showSaveFilePicker/, /\.removeEntry\(/, /createWritable/];
  for (const file of [...sources(agentDirectory), ...sources(join(agentDirectory, "tools")), ...sources(join(agentDirectory, "adapters"))]) {
    const text = readFileSync(file, "utf8");
    for (const pattern of patterns) {
      if (file.endsWith("run-log.js") && pattern.source === "createWritable") continue; // the run log is the one thing the loop writes
      assert.doesNotMatch(text, pattern, `${file} matches ${pattern}`);
    }
    if (!file.includes(`${join("agent", "adapters")}`)) assert.doesNotMatch(text, /(?<![\w-])document\.(createElement|querySelector|getElementById|body)/, `${file} touches the DOM`);
  }
});

// The names a source imports, as written between the braces of its import statements.
const importedNames = (file) => [...readFileSync(file, "utf8").matchAll(/import\s*\{([^}]*)\}\s*from/g)]
  .flatMap((match) => match[1].split(",").map((name) => name.trim().split(/\s+as\s+/)[0]).filter(Boolean));
// What commits an import or writes the files of the wizards: the agent only prepares (docs/AGENT_TOOLS.md, 5.6).
const WIZARD_WRITERS = /^(commit\w*|importRowsIntoDeclaration|finalizeDeclaration|save\w*Chart\w*|saveChartOfAccounts)$/;

test("prepare_import cannot commit an import: nothing in the agent imports a commit or chart-saving function of the wizards", () => {
  const files = [...sources(agentDirectory), ...sources(join(agentDirectory, "tools")), ...sources(join(agentDirectory, "adapters"))];
  for (const file of files) {
    for (const name of importedNames(file)) assert.doesNotMatch(name, WIZARD_WRITERS, `${relative(webDirectory, file)} imports ${name}`);
  }
  assert.deepEqual(importedNames(join(agentDirectory, "adapters", "imports.js")).sort(), ["inspectImportTarget", "prepareImport", "prepareLedger", "prepareReconcile", "readIncomeReportFile", "readLedgerFile"]);
});

test("the guard of the previous test would catch a commit", () => {
  for (const name of ["commitImport", "commitLedger", "commitReconcile", "importRowsIntoDeclaration", "saveClientChart", "saveChartOfAccounts"]) assert.match(name, WIZARD_WRITERS, name);
  for (const name of ["prepareImport", "inspectImportTarget", "readClientChart", "saveDraft"]) assert.doesNotMatch(name, WIZARD_WRITERS, name);
});

// rules.md gets only what the user confirmed (step 4.6): the page writes it at the click; the agent can only read it.
test("nothing in the agent can write rules.md or aliases.json: only the readers are imported, and no tool is a writer of them", () => {
  const files = [...sources(agentDirectory), ...sources(join(agentDirectory, "tools")), ...sources(join(agentDirectory, "adapters"))];
  for (const file of files) {
    const name = relative(webDirectory, file).replaceAll("\\", "/");
    for (const imported of importedNames(file)) assert.doesNotMatch(imported, /^(appendRule|saveRules|addAlias|removeAlias)$/, `${name} imports ${imported}`);
    for (const store of ["rules-store.js", "aliases-store.js"]) if (outsideImports(file).includes(store)) assert.equal(name, "agent/services.js", name);
  }
  assert.deepEqual(importedNames(join(agentDirectory, "services.js")).filter((item) => /(Rules?|Alias(es)?)$/.test(item)), ["readRules", "readAliases"]);
  assert.equal(createDefaultRegistry().names().includes("remember_rule"), false);
  assert.equal(documented.includes("remember_rule"), false);
});
