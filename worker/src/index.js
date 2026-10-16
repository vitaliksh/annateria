// ANNATERIA Worker. Step 1.1: the access code. POST /v1/auth turns a 6-character code into a signed token that the
// browser keeps in page memory. Step 1.2 adds the model proxy, which must call requireUser() before anything else:
// no route here may reach Gemini without it.
import { AccessConfigError, checkCode, normalizeCode, parseAccessCodes, signToken, verifyToken } from "./access.js";

export { AuthGuard } from "./auth-guard.js";

const MAX_AUTH_BODY_BYTES = 1024;

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(request, env) });
    if (url.pathname === "/health")
      return json({ ok: true, version: env.BACKEND_VERSION || "unknown" }, 200, cors(request, env));
    const rejected = clientRequest(request, env);
    if (rejected) return rejected;
    if (url.pathname === "/v1/auth") return authenticate(request, env, cors(request, env));
    return json({ error: "Not found." }, 404, cors(request, env));
  },
};
