// The orchestrator loop (docs/AGENT_TOOLS.md, section 2): model <-> tools until the model answers without a call, a limit is
// reached, the user cancels or the model fails. `model.step()` is the only thing that talks to Gemini (gemini.js in the app, a
// scripted model in tests). The conversation keeps the model's parts exactly as received (thought signatures included).
import { ToolError } from "./errors.js";
import { createHandles } from "./handles.js";
import { LIMITS } from "./limits.js";
import { createRunLog, shorten } from "./run-log.js";
import { createSemaphore } from "./semaphore.js";

const RETRY_CODES = new Set(["busy", "unavailable", "network"]);
const REFUSAL_REASONS = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY", "RECITATION"]);
const MALFORMED_NUDGE = "Your last function call was malformed. Call the tool again with valid arguments, or answer in text.";
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isAbort = (error) => error?.name === "AbortError";

// What a tool receives: the handle table, the services, the user interface of the panel, the abort signal, the counters of the
// run and the two guards every write goes through.
export function createContext({ services, ui = {}, signal = new AbortController().signal, limits = LIMITS, now = () => new Date().toISOString(), log = null, runId = crypto.randomUUID() }) {
  // listed: file handle -> { name, folder, kind } of every file that list_inbox showed.
  // routes: file handle -> the answered question that sent the file to a client (ask_user), so that it is never asked twice.
  // fileStatus: file handle -> waiting | extracted | filed. extractions: file handle -> { tries, records } (the fact store).
  // addedEntries, factsUsed and addedFacts (fact handle -> what add_rows made of it) are filled by add_rows: rows made in this run are seen by the duplicate search, and facts
  // that already became a row cannot be extracted again.
  const run = {
    id: runId, asked: new Map(), routes: new Map(), listed: new Map(), questions: 0, copies: new Set(), fileStatus: new Map(), toolCalls: 0,
    extractions: new Map(), extractCount: 0, extractSlots: createSemaphore(limits.parallelExtractions ?? LIMITS.parallelExtractions), addedEntries: [], factsUsed: new Set(), addedFacts: new Map(),
  };
  return {
    handles: createHandles(), services, ui, signal, run, limits, log,
    today: () => new Date(now()),
    // The table is copied once per run and declaration before the agent first writes to it; no copy, no write.
    async ensureCopy(clientId, month) {
      const key = `${clientId}|${month}`;
      if (run.copies.has(key)) return;
      try {
        await services.tables.copyBeforeAgent(clientId, month, now());
      } catch {
        throw new ToolError("unavailable", "The table could not be copied before the agent writes, so nothing was written.");
      }
      run.copies.add(key);
    },
    // A write to a declaration that is not open is refused here, whatever the tool says.
    async requireOpen(clientId, month) {
      const state = await services.declarations.state(clientId, month);
      if (state === "open") return;
      throw new ToolError(state === "locked" ? "locked" : "not_found", state === "locked" ? `The declaration ${month} is locked.` : `There is no declaration ${month}.`);
    },
  };
}

// model: { step({ system, contents, tools, signal }) -> { parts, finishReason?, blockReason?, usage?, model? } }
// registry: createRegistry(...). services: the only way for a tool to reach data (services.js). ui: { ask(card, { signal }),
// propose(proposal) } supplied by the panel. onEvent receives every log entry when it is written; onProgress({ type: "turn" | "call" | "done", ... })
// is told when a model turn or a tool call starts and when a call has ended (the progress line of the panel).
// Resolves with { status, text?, error?, reason?, turns, toolCalls, questions, runId, log };
// status: completed | cancelled | limit_reached | failed | blocked.
export async function runAgent({
  model, system, registry, message, services, ui = {}, signal = new AbortController().signal, limits = LIMITS,
  now = () => new Date().toISOString(), clock = () => Date.now(), sleep = defaultSleep, runId = crypto.randomUUID(), onEvent, onProgress,
}) {
  const log = createRunLog({ runId, now, onEvent });
  const ctx = createContext({ services, ui, signal, limits, now, log, runId });
  const { run } = ctx;
  const deadline = clock() + limits.minutes * 60_000;

  const contents = [{ role: "user", parts: [{ text: message }] }];
  let turns = 0;
  let refusals = 0;
  let malformed = 0;
  const progress = (event) => { try { onProgress?.(event); } catch { /* a faulty listener must not stop the run */ } };
  // Where the rows of this run went: [{ clientId, month, count }], oldest month first.
  const placed = () => {
    const counts = new Map();
    for (const item of run.addedFacts.values()) {
      const clientId = item.row ? ctx.handles.get("R", item.row).clientId : null;
      if (clientId) counts.set(`${clientId}|${item.month}`, (counts.get(`${clientId}|${item.month}`) ?? 0) + 1);
    }
    return [...counts].map(([key, count]) => ({ clientId: key.split("|")[0], month: key.split("|")[1], count })).sort((a, b) => a.month.localeCompare(b.month));
  };
  // The files of the inbox that were shown but not filed, once the run has done any work on files: [{ name, folder }].
  const left = () => {
    const worked = placed().length || [...run.fileStatus.values()].includes("filed");
    return worked ? [...run.listed].filter(([handle, file]) => file.kind !== "spreadsheet" && run.fileStatus.get(handle) !== "filed").map(([, file]) => ({ name: file.name, folder: file.folder })) : [];
  };
  const finish = (status, extra = {}) => {
    log.add({ kind: "end", status, turns, toolCalls: run.toolCalls, ...extra });
    const added = placed();
    const unfiled = left();
    return { status, turns, toolCalls: run.toolCalls, questions: run.questions, runId, log, ...(added.length ? { added } : {}), ...(unfiled.length ? { left: unfiled } : {}), ...extra };
  };

  async function askModel() {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await model.step({ system, contents, tools: registry.declarations(), signal });
      } catch (error) {
        if (isAbort(error) || signal.aborted || !RETRY_CODES.has(error?.code) || attempt >= limits.modelRetries) throw error;
        log.add({ kind: "retry", attempt: attempt + 1, code: error.code });
        await sleep(1000 * (attempt + 1));
      }
    }
  }

  // Exclusive tools (the ones that wait for the user) run in the order they were called; the rest run together.
  let queue = Promise.resolve();
  async function callTool(call) {
    const started = clock();
    progress({ type: "call", name: call.name });
    const envelope = await (registry.isExclusive(call.name) ? (queue = queue.then(() => registry.dispatch(call, ctx))) : registry.dispatch(call, ctx));
    log.add({ kind: "tool", name: call.name, args: shorten(call.args ?? {}), ok: envelope.ok, error: envelope.error?.code, result: shorten(envelope), ms: clock() - started });
    progress({ type: "done", name: call.name, ok: envelope.ok, result: envelope });
    return { functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response: envelope } };
  }

  for (;;) {
    if (signal.aborted) return finish("cancelled");
    if (turns >= limits.turns) return finish("limit_reached", { reason: "turns" });
    if (clock() > deadline) return finish("limit_reached", { reason: "time" });
    turns += 1;
    progress({ type: "turn", turn: turns });

    let reply;
    try {
      reply = await askModel();
    } catch (error) {
      if (isAbort(error) || signal.aborted) return finish("cancelled");
      return finish("failed", { error: error?.message ?? "The model failed.", code: error?.code });
    }
    const parts = Array.isArray(reply?.parts) ? reply.parts : [];
    const calls = parts.filter((part) => part.functionCall).map((part) => part.functionCall);
    const text = parts.filter((part) => typeof part.text === "string" && !part.thought).map((part) => part.text).join("");
    log.add({ kind: "model", turn: turns, model: reply?.model, finishReason: reply?.finishReason, usage: reply?.usage, calls: calls.map((call) => call.name), textLength: text.length });

    if (!calls.length && !text.trim() && (reply?.blockReason || REFUSAL_REASONS.has(reply?.finishReason))) {
      refusals += 1;
      if (refusals >= 2) return finish("blocked", { error: "The model refused twice." });
      continue;
    }
    if (!calls.length && reply?.finishReason === "MALFORMED_FUNCTION_CALL") {
      malformed += 1;
      if (malformed >= 2) return finish("failed", { error: "The model sent a malformed function call twice." });
      contents.push({ role: "user", parts: [{ text: MALFORMED_NUDGE }] });
      continue;
    }
    malformed = 0;

    if (!calls.length) {
      if (!text.trim()) return finish("failed", { error: "The model gave an empty answer." });
      contents.push({ role: "model", parts });
      return finish("completed", { text, truncated: reply?.finishReason === "MAX_TOKENS" });
    }
    contents.push({ role: "model", parts });
    if (run.toolCalls + calls.length > limits.toolCalls) return finish("limit_reached", { reason: "tool calls" });
    run.toolCalls += calls.length;
    contents.push({ role: "user", parts: await Promise.all(calls.map(callTool)) });
  }
}
