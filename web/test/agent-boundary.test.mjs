// The limits of the agent that docs/AGENT_TOOLS.md promises, checked from the outside: which tools exist, what `services`
// can do, what the tool files may import. A new tool or operation changes these lists on purpose (and needs the owner's OK).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultRegistry } from "../agent/index.js";
import { createServices } from "../agent/services.js";

const here = dirname(fileURLToPath(import.meta.url));
const agentDirectory = join(here, "..", "agent");
const doc = readFileSync(join(here, "..", "..", "docs", "AGENT_TOOLS.md"), "utf8");
// A tool name must not start with an action that changes or ends something (ready_to_close only reads); an operation of
// `services` must not contain such a word anywhere.
const FORBIDDEN_TOOL = /^(close|reopen|delete|archive|remove|finalize|unlock|lock|write|erase|clear|drop|save|create_client|edit_client|set_)/;
const FORBIDDEN_OPERATION = /close|reopen|delete|archive|remove|finalize|unlock|erase|clear|write|save/i;

// Tools of docs/AGENT_TOOLS.md that no step has built yet. Each step that builds one removes it from here.
const PENDING_TOOLS = [
  "add_rows", "extract_document", "facts_for", "get_client_context", "move_file_to_declaration",
  "query_rows", "read_document", "ready_to_close", "remember_rule", "run_report",
];

const documented = [...doc.matchAll(/^#### `([a-z_]+)`$/gm)].map((match) => match[1]);

test("the registry holds exactly the tools built so far", () => {
  assert.deepEqual(createDefaultRegistry().names(), ["ask_user", "find_client", "list_inbox", "propose_change"]);
});

test("the document and the registry cannot drift: every documented tool is built or pending, and nothing else exists", () => {
  assert.equal(documented.length, 14);
  assert.deepEqual([...createDefaultRegistry().names(), ...PENDING_TOOLS].sort(), [...documented].sort());
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
  assert.deepEqual(operations.sort(), ["clients.chart", "clients.list", "declarations.state", "inbox.readIndex", "tables.copyBeforeAgent"]);
  for (const operation of operations) assert.doesNotMatch(operation, FORBIDDEN_OPERATION, operation);
  assert.equal(Object.isFrozen(services) && Object.values(services).every(Object.isFrozen), true);
});

const imports = (file) => [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s+"([^"]+)"/g)].map((match) => match[1]);
const sources = (directory) => readdirSync(directory).filter((name) => name.endsWith(".js")).map((name) => join(directory, name));

test("tool files import only the error class and pure helpers: no store, no file access", () => {
  const allowed = new Set(["../errors.js", "../../intake-facts.js", "../../pcn-review.js", "../../row-calculations.js", "../../home-utilities.js", "../../reports.js", "../../month-format.js"]);
  const files = sources(join(agentDirectory, "tools")).filter((file) => !file.endsWith("index.js"));
  assert.ok(files.length >= 4);
  for (const file of files) for (const specifier of imports(file)) assert.ok(allowed.has(specifier), `${file} imports ${specifier}`);
});

test("only services.js reaches outside the agent folder; the loop and the registry see ./ files only", () => {
  const files = sources(agentDirectory).filter((file) => !file.endsWith("services.js"));
  for (const file of files) for (const specifier of imports(file)) assert.ok(specifier.startsWith("./"), `${file} imports ${specifier}`);
  assert.deepEqual(imports(join(agentDirectory, "services.js")).sort(), ["../bookkeeper-flow.js", "../chart-of-accounts.js", "../inbox-store.js"]);
});

test("no source of the agent touches the file API, the network or the DOM directly", () => {
  for (const file of [...sources(agentDirectory), ...sources(join(agentDirectory, "tools"))]) {
    const text = readFileSync(file, "utf8");
    for (const pattern of [/\bfetch\(/, /\bdocument\./, /\bwindow\./, /showDirectoryPicker|showOpenFilePicker|showSaveFilePicker/, /\.removeEntry\(/, /createWritable/]) {
      if (file.endsWith("run-log.js") && pattern.source === "createWritable") continue; // the run log is the one thing the loop writes
      assert.doesNotMatch(text, pattern, `${file} matches ${pattern}`);
    }
  }
});
