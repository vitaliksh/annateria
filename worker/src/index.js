// ANNATERIA Worker. Step 1.1: the access code. POST /v1/auth turns a 6-character code into a signed token that the
// browser keeps in page memory. Step 1.2: POST /v1/model forwards a constrained generateContent request to Gemini.
// Step 7.4: /v1/baton says which device works now (baton.js). Every route but /health and /v1/auth calls requireUser().
import { AccessConfigError, checkCode, normalizeCode, parseAccessCodes, signToken, verifyToken } from "./access.js";
import { MAX_REQUEST_BYTES, readLimitedText, validateModelCall } from "./model.js";

export { AuthGuard } from "./auth-guard.js";
export { Baton } from "./baton.js";

const MAX_AUTH_BODY_BYTES = 1024;
const MAX_BATON_BODY_BYTES = 1024;

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders },
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  return (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .includes(origin)
    ? origin
    : null;
}

function cors(request, env) {
  const origin = allowedOrigin(request, env);
  return origin
    ? {
        "access-control-allow-origin": origin,
        vary: "Origin",
        "access-control-allow-headers": "content-type, authorization",
        "access-control-allow-methods": "GET, POST, OPTIONS",
      }
    : {};
}

function clientRequest(request, env) {
  if (!allowedOrigin(request, env)) return json({ error: "This browser origin is not allowed." }, 403);
  return null;
}

// Returns {user, expiresAt} for a request that carries a valid, unexpired `Authorization: Bearer <token>`, else null.
export async function requireUser(request, env, now = Date.now()) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return token ? verifyToken(token, env.TOKEN_SIGNING_KEY, now) : null;
}

async function addressKey(request) {
  const address = request.headers.get("cf-connecting-ip") || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
  return [...new Uint8Array(digest).slice(0, 8)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function guardCall(env, action, body) {
  const stub = env.AUTH_GUARD.get(env.AUTH_GUARD.idFromName("login"));
  return stub.fetch(`https://guard/${action}`, { method: "POST", body: JSON.stringify(body) });
}

async function authenticate(request, env, headers) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, headers);
  if (!env.ACCESS_CODES || !env.TOKEN_SIGNING_KEY || !env.AUTH_GUARD) return json({ error: "Login is not configured." }, 503, headers);
  const text = await request.text();
  let code = null;
  try {
    if (text.length <= MAX_AUTH_BODY_BYTES) code = normalizeCode(JSON.parse(text)?.code);
  } catch {
    code = null;
  }
  if (!code) return json({ error: "Invalid code format." }, 400, headers);
  try {
    const entries = parseAccessCodes(env.ACCESS_CODES);
    const ipKey = await addressKey(request);
    const begin = await (await guardCall(env, "begin", { ipKey })).json();
    if (!begin.allowed)
      return json({ error: "Too many attempts.", retryAfterSeconds: begin.retryAfterSeconds }, 429, {
        ...headers,
        "retry-after": String(begin.retryAfterSeconds),
      });
    const user = await checkCode(code, entries);
    if (!user) return json({ error: "Wrong code." }, 401, headers);
    await guardCall(env, "finish", { ipKey, stamp: begin.stamp });
    const { token, expiresAt } = await signToken(user, env.TOKEN_SIGNING_KEY);
    return json({ token, user, expiresAt }, 200, headers);
  } catch (error) {
    // A broken secret or an unreachable guard fails closed. The reason goes to the log, never to the caller.
    console.error("Login failed:", error instanceof AccessConfigError ? error.message : error?.name);
    return json({ error: "Login is not available." }, 503, headers);
  }
}

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
const GEMINI_TIMEOUT_MS = 120_000;
const GEMINI_STREAM_TIMEOUT_MS = 300_000;

// What the caller learns about a Gemini failure. Gemini's own message is not passed on: it may quote the input.
function geminiFailure(status, headers) {
  if (status === 429) return json({ error: "Gemini is busy. Try again in a minute.", code: "busy" }, 429, headers);
  // 402: the Google project has to be paid (seen on 21 October 2026); only the owner can fix it, so the page says so.
  if (status === 402) return json({ error: "Gemini needs payment: check the billing of the Google project.", code: "billing" }, 502, headers);
  if (status >= 500) return json({ error: "Gemini is unavailable. Try again.", code: "unavailable" }, 502, headers);
  return json({ error: "Gemini rejected the request.", code: "rejected" }, 502, headers);
}

async function modelCall(request, env, headers) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, headers);
  if (!env.GEMINI_API_KEY) return json({ error: "The model is not configured." }, 503, headers);
  let user;
  try {
    user = await requireUser(request, env);
  } catch (error) {
    console.error("Token check failed:", error instanceof AccessConfigError ? error.message : error?.name);
    return json({ error: "Login is not available." }, 503, headers);
  }
  if (!user) return json({ error: "Login required.", code: "login" }, 401, headers);
  const text = await readLimitedText(request, MAX_REQUEST_BYTES);
  if (text === null) return json({ error: "The request is too large.", code: "too-large" }, 413, headers);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "The body is not valid JSON." }, 400, headers);
  }
  const checked = validateModelCall(body);
  if (!checked.ok) return json({ error: checked.error }, 400, headers);
  const { model, stream, request: payload } = checked;
  const url = `${GEMINI_BASE}${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
  let upstream;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY.trim() },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(stream ? GEMINI_STREAM_TIMEOUT_MS : GEMINI_TIMEOUT_MS),
    });
  } catch {
    return json({ error: "Gemini is unavailable. Try again.", code: "unavailable" }, 502, headers);
  }
  // Only the status is logged: never the request, the answer or Gemini's message.
  if (!upstream.ok) {
    console.error("Gemini answered", upstream.status);
    return geminiFailure(upstream.status, headers);
  }
  if (stream)
    return new Response(upstream.body, {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", ...headers },
    });
  let answer;
  try {
    answer = await upstream.json();
  } catch {
    return json({ error: "Gemini returned an unreadable answer.", code: "unavailable" }, 502, headers);
  }
  return json(answer, 200, headers);
}

// Step 7.4: the baton "who works". GET /v1/baton reads it; POST /v1/baton/beat takes or keeps it and POST
// /v1/baton/release gives it back, both with { device, deviceName, snapshot?, force? }. The user comes from the token;
// the time is the Worker's own (a body never sets it).
async function batonCall(request, env, headers, action) {
  if (request.method !== (action === "get" ? "GET" : "POST")) return json({ error: "Method not allowed." }, 405, headers);
  if (!env.BATON) return json({ error: "The baton is not configured." }, 503, headers);
  let user;
  try {
    user = await requireUser(request, env);
  } catch (error) {
    console.error("Token check failed:", error instanceof AccessConfigError ? error.message : error?.name);
    return json({ error: "Login is not available." }, 503, headers);
  }
  if (!user) return json({ error: "Login required.", code: "login" }, 401, headers);
  let body = {};
  if (action !== "get") {
    const text = await readLimitedText(request, MAX_BATON_BODY_BYTES);
    if (text === null) return json({ error: "The request is too large.", code: "too-large" }, 413, headers);
    try {
      const { device, deviceName, snapshot, force } = JSON.parse(text);
      body = { device, deviceName, snapshot, force, user: user.user };
    } catch {
      return json({ error: "The body is not valid JSON." }, 400, headers);
    }
  }
  try {
    const stub = env.BATON.get(env.BATON.idFromName("baton"));
    const answer = await stub.fetch(`https://baton/${action}`, { method: "POST", body: JSON.stringify(body) });
    return json(await answer.json(), answer.status, headers);
  } catch (error) {
    console.error("Baton failed:", error?.name);
    return json({ error: "The baton is not available." }, 503, headers);
  }
}

const BATON_ROUTES = { "/v1/baton": "get", "/v1/baton/beat": "beat", "/v1/baton/release": "release" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(request, env) });
    if (url.pathname === "/health")
      return json({ ok: true, version: env.BACKEND_VERSION || "unknown" }, 200, cors(request, env));
    const rejected = clientRequest(request, env);
    if (rejected) return rejected;
    if (url.pathname === "/v1/auth") return authenticate(request, env, cors(request, env));
    if (url.pathname === "/v1/model") return modelCall(request, env, cors(request, env));
    if (BATON_ROUTES[url.pathname]) return batonCall(request, env, cors(request, env), BATON_ROUTES[url.pathname]);
    return json({ error: "Not found." }, 404, cors(request, env));
  },
};
