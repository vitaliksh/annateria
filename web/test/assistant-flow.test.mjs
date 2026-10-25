import test from "node:test";
import assert from "node:assert/strict";
import { MODEL_MESSAGES } from "../model-client.js";
import { MODELS } from "../agent/models.js";
import { QUICK_MESSAGES, buildMessage, createAssistantFlow, resultNote } from "../assistant-flow.js";
import { call, rawRecord, recordingUi, world } from "./agent-fixtures.mjs";
import { listPaths, readFileBytes } from "./memory-binary-directory.mjs";
import { diskFetch, extractionInstruction, orchestratorInstruction } from "./skills-fixture.mjs";

test("a quick request is the fixed text with the date; a typed one carries the words of the user and the last answer", () => {
  assert.equal(buildMessage({ kind: "process", today: "2026-10-16" }), `Today is 2026-10-16.\n\n${QUICK_MESSAGES.process}`);
  assert.equal(buildMessage({ kind: "left", today: "2026-10-16", previous: "ignored for a quick request" }), `Today is 2026-10-16.\n\n${QUICK_MESSAGES.left}`);
  const typed = buildMessage({ kind: "text", text: "why is row 3 marked?", today: "2026-10-16", previous: "I found 3 files.", active: { clientName: "Levi Plumbing", month: "2026-02" } });
  assert.equal(typed, [
    "Today is 2026-10-16.",
    'The user has open: the client "Levi Plumbing", declaration 2026-02 (find the client with find_client by name).',
    "Your previous answer in this conversation:\nI found 3 files.",
    "The user writes: why is row 3 marked?",
  ].join("\n\n"));
  assert.match(buildMessage({ kind: "text", text: "x", today: "d", active: { clientName: "A", month: null } }), /declaration none/);
  assert.equal(buildMessage({ kind: "text", text: "x", today: "d", previous: "Ω".repeat(5000) }).split("Ω").length - 1, 2000);
});

test("the end of a run becomes a line for the user, by status", () => {
  assert.deepEqual(resultNote({ status: "completed", text: "הכול מוכן." }), { kind: "assistant", text: "הכול מוכן." });
  assert.equal(resultNote({ status: "completed", text: "חצי", truncated: true }).text, "חצי\n(התשובה נקטעה)");
  assert.deepEqual(resultNote({ status: "cancelled" }), { kind: "note", text: "הריצה הופסקה." });
  assert.match(resultNote({ status: "limit_reached", reason: "turns" }).text, /צעדים/);
  assert.match(resultNote({ status: "limit_reached", reason: "tool calls" }).text, /פעולות/);
  assert.match(resultNote({ status: "limit_reached", reason: "time" }).text, /זמן/);
  assert.equal(resultNote({ status: "limit_reached", reason: "?" }).kind, "note");
  assert.deepEqual(resultNote({ status: "blocked" }), { kind: "error", text: "המודל סירב להשיב." });
  assert.deepEqual(resultNote({ status: "failed", code: "busy" }), { kind: "error", text: `הריצה נכשלה: ${MODEL_MESSAGES.busy}` });
  assert.deepEqual(resultNote({ status: "failed", code: "login" }), { kind: "error", text: `הריצה נכשלה: ${MODEL_MESSAGES.login}` });
  assert.equal(resultNote({ status: "failed", code: "billing" }).text, "הריצה נכשלה: יש בעיה בתשלום ל‑Google עבור שירות ה‑AI. יש לפנות לויטליק.");
  assert.match(resultNote({ status: "failed", error: "secret internal text" }).text, /אירעה שגיאה/);
  assert.equal(resultNote({ status: "failed", error: "secret internal text" }).text.includes("secret"), false);
});

// A model client that answers like Gemini: the orchestrator by function calls from a script, the extraction by JSON.
function geminiStub({ steps, extraction = { documents: [rawRecord()] } }) {
  const requests = [];
  let step = 0;
  return {
    requests,
    generate: async ({ model, request }) => {
      requests.push({ model, request: structuredClone(request) });
      if (request.generationConfig.responseMimeType) return { candidates: [{ content: { parts: [{ text: JSON.stringify(extraction) }] } }] };
      const next = steps[step];
      step += 1;
      return { candidates: [{ content: { parts: next(request) }, finishReason: "STOP" }], usageMetadata: { totalTokenCount: 10 } };
    },
  };
}
const lastResponse = (request, name) => request.contents.at(-1).parts.map((part) => part.functionResponse).find((item) => item.name === name).response;

test("a run through the flow: the orchestrator model, the tools and the extraction model are called as configured, and the run log is saved", async () => {
  const w = await world();
  const progress = [];
  const modelClient = geminiStub({
    steps: [
      () => [call("list_inbox", { kind: "image" })],
      (request) => [call("extract_document", { file: lastResponse(request, "list_inbox").files[0].file })],
      (request) => [{ text: `Found ${lastResponse(request, "extract_document").documents.length} document.` }],
    ],
  });
  const flow = createAssistantFlow({ modelClient, getDataRoot: () => w.root, getClients: () => w.clients, fetchSkill: diskFetch });
  const result = await flow.run({ message: "process", ui: recordingUi(), signal: new AbortController().signal, onProgress: (event) => progress.push(event) });
  assert.deepEqual([result.status, result.text, result.toolCalls], ["completed", "Found 1 document.", 2]);
  const [first, second, extraction, last] = modelClient.requests;
  assert.deepEqual([first.model, second.model, extraction.model, last.model], [MODELS.orchestrator, MODELS.orchestrator, MODELS.extraction, MODELS.orchestrator]);
  assert.deepEqual(first.request.systemInstruction, { parts: [{ text: await orchestratorInstruction() }] });
  assert.equal(first.request.tools[0].functionDeclarations.length, 13);
  assert.deepEqual(extraction.request.systemInstruction, { parts: [{ text: await extractionInstruction() }] });
  const sent = extraction.request.contents[0].parts[1].inlineData;
  assert.deepEqual([sent.mimeType, sent.data], ["image/jpeg", Buffer.from("jpeg-bytes").toString("base64")], "the real file of the inbox goes to the vision call");
  assert.deepEqual(progress.filter((event) => event.type === "call").map((event) => event.name), ["list_inbox", "extract_document"]);
  const logs = (await listPaths(w.root)).filter((path) => path.startsWith("common/agent-runs/"));
  assert.equal(logs.length, 1);
  assert.equal(JSON.parse(new TextDecoder().decode(await readFileBytes(w.root, logs[0]))).runId, result.runId);
  assert.equal(result.logError, undefined);
});

test("a run that fails still returns its result, and a run log that cannot be written is reported, not thrown", async () => {
  const w = await world();
  w.root.state.failures.push({ match: /\.json$/, name: "NotAllowedError", times: 1 });
  const busy = Object.assign(new Error("busy"), { name: "ModelError", code: "busy" });
  const flow = createAssistantFlow({ modelClient: { generate: async () => { throw busy; } }, getDataRoot: () => w.root, getClients: () => w.clients, fetchSkill: diskFetch });
  const result = await flow.run({ message: "x", ui: recordingUi(), signal: new AbortController().signal });
  assert.deepEqual([result.status, result.code], ["failed", "busy"]);
  assert.equal(typeof result.logError, "string");
});

test("the text layer of a PDF found by the document reader is sent along with the file to the vision call", async () => {
  const w = await world();
  const reader = { inspect: async (file, entry, options) => ({ kind: "pdf", pages: 1, text: "TEXT LAYER OF THE POLICY", seen: { name: file.name, options } }) };
  const modelClient = geminiStub({
    steps: [() => [call("list_inbox", { kind: "pdf" })], (request) => [call("extract_document", { file: lastResponse(request, "list_inbox").files[0].file })], () => [{ text: "done" }]],
  });
  const flow = createAssistantFlow({ modelClient, getDataRoot: () => w.root, getClients: () => w.clients, reader, fetchSkill: diskFetch });
  assert.equal((await flow.run({ message: "x", ui: recordingUi(), signal: new AbortController().signal })).status, "completed");
  const note = modelClient.requests.find((item) => item.request.generationConfig.responseMimeType).request.contents[0].parts[0].text;
  assert.ok(note.includes("Text layer of the PDF") && note.endsWith("TEXT LAYER OF THE POLICY"), note);
});

test("leftNote names the files the run did not file, and says nothing when none is left", async () => {
  const { leftNote } = await import("../assistant-flow.js");
  assert.equal(leftNote({ status: "completed" }), null);
  assert.deepEqual(leftNote({ left: [{ name: "004.jpg", folder: "_unsorted" }, { name: "005.jpg", folder: "_unsorted" }] }), { kind: "note", text: "נשארו בתיבת הקלט 2 קבצים שלא טופלו: 004.jpg, 005.jpg" });
  const many = leftNote({ left: Array.from({ length: 14 }, (_, n) => ({ name: `f${n}.jpg`, folder: "_unsorted" })) });
  assert.match(many.text, /14 קבצים.*f11\.jpg ועוד$/);
});

test("keptNote says which originals the app filed itself and how many left-out documents became rows to look at", async () => {
  const { keptNote } = await import("../assistant-flow.js");
  assert.equal(keptNote({ status: "completed" }), null);
  const note = keptNote({ filedByApp: [{ name: "scan.pdf", rows: 3, addedForReview: 2 }], leftOut: 2 });
  assert.equal(note.kind, "note");
  assert.match(note.text, /scan\.pdf/);
  assert.match(note.text, /נוספו 2 שורות כבויות לבדיקה/);
});
