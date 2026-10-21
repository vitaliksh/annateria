import test from "node:test";
import assert from "node:assert/strict";
import { ToolError } from "../agent/errors.js";
import { createRegistry } from "../agent/registry.js";
import { runAgent } from "../agent/run.js";
import { writeRunLog } from "../agent/run-log.js";
import { createDefaultRegistry } from "../agent/index.js";
import { abortError, call, modelError, recordingUi, reply, say, scriptedModel, world } from "./agent-fixtures.mjs";
import { listPaths, readFileBytes } from "./memory-binary-directory.mjs";

const run = async (overrides = {}) => {
  const w = overrides.world ?? (await world());
  const { world: _ignored, ...rest } = overrides;
  const result = await runAgent({
    system: "system", registry: createDefaultRegistry(), message: "process", services: w.services, ui: recordingUi(), sleep: async () => {},
    runId: "run-1", ...rest,
  });
  return { w, result };
};

test("happy path: the model calls a tool, gets its result, then answers", async () => {
  const model = scriptedModel([reply(say("looking"), call("list_inbox", {}, { id: "c1", signature: "SIG-1" })), reply(say("There are 3 files."))]);
  const { result } = await run({ model });
  assert.deepEqual([result.status, result.text, result.turns, result.toolCalls], ["completed", "There are 3 files.", 2, 1]);
  const [first, second] = model.requests;
  assert.deepEqual(first.contents, [{ role: "user", parts: [{ text: "process" }] }]);
  assert.deepEqual(first.tools.map((tool) => tool.name).sort(), ["add_rows", "ask_user", "extract_document", "facts_for", "find_client", "get_client_context", "list_inbox", "move_file_to_declaration", "prepare_import", "propose_change", "query_rows", "read_document"]);
  assert.equal(second.system, "system");
  assert.equal(second.contents.length, 3);
  assert.deepEqual(second.contents[1].parts, [say("looking"), call("list_inbox", {}, { id: "c1", signature: "SIG-1" })], "the model's parts come back unchanged, signature included");
  const response = second.contents[2].parts[0].functionResponse;
  assert.equal(second.contents[2].role, "user");
  assert.deepEqual([response.id, response.name, response.response.ok, response.response.counts.total], ["c1", "list_inbox", true, 3]);
});

test("the final answer shows names, not the handles the model wrote", async () => {
  const model = scriptedModel([reply(call("find_client", { vat_id: "514123456" })), reply(say("הלקוח C1 נמצא."))]);
  const { result } = await run({ model });
  assert.equal(result.text, "הלקוח Levi Plumbing Ltd נמצא.");
});

test("parallel calls are answered together, in the order they were made", async () => {
  const model = scriptedModel([
    reply(call("find_client", { vat_id: "514123456" }, { signature: "SIG" }), call("list_inbox", {})),
    reply(say("done")),
  ]);
  const { result } = await run({ model });
  assert.equal(result.toolCalls, 2);
  const parts = model.requests[1].contents[2].parts;
  assert.deepEqual(parts.map((part) => part.functionResponse.name), ["find_client", "list_inbox"]);
  assert.equal(parts[0].functionResponse.response.matches[0].match, "vat_id");
  assert.equal(model.requests[1].contents[1].parts[0].thoughtSignature, "SIG");
});

test("a tool error goes back to the model as a result and the run goes on", async () => {
  const model = scriptedModel([reply(call("list_inbox", { kind: "video" })), reply(call("list_inbox", { kind: "pdf" })), reply(say("ok"))]);
  const { result } = await run({ model });
  assert.equal(result.status, "completed");
  const first = model.requests[1].contents[2].parts[0].functionResponse.response;
  assert.deepEqual([first.ok, first.error.code], [false, "invalid_argument"]);
  assert.equal(model.requests[2].contents[4].parts[0].functionResponse.response.ok, true);
});

test("a refused call (close, delete, unknown) is answered not_allowed and changes nothing", async () => {
  const w = await world();
  const before = await listPaths(w.root);
  const model = scriptedModel([
    reply(call("close_month", { client: "C1", month: "2026-02" }), call("delete_row", { row: "R1" }), call("remember_rule", { ask: "Q1" })),
    reply(say("I cannot close the month.")),
  ]);
  const { result } = await run({ model, world: w });
  assert.equal(result.status, "completed");
  const answers = model.requests[1].contents[2].parts.map((part) => part.functionResponse.response);
  assert.deepEqual(answers.map((item) => [item.ok, item.error.code]), [[false, "not_allowed"], [false, "not_allowed"], [false, "not_allowed"]]);
  assert.deepEqual(await listPaths(w.root), before);
});

test("cancel while a question waits for the user ends the run as cancelled", async () => {
  const controller = new AbortController();
  // The abort comes once the question is shown (a fixed delay from the start was a race on a busy machine).
  const ui = { ask: () => { setTimeout(() => controller.abort(), 5); return new Promise(() => {}); }, propose: async () => {} };
  const model = scriptedModel([reply(call("ask_user", { question: "Which client?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], allow_other: false })), reply(say("never reached"))]);
  const { result } = await run({ model, ui, signal: controller.signal });
  assert.equal(result.status, "cancelled");
  assert.equal(model.requests.length, 1);
  const logged = result.log.entries.find((entry) => entry.kind === "tool");
  assert.equal(logged.error, "cancelled");
});

test("cancel before the start and cancel during a model call", async () => {
  const early = new AbortController();
  early.abort();
  assert.equal((await run({ model: scriptedModel([]), signal: early.signal })).result.status, "cancelled");
  const controller = new AbortController();
  const model = scriptedModel([(request) => new Promise((_, reject) => {
    request.signal.addEventListener("abort", () => reject(abortError()));
    controller.abort();
  })]);
  const { result } = await run({ model, signal: controller.signal });
  assert.equal(result.status, "cancelled");
});

test("a tool that is writing finishes before the loop stops on cancel", async () => {
  const controller = new AbortController();
  const events = [];
  const slow = { name: "slow", description: "x", schema: { type: "object", properties: {} }, run: async () => { controller.abort(); await new Promise((resolve) => setTimeout(resolve, 15)); events.push("written"); return {}; } };
  const model = scriptedModel([reply(call("slow")), reply(say("never"))]);
  const { result } = await run({ model, registry: createRegistry([slow]), signal: controller.signal });
  assert.deepEqual([result.status, events], ["cancelled", ["written"]]);
});

test("limits: turns, tool calls and time end the run with a reason", async () => {
  const forever = () => scriptedModel(Array.from({ length: 50 }, () => reply(call("list_inbox"))));
  const turns = (await run({ model: forever(), limits: { turns: 3, toolCalls: 400, minutes: 30, modelRetries: 2, questions: 15 } })).result;
  assert.deepEqual([turns.status, turns.reason, turns.turns], ["limit_reached", "turns", 3]);
  const calls = (await run({ model: scriptedModel([reply(call("list_inbox"), call("list_inbox"), call("list_inbox"))]), limits: { turns: 60, toolCalls: 2, minutes: 30, modelRetries: 2, questions: 15 } })).result;
  assert.deepEqual([calls.status, calls.reason, calls.toolCalls], ["limit_reached", "tool calls", 0]);
  let time = 0;
  const late = (await run({ model: forever(), clock: () => (time += 20 * 60_000) })).result;
  assert.deepEqual([late.status, late.reason], ["limit_reached", "time"]);
});

test("a busy model is retried with a growing pause, then the run goes on; login errors are not retried", async () => {
  const pauses = [];
  const sleep = async (ms) => { pauses.push(ms); };
  const model = scriptedModel([modelError("busy"), modelError("unavailable"), reply(say("fine"))]);
  const { result } = await run({ model, sleep });
  assert.equal(result.status, "completed");
  assert.deepEqual(pauses, [1000, 2000]);
  assert.deepEqual(result.log.entries.filter((entry) => entry.kind === "retry").map((entry) => entry.code), ["busy", "unavailable"]);

  const failing = await run({ model: scriptedModel([modelError("busy"), modelError("busy"), modelError("busy")]), sleep });
  assert.deepEqual([failing.result.status, failing.result.code], ["failed", "busy"]);
  const login = scriptedModel([modelError("login"), reply(say("never"))]);
  assert.equal((await run({ model: login })).result.status, "failed");
  assert.equal(login.requests.length, 1);
});

test("a refusal by the model is tried once more, a second one ends the run as blocked", async () => {
  const refused = { parts: [], finishReason: "SAFETY" };
  const again = scriptedModel([refused, reply(say("ok now"))]);
  assert.equal((await run({ model: again })).result.status, "completed");
  assert.deepEqual(again.requests[0].contents, again.requests[1].contents);
  assert.equal((await run({ model: scriptedModel([refused, { parts: [], blockReason: "OTHER" }]) })).result.status, "blocked");
});

test("a malformed function call gets one nudge, a second one fails the run", async () => {
  const malformed = { parts: [], finishReason: "MALFORMED_FUNCTION_CALL" };
  const model = scriptedModel([malformed, reply(say("fixed"))]);
  assert.equal((await run({ model })).result.status, "completed");
  assert.match(model.requests[1].contents.at(-1).parts[0].text, /malformed/);
  assert.equal((await run({ model: scriptedModel([malformed, malformed]) })).result.status, "failed");
});

test("an empty answer fails and a cut-off answer is marked truncated", async () => {
  assert.equal((await run({ model: scriptedModel([{ parts: [say("  ")], finishReason: "STOP" }]) })).result.status, "failed", "a blank answer is empty too");
  const empty = (await run({ model: scriptedModel([{ parts: [], finishReason: "STOP" }]) })).result;
  assert.deepEqual([empty.status, empty.error], ["failed", "The model gave an empty answer."]);
  const cut = (await run({ model: scriptedModel([{ parts: [say("half an ans")], finishReason: "MAX_TOKENS" }]) })).result;
  assert.deepEqual([cut.status, cut.truncated], ["completed", true]);
});

test("thought parts are kept in the history but are not part of the answer text", async () => {
  const model = scriptedModel([{ parts: [{ text: "thinking…", thought: true }, say("Answer.")], finishReason: "STOP" }]);
  assert.equal((await run({ model })).result.text, "Answer.");
});

test("questions that wait for the user run one at a time, in the order they were asked", async () => {
  const order = [];
  const ui = {
    ask: async (card) => {
      order.push(`start ${card.question}`);
      await new Promise((resolve) => setTimeout(resolve, card.question === "First?" ? 25 : 1));
      order.push(`end ${card.question}`);
      return { type: "option", id: "a" };
    },
  };
  const options = [{ id: "a", label: "A" }, { id: "b", label: "B" }];
  const model = scriptedModel([reply(call("ask_user", { question: "First?", options, allow_other: false }), call("ask_user", { question: "Second?", options, allow_other: false })), reply(say("done"))]);
  const { result } = await run({ model, ui });
  assert.equal(result.status, "completed");
  assert.deepEqual(order, ["start First?", "end First?", "start Second?", "end Second?"]);
  assert.equal(result.questions, 2);
});

test("the run log holds the model turns, the tool calls with shortened arguments, and the end; the panel hears every entry", async () => {
  const seen = [];
  const model = scriptedModel([reply(call("find_client", { name: "x".repeat(900) })), reply(say("done"))]);
  const { w, result } = await run({ model, onEvent: (entry) => seen.push(entry.kind) });
  assert.deepEqual(result.log.entries.map((entry) => entry.kind), ["model", "tool", "model", "end"]);
  assert.deepEqual(seen, ["model", "tool", "model", "end"]);
  const tool = result.log.entries[1];
  assert.equal(tool.name, "find_client");
  assert.ok(tool.args.length <= 501);
  assert.equal(result.log.entries.at(-1).status, "completed");
  await writeRunLog(w.root, result.log);
  const saved = JSON.parse(new TextDecoder().decode(await readFileBytes(w.root, "common/agent-runs/run-1.json")));
  assert.equal(saved.runId, "run-1");
  assert.equal(saved.entries.length, 4);
});

// A tool that writes, to show the two guards every write goes through.
const writer = (written) => ({
  name: "touch", description: "x", schema: { type: "object", required: ["client", "month"], properties: { client: { type: "string" }, month: { type: "string" } } },
  run: async (args, ctx) => {
    await ctx.requireOpen(args.client, args.month);
    await ctx.ensureCopy(args.client, args.month);
    written.push(args.month);
    return {};
  },
});

test("before the first write the table is copied, once per run and declaration; a locked month is never written", async () => {
  const w = await world();
  const written = [];
  const model = scriptedModel([
    reply(call("touch", { client: "id-Levi", month: "2026-02" })),
    reply(call("touch", { client: "id-Levi", month: "2026-02" }), call("touch", { client: "id-Levi", month: "2026-01" }), call("touch", { client: "id-Levi", month: "2026-05" })),
    reply(say("done")),
  ]);
  await run({ model, world: w, registry: createRegistry([writer(written)]) });
  assert.deepEqual(written, ["2026-02", "2026-02"]);
  const copies = (await listPaths(w.root)).filter((path) => path.includes("draft-table.before-agent-"));
  assert.equal(copies.length, 1, "one copy for two writes");
  assert.ok(copies[0].startsWith("clients/Levi/declarations/2026-02/draft-table.before-agent-") && copies[0].endsWith(".json"), copies[0]);
  const second = model.requests[2].contents[4].parts.map((part) => part.functionResponse.response);
  assert.deepEqual(second.map((item) => item.ok ? "ok" : item.error.code), ["ok", "locked", "not_found"]);
});

test("if the copy cannot be made nothing is written, and the failure is not remembered", async () => {
  const w = await world();
  let attempts = 0;
  const services = { ...w.services, tables: { copyBeforeAgent: async (...args) => { attempts += 1; if (attempts === 1) throw new Error("disk full"); return w.services.tables.copyBeforeAgent(...args); } } };
  const written = [];
  const model = scriptedModel([reply(call("touch", { client: "id-Levi", month: "2026-02" })), reply(call("touch", { client: "id-Levi", month: "2026-02" })), reply(say("done"))]);
  await run({ model, world: { ...w, services }, registry: createRegistry([writer(written)]), now: () => "2026-10-16T09:00:00.000Z" });
  assert.deepEqual(model.requests[1].contents[2].parts[0].functionResponse.response.error.code, "unavailable");
  assert.deepEqual(written, ["2026-02"]);
});

test("an error thrown by a tool in the middle of a run leaves what was written intact and the run completes", async () => {
  const w = await world();
  const written = [];
  const flaky = { name: "flaky", description: "x", schema: { type: "object", properties: {} }, run: async () => { throw new ToolError("conflict", "Already there."); } };
  const model = scriptedModel([reply(call("touch", { client: "id-Levi", month: "2026-02" })), reply(call("flaky")), reply(say("partial"))]);
  const { result } = await run({ model, world: w, registry: createRegistry([writer(written), flaky]) });
  assert.deepEqual([result.status, written], ["completed", ["2026-02"]]);
});
