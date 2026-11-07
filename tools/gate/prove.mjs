// Proves the gate (M3): puts each bug of 6 November 2026 back into a copy of web/ and expects "Anna's day" to fail on it, and to
// pass on the copy without changes. The repository is not touched.
//
//   node tools/gate/prove.mjs
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB = join(REPOSITORY, "web");

// Each bug is the fixed line put back as it was before its fix (commits 53d57ac, b8dda50, 70eb56e).
const BUGS = [
  {
    name: "an undeclared name in the run of the assistant (53d57ac)",
    file: "app.js",
    from: "      scope: assistantScope(),",
    to: '      scope: view === "journal" && committedWorkspace && currentDeclaration ? { clientId: committedWorkspace.config.clientId, month: currentDeclaration.month } : null,',
  },
  {
    name: "the month opened by a click refused by the agent (b8dda50)",
    file: "agent/services.js",
    patch: "b8dda50",
  },
  {
    name: "a PDF above the request limit refused (70eb56e)",
    file: "agent/adapters/extraction.js",
    from: "      if (parts[0].bytes.length > MAX_INLINE_BYTES) {",
    to: '      if (parts[0].bytes.length > MAX_INLINE_BYTES) throw new ExtractionError("too_large", "The file is too large for one request.");\n      if (false) {',
  },
];

function copyWeb() {
  const folder = mkdtempSync(join(tmpdir(), "gate-web-"));
  cpSync(WEB, folder, { recursive: true, filter: (path) => !path.includes("node_modules") });
  return folder;
}

function day(web) {
  const run = spawnSync(process.execPath, [join(REPOSITORY, "tools", "gate", "anna-day.mjs")], { env: { ...process.env, LAB_WEB: web }, encoding: "utf8" });
  return { passed: run.status === 0, tail: run.stdout.split("\n").filter((line) => /FAILED|^- |passed/.test(line)).slice(0, 4).join(" | ") };
}

function plant(web, bug) {
  const path = join(web, bug.file);
  if (bug.patch) {
    // The fix of that commit, taken back in this file only.
    const diff = spawnSync("git", ["-C", REPOSITORY, "show", bug.patch, "--", `web/${bug.file}`], { encoding: "utf8" }).stdout;
    const applied = spawnSync("git", ["apply", "-R", "-p2", "-"], { cwd: web, input: diff, encoding: "utf8" });
    if (applied.status !== 0) throw new Error(`The fix of ${bug.patch} cannot be taken back any more: ${applied.stderr}`);
    return;
  }
  const text = readFileSync(path, "utf8");
  if (!text.includes(bug.from)) throw new Error(`The fixed line of "${bug.name}" is not in ${bug.file} any more.`);
  writeFileSync(path, text.replace(bug.from, bug.to));
}

let wrong = 0;
const clean = copyWeb();
const base = day(clean);
rmSync(clean, { recursive: true, force: true });
console.log(`${base.passed ? "ok  " : "BAD "} the page as it is: ${base.passed ? "passes" : `fails: ${base.tail}`}`);
if (!base.passed) wrong += 1;
for (const bug of BUGS) {
  const web = copyWeb();
  try {
    plant(web, bug);
    const result = day(web);
    console.log(`${result.passed ? "BAD " : "ok  "} ${bug.name}: ${result.passed ? "the gate PASSED it" : `fails: ${result.tail}`}`);
    if (result.passed) wrong += 1;
  } finally {
    rmSync(web, { recursive: true, force: true });
  }
}
process.exit(wrong ? 1 : 0);
