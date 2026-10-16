// Access session (WORK_PLAN step 1.1): the 6-character code is exchanged at the Worker for a token that lives only in this
// object, i.e. in page memory. Nothing is written to localStorage, sessionStorage, IndexedDB or a file, so a reload (or
// another tab) asks for the code again. Step 1.2 adds the model calls, which take the token from authHeaders().

export const CODE_LENGTH = 6;

// What the person typed, without spaces and dashes, upper case. The Worker checks the alphabet and the hash.
export function cleanCode(text) {
  return String(text ?? "").toUpperCase().replace(/[\s-]/g, "");
}

export function createAccess({ api, fetchImpl = (...args) => fetch(...args), now = () => Date.now() }) {
  let session = null; // { token, user, expiresAt } — never persisted

  const active = () => (session && now() < session.expiresAt ? session : null);

  // Resolves with { ok: true, user } or { ok: false, reason, retryAfterSeconds? }; never rejects.
  async function login(typed) {
    const code = cleanCode(typed);
    if (code.length !== CODE_LENGTH) return { ok: false, reason: "format" };
    if (!api) return { ok: false, reason: "unavailable" };
    let response;
    try {
      response = await fetchImpl(`${api}/v1/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
    } catch {
      return { ok: false, reason: "network" };
    }
    let body = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    if (response.ok && typeof body.token === "string") {
      session = { token: body.token, user: body.user, expiresAt: Number(body.expiresAt) || now() };
      return { ok: true, user: body.user };
    }
    if (response.status === 400) return { ok: false, reason: "format" };
    if (response.status === 401) return { ok: false, reason: "wrong" };
    if (response.status === 429)
      return { ok: false, reason: "locked", retryAfterSeconds: Number(body.retryAfterSeconds) || Number(response.headers?.get?.("retry-after")) || 0 };
    return { ok: false, reason: "unavailable" };
  }

  return {
    login,
    logout: () => {
      session = null;
    },
    isLoggedIn: () => Boolean(active()),
    user: () => active()?.user ?? null,
    authHeaders: () => (active() ? { Authorization: `Bearer ${active().token}` } : null),
  };
}
