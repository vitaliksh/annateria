// Durable Object that holds the baton "who works" (WORK_PLAN 7.4): the two PCs never work at the same time, and this one
// record says which device works now. It is bound to a device (a random id and a name kept in the browser), not to the
// access code. A device keeps the baton with a beat every minute; after BATON_TTL_MS of silence (closed, asleep, powered
// off) the baton is free. The record also keeps the name of the last snapshot a holder pushed to the shared Drive folder,
// so the next device knows which data to wait for. No client data: ids, names, times and a snapshot file name.
// One instance answers for the whole Worker (as AuthGuard does), so two devices can never both take the baton.

export const BATON_TTL_MS = 3 * 60 * 1000;
const STATE_KEY = "baton";
const DEVICE = /^[a-z0-9-]{8,64}$/;
const SNAPSHOT = /^snap-\d{8}T\d{6}Z-[0-9a-f]{1,16}\.bin$/;
const MAX_NAME = 40;

const json = (value, status = 200) => Response.json(value, { status });

// A device name is shown to the other person: one line, no control characters, at most 40 characters.
export function cleanDeviceName(value) {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  return name || null;
}

function view(state, now) {
  const holder = state.holder;
  const live = Boolean(holder && !holder.released && now - holder.lastBeat < BATON_TTL_MS);
  return { now, live, holder: holder ?? null, snapshot: state.snapshot ?? null };
}

export class Baton {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const action = new URL(request.url).pathname.replace(/^\//, "");
    let body = {};
    try {
      body = await request.json();
    } catch {
      return json({ error: "Bad request." }, 400);
    }
    const now = Number.isFinite(body.now) ? body.now : Date.now();
    const state = (await this.state.storage.get(STATE_KEY)) ?? { holder: null, snapshot: null };
    if (action === "get") return json(view(state, now));
    if (typeof body.device !== "string" || !DEVICE.test(body.device)) return json({ error: "Bad device." }, 400);
    if (body.snapshot != null && (typeof body.snapshot !== "string" || !SNAPSHOT.test(body.snapshot)))
      return json({ error: "Bad snapshot name." }, 400);
    if (action === "beat") return this.beat(state, body, now);
    if (action === "release") return this.release(state, body, now);
    return json({ error: "Not found." }, 404);
  }

  // Take a free baton or keep one's own. Refused while another device is live, unless `force` ("start anyway");
  // the answer then names the device that lost it. `since` changes only when the baton changes hands.
  async beat(state, { device, deviceName, user, snapshot, force }, now) {
    const name = cleanDeviceName(deviceName);
    if (!name) return json({ error: "Bad device name." }, 400);
    const before = view(state, now);
    const own = state.holder?.device === device && !state.holder.released;
    if (!own && before.live && force !== true)
      return json({ error: "Another device is working.", code: "taken", ...before }, 409);
    const previous = own ? null : state.holder;
    state.holder = {
      device,
      deviceName: name,
      user: typeof user === "string" ? user : null,
      since: own ? state.holder.since : now,
      lastBeat: now,
      released: false,
    };
    if (snapshot) state.snapshot = { name: snapshot, at: now, device, deviceName: name };
    await this.state.storage.put(STATE_KEY, state);
    return json({ ok: true, took: !own, forced: !own && before.live, previous, ...view(state, now) });
  }

  // "Finish work": the holder gives the baton back, with the snapshot it pushed last. Anybody else is refused.
  async release(state, { device, snapshot }, now) {
    if (state.holder?.device !== device || state.holder.released)
      return json({ error: "This device does not hold the baton.", code: "not-holder", ...view(state, now) }, 409);
    state.holder = { ...state.holder, lastBeat: now, released: true };
    if (snapshot) state.snapshot = { name: snapshot, at: now, device, deviceName: state.holder.deviceName };
    await this.state.storage.put(STATE_KEY, state);
    return json({ ok: true, ...view(state, now) });
  }
}
