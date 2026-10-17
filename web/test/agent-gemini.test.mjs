import test from "node:test";
import assert from "node:assert/strict";
import { createGeminiModel } from "../agent/gemini.js";
import { createRegistry } from "../agent/registry.js";
import { runAgent } from "../agent/run.js";
import { call, recordingUi, say, world } from "./agent-fixtures.mjs";
import { createDefaultRegistry } from "../agent/index.js";

const answer = (parts, extra = {}) => ({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP", ...extra }], usageMetadata: { totalTokenCount: 12 } });

function stubClient(answers) {
  const sent = [];
  return { sent, generate: async ({ model, request, signal }) => { sent.push(structuredClone({ model, request })); sent.at(-1).signal = signal; const next = answers.shift(); if (next instanceof Error) throw next; return next; } };
}

test("one step is one generateContent request with the system text, the history, the declarations and AUTO function calling", async () => {
  const client = stubClient([answer([say("hi")])]);
  const model = createGeminiModel({ client, model: "gemini-3.8-flash" });
  const controller = new AbortController();
  const tools = createDefaultRegistry().declarations();
  const result = await model.step({ system: "be careful", contents: [{ role: "user", parts: [{ text: "go" }] }], tools, signal: controller.signal });
  const { model: id, request, signal } = client.sent[0];
  assert.equal(id, "gemini-3.8-flash");
  assert.deepEqual(request.systemInstruction, { parts: [{ text: "be careful" }] });
  assert.deepEqual(request.contents, [{ role: "user", parts: [{ text: "go" }] }]);
  assert.equal(request.tools[0].functionDeclarations.length, tools.length);
  assert.deepEqual(request.toolConfig, { functionCallingConfig: { mode: "AUTO" } });
  assert.equal(request.generationConfig.maxOutputTokens, 16384);
  assert.equal(signal, controller.signal);
  assert.deepEqual(result, { parts: [{ text: "hi" }], finishReason: "STOP", blockReason: undefined, usage: { totalTokenCount: 12 }, model: "gemini-3.8-flash" });
});

test("without tools the request has neither tools nor toolConfig", async () => {
  const client = stubClient([answer([say("x")])]);
  await createGeminiModel({ client, model: "m" }).step({ system: "s", contents: [], tools: [] });
  assert.equal("tools" in client.sent[0].request, false);
  assert.equal("toolConfig" in client.sent[0].request, false);
});

test("a blocked prompt, an empty candidate list and the finish reason are passed on", async () => {
  const client = stubClient([{ promptFeedback: { blockReason: "SAFETY" } }, { candidates: [{ finishReason: "MALFORMED_FUNCTION_CALL" }] }]);
  const model = createGeminiModel({ client, model: "m" });
  assert.deepEqual(await model.step({ system: "s", contents: [], tools: [] }), { parts: [], finishReason: undefined, blockReason: "SAFETY", usage: undefined, model: "m" });
  assert.equal((await model.step({ system: "s", contents: [], tools: [] })).finishReason, "MALFORMED_FUNCTION_CALL");
});

test("an error of the client (busy, login, abort) reaches the loop unchanged", async () => {
  const busy = Object.assign(new Error("busy"), { name: "ModelError", code: "busy" });
  const model = createGeminiModel({ client: stubClient([busy]), model: "m" });
  await assert.rejects(() => model.step({ system: "s", contents: [], tools: [] }), (error) => error === busy);
});

test("a whole run on the Gemini adapter: the thought signature goes back in the part it came in, the result in a user turn", async () => {
  const w = await world();
  const client = stubClient([
    answer([{ ...call("list_inbox", {}, { id: "fc-1" }), thoughtSignature: "SIGNATURE-A" }, call("find_client", { vat_id: "514123456" })]),
    answer([say("Three files wait.")]),
  ]);
  const result = await runAgent({
    model: createGeminiModel({ client, model: "gemini-3.8-flash" }), system: "s", registry: createDefaultRegistry(), message: "go",
    services: w.services, ui: recordingUi(), sleep: async () => {},
  });
  assert.deepEqual([result.status, result.text], ["completed", "Three files wait."]);
  const second = client.sent[1].request.contents;
  assert.deepEqual(second.map((content) => content.role), ["user", "model", "user"]);
  assert.equal(second[1].parts[0].thoughtSignature, "SIGNATURE-A");
  assert.equal(second[1].parts[0].functionCall.id, "fc-1");
  assert.equal(second[1].parts[1].thoughtSignature, undefined, "the second parallel call has none, and none is made up");
  assert.deepEqual(second[2].parts.map((part) => [part.functionResponse.id, part.functionResponse.name]), [["fc-1", "list_inbox"], [undefined, "find_client"]]);
  assert.equal(client.sent[1].request.tools[0].functionDeclarations.length, 11);
});

test("a registry without tools sends no declarations", async () => {
  const w = await world();
  const client = stubClient([answer([say("nothing to do")])]);
  const result = await runAgent({ model: createGeminiModel({ client, model: "m" }), system: "s", registry: createRegistry([]), message: "go", services: w.services });
  assert.equal(result.status, "completed");
  assert.equal("tools" in client.sent[0].request, false);
});
