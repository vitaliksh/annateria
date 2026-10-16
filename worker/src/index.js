// ANNATERIA Worker. Until step 1.1 (access code) and 1.2 (model proxy) it answers /health only: no route here may
// reach Gemini without an authorisation that this file checks.

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
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "GET, POST, OPTIONS",
      }
    : {};
}

function clientRequest(request, env) {
  if (!allowedOrigin(request, env)) return json({ error: "This browser origin is not allowed." }, 403);
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(request, env) });
    if (url.pathname === "/health")
      return json({ ok: true, version: env.BACKEND_VERSION || "unknown" }, 200, cors(request, env));
    const rejected = clientRequest(request, env);
    if (rejected) return rejected;
    return json({ error: "Not found." }, 404, cors(request, env));
  },
};
