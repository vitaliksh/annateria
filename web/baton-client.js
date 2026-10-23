// The baton "who works" of the Worker (WORK_PLAN 7.4, worker/src/baton.js) seen from the page: which device works now.
// Every call needs the access token; without it nothing is sent. Answers are { ok: true, data } or
// { ok: false, reason, status?, data? } with reason "login" (no token), "network", "taken", "not-holder" or "unavailable";
// never rejects.

// The device is a random id kept in the browser (IndexedDB); the name shown to the other person comes from the user of the
// access code, so nobody is asked anything.
export const DEVICE_KEY = "device-id";
const USER_NAMES = { anna: "אנה", vitalik: "ויטליק" };

export const displayName = (user) => USER_NAMES[user] ?? (typeof user === "string" && user ? user : "מחשב");

export async function deviceId({ readSetting, writeSetting, random = () => crypto.randomUUID() }) {
  const stored = await readSetting(DEVICE_KEY).catch(() => null);
  if (typeof stored === "string" && /^[a-z0-9-]{8,64}$/.test(stored)) return stored;
  const created = random().toLowerCase();
  await writeSetting(DEVICE_KEY, created).catch(() => {});
  return created;
}

export function createBatonClient({ api, access, fetchImpl = (...args) => fetch(...args) }) {
  async function call(path, body) {
    const auth = access.authHeaders();
    if (!api) return { ok: false, reason: "unavailable" };
    if (!auth) return { ok: false, reason: "login" };
    let response;
    try {
      response = await fetchImpl(`${api}${path}`, body === undefined
        ? { method: "GET", headers: auth }
        : { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      return { ok: false, reason: "network" };
    }
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (response.ok && data) return { ok: true, data };
    if (response.status === 401) return { ok: false, reason: "login", status: 401 };
    if (response.status === 409 && data?.code) return { ok: false, reason: data.code, status: 409, data };
    return { ok: false, reason: "unavailable", status: response.status };
  }

  return {
    get: () => call("/v1/baton"),
    beat: ({ device, deviceName, snapshot, force }) => call("/v1/baton/beat", { device, deviceName, snapshot, force }),
    release: ({ device, snapshot }) => call("/v1/baton/release", { device, snapshot }),
  };
}
