// Validation of the request that the browser wants forwarded to Gemini (step 1.2). The Worker is a proxy with a short
// allow-list: it forwards only what the in-app assistant needs, so a stolen token or a bug in the page cannot turn it
// into a general Gemini gateway (other models, URL fetching, web search, code execution, huge outputs).
//
// The REST API accepts camelCase and snake_case for the same field, so every key is compared in a normalised form
// (lower case, no underscores) and forwarded in its canonical camelCase spelling.

// Model ids as listed on https://ai.google.dev/gemini-api/docs/models on 16 October 2026. Phase 3 picks the defaults.
export const ALLOWED_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.8-flash",
  "gemini-3.1-pro-preview",
  "gemini-4-argon",
];
export const MAX_REQUEST_BYTES = 20 * 1024 * 1024; // the documented limit of inline data in one request (images page)
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
export const MAX_OUTPUT_TOKENS = 32768;
export const INLINE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];

const REQUEST_KEYS = {
  contents: "contents",
  systeminstruction: "systemInstruction",
  generationconfig: "generationConfig",
  tools: "tools",
  toolconfig: "toolConfig",
};
const GENERATION_KEYS = {
  temperature: "temperature",
  topp: "topP",
  topk: "topK",
  candidatecount: "candidateCount",
  maxoutputtokens: "maxOutputTokens",
  stopsequences: "stopSequences",
  responsemimetype: "responseMimeType",
  responseschema: "responseSchema",
  responsejsonschema: "responseJsonSchema",
  thinkingconfig: "thinkingConfig",
};
const PART_KEYS = {
  text: "text",
  inlinedata: "inlineData",
  functioncall: "functionCall",
  functionresponse: "functionResponse",
  thought: "thought",
  thoughtsignature: "thoughtSignature",
};

class Invalid extends Error {}

const normal = (key) => String(key).toLowerCase().replaceAll("_", "");
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// Copies `value` keeping only the keys of `allowed` (normalised → canonical); any other key is an error.
function pick(value, allowed, where) {
  if (!isObject(value)) throw new Invalid(`${where} must be an object.`);
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    const canonical = allowed[normal(key)];
    if (!canonical) throw new Invalid(`${where}: the field "${key}" is not allowed.`);
    if (canonical in output) throw new Invalid(`${where}: the field "${canonical}" is given twice.`);
    output[canonical] = item;
  }
  return output;
}

function cleanPart(part, where) {
  const clean = pick(part, PART_KEYS, where);
  if (!Object.keys(clean).length) throw new Invalid(`${where} is empty.`);
  if (clean.inlineData !== undefined) {
    const { mimeType, data, ...rest } = pick(clean.inlineData, { mimetype: "mimeType", data: "data" }, `${where}.inlineData`);
    if (Object.keys(rest).length || typeof data !== "string" || !data) throw new Invalid(`${where}.inlineData needs mimeType and data.`);
    if (!INLINE_MIME_TYPES.includes(mimeType)) throw new Invalid(`${where}.inlineData: the type "${mimeType}" is not allowed.`);
    clean.inlineData = { mimeType, data };
  }
  return clean;
}

function cleanContent(content, where) {
  if (!isObject(content) || !Array.isArray(content.parts) || !content.parts.length) throw new Invalid(`${where} needs parts.`);
  const { role, parts, ...rest } = content;
  if (Object.keys(rest).length) throw new Invalid(`${where}: only role and parts are allowed.`);
  if (role !== undefined && !["user", "model", "function"].includes(role)) throw new Invalid(`${where}: unknown role.`);
  const clean = { parts: parts.map((part, index) => cleanPart(part, `${where}.parts[${index}]`)) };
  if (role !== undefined) clean.role = role;
  return clean;
}

function cleanTools(tools) {
  if (!Array.isArray(tools)) throw new Invalid("tools must be a list.");
  return tools.map((tool, index) => pick(tool, { functiondeclarations: "functionDeclarations" }, `tools[${index}]`));
}

function cleanGeneration(config) {
  const clean = pick(config ?? {}, GENERATION_KEYS, "generationConfig");
  const limit = clean.maxOutputTokens;
  if (limit === undefined) clean.maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS;
  else if (!Number.isInteger(limit) || limit < 1 || limit > MAX_OUTPUT_TOKENS)
    throw new Invalid(`maxOutputTokens must be a whole number from 1 to ${MAX_OUTPUT_TOKENS}.`);
  if (clean.candidateCount !== undefined && clean.candidateCount !== 1) throw new Invalid("candidateCount must be 1.");
  return clean;
}

// Returns { ok: true, model, stream, request } with the request in canonical form, or { ok: false, error }.
export function validateModelCall(body) {
  try {
    const { model, stream = false, request, ...rest } = isObject(body) ? body : {};
    if (!isObject(body) || Object.keys(rest).length) throw new Invalid("The body must be { model, stream?, request }.");
    if (!ALLOWED_MODELS.includes(model)) throw new Invalid("This model is not allowed.");
    if (typeof stream !== "boolean") throw new Invalid("stream must be true or false.");
    const given = pick(request, REQUEST_KEYS, "request");
    if (!Array.isArray(given.contents) || !given.contents.length) throw new Invalid("request.contents is required.");
    const clean = { contents: given.contents.map((content, index) => cleanContent(content, `contents[${index}]`)) };
    if (given.systemInstruction !== undefined) clean.systemInstruction = cleanContent(given.systemInstruction, "systemInstruction");
    if (given.tools !== undefined) clean.tools = cleanTools(given.tools);
    if (given.toolConfig !== undefined) clean.toolConfig = pick(given.toolConfig, { functioncallingconfig: "functionCallingConfig" }, "toolConfig");
    clean.generationConfig = cleanGeneration(given.generationConfig);
    return { ok: true, model, stream, request: clean };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message };
    throw error;
  }
}

// Reads a request body but gives up as soon as it is larger than `limit` bytes (Content-Length may be missing or false).
export async function readLimitedText(request, limit = MAX_REQUEST_BYTES) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}
