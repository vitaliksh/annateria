import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_MODELS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  readLimitedText,
  validateModelCall,
} from "../src/model.js";

const hello = { contents: [{ role: "user", parts: [{ text: "hello" }] }] };
const call = (request, extra = {}) => validateModelCall({ model: "gemini-3.5-flash-lite", request, ...extra });
const refused = (result, pattern) => {
  assert.equal(result.ok, false);
  if (pattern) assert.match(result.error, pattern);
};

test("a plain text request passes and gets the default output limit", () => {
  const result = call(hello);
  assert.equal(result.ok, true);
  assert.equal(result.stream, false);
  assert.deepEqual(result.request, { contents: hello.contents, generationConfig: { maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS } });
});

test("only the listed models are accepted, and a model id cannot smuggle in a path or a method", () => {
  for (const model of ALLOWED_MODELS) assert.equal(validateModelCall({ model, request: hello }).ok, true, model);
  for (const model of ["gemini-2.0-flash", "gemini-3.8-flash:streamGenerateContent", "../gemini-3.8-flash", "gemini-3.8-flash?x=1", "", null, 5, undefined])
    refused(validateModelCall({ model, request: hello }), /model/);
});

test("the body must be { model, stream?, request } and nothing else", () => {
  for (const body of [null, [], "text", {}, { model: "gemini-3.8-flash" }, { model: "gemini-3.8-flash", request: hello, apiKey: "x" }])
    assert.equal(validateModelCall(body).ok, false);
  refused(call(hello, { stream: "yes" }), /stream/);
  assert.equal(call(hello, { stream: true }).stream, true);
});

test("fields that would widen what Gemini does are refused: cache, labels, store, tiers, continuation", () => {
  for (const field of ["cachedContent", "labels", "store", "serviceTier", "continuationToken", "safetySettings", "cached_content"])
    refused(call({ ...hello, [field]: "x" }), /not allowed/);
});

test("snake_case spellings are accepted and forwarded in the canonical camelCase form", () => {
  const result = call({
    contents: hello.contents,
    system_instruction: { parts: [{ text: "rules" }] },
    generation_config: { max_output_tokens: 100, response_mime_type: "application/json", top_p: 0.5 },
    tool_config: { function_calling_config: { mode: "ANY" } },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.request.systemInstruction, { parts: [{ text: "rules" }] });
  assert.deepEqual(result.request.generationConfig, { maxOutputTokens: 100, responseMimeType: "application/json", topP: 0.5 });
  assert.deepEqual(result.request.toolConfig, { functionCallingConfig: { mode: "ANY" } });
});

test("the same field twice (camelCase and snake_case) is refused instead of one silently winning", () => {
  refused(call({ ...hello, generationConfig: { maxOutputTokens: 5, max_output_tokens: 99999 } }), /twice/);
});

test("the output limit: default when missing, up to the maximum, whole numbers only", () => {
  assert.equal(call({ ...hello, generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS } }).ok, true);
  for (const bad of [0, -1, 1.5, "100", MAX_OUTPUT_TOKENS + 1, null])
    refused(call({ ...hello, generationConfig: { maxOutputTokens: bad } }), /maxOutputTokens/);
  refused(call({ ...hello, generationConfig: { candidateCount: 2 } }), /candidateCount/);
});

test("parts: text, images, a PDF and the function-calling parts pass; links to files and everything else do not", () => {
  const image = { inlineData: { mimeType: "image/heic", data: "AAAA" } };
  const pdf = { inline_data: { mime_type: "application/pdf", data: "AAAA" } };
  const call1 = { functionCall: { name: "list_inbox", args: {} }, thoughtSignature: "sig" };
  const answer = { functionResponse: { name: "list_inbox", response: { files: [] } } };
  assert.equal(call({ contents: [{ role: "user", parts: [{ text: "x" }, image, pdf] }, { role: "model", parts: [call1] }, { role: "user", parts: [answer] }] }).ok, true);
  for (const part of [
    { fileData: { fileUri: "https://example.com/a.pdf", mimeType: "application/pdf" } },
    { file_data: { file_uri: "https://example.com/a.pdf" } },
    { executableCode: { code: "x" } },
    { videoMetadata: {} },
    { inlineData: { mimeType: "text/html", data: "AAAA" } },
    { inlineData: { mimeType: "image/png" } },
    { inlineData: { mimeType: "image/png", data: "" } },
    { inlineData: { mimeType: "image/png", data: "AAAA", displayName: "x" } },
    {},
    "text",
  ])
    assert.equal(call({ contents: [{ role: "user", parts: [part] }] }).ok, false, JSON.stringify(part));
});

test("contents need at least one content with parts, a known role and nothing else", () => {
  for (const contents of [undefined, [], [{ role: "user" }], [{ role: "user", parts: [] }], [{ role: "root", parts: [{ text: "x" }] }], [{ parts: [{ text: "x" }], extra: 1 }], "text"])
    assert.equal(call({ contents }).ok, false, JSON.stringify(contents));
});

test("tools: function declarations only; search, code execution and URL reading are refused", () => {
  const declaration = { functionDeclarations: [{ name: "list_inbox", description: "d", parameters: { type: "OBJECT", properties: {} } }] };
  assert.equal(call({ ...hello, tools: [declaration] }).ok, true);
  assert.equal(call({ ...hello, tools: [{ function_declarations: [] }] }).ok, true);
  for (const tool of [{ googleSearch: {} }, { codeExecution: {} }, { urlContext: {} }, { google_search_retrieval: {} }, { ...declaration, googleSearch: {} }])
    refused(call({ ...hello, tools: [tool] }), /not allowed/);
  refused(call({ ...hello, tools: "x" }), /tools/);
  refused(call({ ...hello, toolConfig: { retrievalConfig: {} } }), /not allowed/);
});

test("the request must be an object", () => {
  for (const request of [undefined, null, [], "x"]) refused(call(request));
});

const asRequest = (body, headers = {}) => new Request("https://worker.test/v1/model", { method: "POST", body, headers });

test("a body over the limit is refused by its Content-Length and also when the length is not declared", async () => {
  assert.equal(await readLimitedText(asRequest("x".repeat(10)), 100), "x".repeat(10));
  assert.equal(await readLimitedText(asRequest("x".repeat(10)), 10), "x".repeat(10));
  assert.equal(await readLimitedText(asRequest("x".repeat(11)), 10), null);
  assert.equal(await readLimitedText(asRequest("x".repeat(10), { "content-length": "999999" }), 100), null);
  const chunks = new ReadableStream({
    start(controller) {
      for (let index = 0; index < 5; index += 1) controller.enqueue(new TextEncoder().encode("12345"));
      controller.close();
    },
  });
  const streamed = new Request("https://worker.test/v1/model", { method: "POST", body: chunks, duplex: "half" });
  assert.equal(streamed.headers.get("content-length"), null);
  assert.equal(await readLimitedText(streamed, 24), null);
});
