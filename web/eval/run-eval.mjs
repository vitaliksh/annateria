// npm run eval [-- --case name,name] [--repeat 2] [--model id] [--out folder]
// Runs the cases of eval/cases against the real model through the Worker, as the page does, and prints what passed. The access
// code comes from the environment variable ANNATERIA_CODE (typed by the owner in his terminal); it and the token stay in this
// process. Every run costs money on the paid tier, so this is never part of npm test or CI. The report (synthetic data only)
// is written outside the repository.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createAccess } from "../access.js";
import { MODELS } from "../agent/models.js";
import { createModelClient } from "../model-client.js";
import { checkCase, diskSkills, loadCases, runCase } from "./eval-core.mjs";

const webDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
// The Worker accepts calls only from the origins of the page (ALLOWED_ORIGINS of worker/wrangler.toml).
const ORIGIN = "https://vitaliksh.github.io";

const { values: options } = parseArgs({
  options: {
    case: { type: "string", default: "" },
    repeat: { type: "string", default: "2" },
    model: { type: "string", default: "" },
    out: { type: "string", default: join(tmpdir(), "annateria-eval") },
  },
});

async function workerUrl() {
  const config = await readFile(join(webDirectory, "config.js"), "utf8");
  const match = /ANNATERIA_API\s*=\s*"([^"]+)"/.exec(config);
  if (!match) throw new Error("config.js has no ANNATERIA_API.");
  return match[1];
}

// Logs in once; a wrong code stops the eval at once, so that it never walks into the lock-out of the Worker.
async function connect(api, code) {
  const fetchImpl = (url, init = {}) => fetch(url, { ...init, headers: { ...init.headers, Origin: ORIGIN } });
  const access = createAccess({ api, fetchImpl });
  const first = await access.login(code);
  const wait = first.retryAfterSeconds ? `, retry after ${first.retryAfterSeconds} s` : "";
  if (!first.ok) throw new Error(`Login failed (${first.reason}${wait}).`);
  let refused = false;
  const ensureLoggedIn = async () => {
    if (refused) return false;
    refused = !(await access.login(code)).ok;
    return !refused;
  };
  return createModelClient({ api, access, ensureLoggedIn, fetchImpl });
}

const addTokens = (sum, more) => ({ input: sum.input + more.input, output: sum.output + more.output });
const tokens = (log) => log.entries.filter((entry) => entry.kind === "model").reduce((sum, entry) => {
  const usage = entry.usage ?? {};
  const output = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
  return addTokens(sum, { input: usage.promptTokenCount ?? 0, output });
}, { input: 0, output: 0 });

async function main() {
  const code = process.env.ANNATERIA_CODE ?? "";
  if (!code.trim()) throw new Error("Set ANNATERIA_CODE to your access code first (in this terminal only).");
  const repeat = Math.max(1, Number.parseInt(options.repeat, 10) || 1);
  const cases = await loadCases(join(webDirectory, "eval", "cases"), options.case ? options.case.split(",").map((name) => name.trim()) : []);
  const models = { ...MODELS, ...(options.model ? { orchestrator: options.model } : {}) };
  const modelClient = await connect(await workerUrl(), code);
  const fetchSkill = diskSkills(webDirectory);
  console.log(`${cases.length} cases x ${repeat}, orchestrator ${models.orchestrator}`);

  const report = { startedAt: new Date().toISOString(), models, repeat, cases: [] };
  let failed = 0;
  let total = 0;
  for (const spec of cases) {
    const runs = [];
    for (let attempt = 1; attempt <= repeat; attempt += 1) {
      const outcome = await runCase(spec, { modelClient, fetchSkill, getModels: () => models });
      const checks = checkCase(spec, outcome);
      const { result } = outcome;
      runs.push({
        attempt, checks, status: result.status, text: result.text ?? result.error ?? "", turns: result.turns, toolCalls: result.toolCalls,
        tokens: result.log ? tokens(result.log) : { input: 0, output: 0 }, cards: outcome.cards, rows: outcome.rows, left: outcome.left,
        log: result.log?.entries ?? [],
      });
      const bad = checks.filter((item) => !item.ok);
      failed += bad.length;
      total += checks.length;
      console.log(`${bad.length ? "FAIL" : "ok  "} ${spec.name} #${attempt}: ${checks.length - bad.length}/${checks.length}`);
      for (const item of bad) console.log(`       x ${item.name}: ${item.detail}`);
    }
    report.cases.push({ name: spec.name, about: spec.about, runs });
  }

  await mkdir(options.out, { recursive: true });
  const file = join(options.out, `eval-${report.startedAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(file, JSON.stringify(report, null, 2));
  const used = report.cases.flatMap((item) => item.runs).reduce((sum, run) => addTokens(sum, run.tokens), { input: 0, output: 0 });
  console.log(`\n${total - failed}/${total} checks passed. Tokens: ${used.input} in, ${used.output} out (thinking included). Report: ${file}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 2;
});
