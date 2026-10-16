// Durable Object that counts login attempts (step 1.1). A Durable Object is used because the Workers Rate Limiting
// binding is per location and "eventually consistent" by design (developers.cloudflare.com, checked 16 Oct 2026),
// which a lock-out must not be. One instance answers for the whole Worker, so its state is the single truth.
//
// Every attempt is counted when it STARTS and given back when it succeeds. Parallel guesses therefore cannot slip
// through before their failures are recorded.

export const IP_MAX_ATTEMPTS = 5;
export const IP_WINDOW_MS = 15 * 60 * 1000;
export const IP_LOCK_MS = 15 * 60 * 1000;
export const GLOBAL_MAX_ATTEMPTS = 20;
export const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const STATE_KEY = "state";

const json = (value, status = 200) => Response.json(value, { status });

export class AuthGuard {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const action = new URL(request.url).pathname.replace(/^\//, "");
    const { ipKey, now = Date.now(), stamp } = await request.json();
    if (typeof ipKey !== "string" || !ipKey) return json({ error: "Bad request." }, 400);
    if (action === "begin") return this.begin(ipKey, now);
    if (action === "finish") return this.finish(ipKey, stamp);
    return json({ error: "Not found." }, 404);
  }

  async load() {
    return (await this.state.storage.get(STATE_KEY)) ?? { ips: {}, stamps: [] };
  }

  async begin(ipKey, now) {
    const state = await this.load();
    state.stamps = state.stamps.filter((stamp) => stamp > now - GLOBAL_WINDOW_MS);
    for (const [key, record] of Object.entries(state.ips))
      if (record.lockedUntil <= now && now - record.firstAt > IP_WINDOW_MS) delete state.ips[key];
    const deny = async (retryAfterMs, scope) => {
      await this.state.storage.put(STATE_KEY, state);
      return json({ allowed: false, scope, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) });
    };
    const record = state.ips[ipKey] ?? { count: 0, firstAt: now, lockedUntil: 0 };
    if (record.lockedUntil > now) return deny(record.lockedUntil - now, "ip");
    if (state.stamps.length >= GLOBAL_MAX_ATTEMPTS) return deny(state.stamps[0] + GLOBAL_WINDOW_MS - now, "global");
    record.count += 1;
    if (record.count > IP_MAX_ATTEMPTS) {
      record.lockedUntil = now + IP_LOCK_MS;
      state.ips[ipKey] = record;
      return deny(IP_LOCK_MS, "ip");
    }
    state.ips[ipKey] = record;
    state.stamps.push(now);
    await this.state.storage.put(STATE_KEY, state);
    return json({ allowed: true, stamp: now });
  }

  // A correct code clears the counter of this address and gives the global attempt back.
  async finish(ipKey, stamp) {
    const state = await this.load();
    delete state.ips[ipKey];
    const index = state.stamps.indexOf(stamp);
    if (index >= 0) state.stamps.splice(index, 1);
    await this.state.storage.put(STATE_KEY, state);
    return json({ ok: true });
  }
}
