// The plate "who works" in the top bar (WORK_PLAN 7.4.2): one PC works at a time, and this plate always shows which.
//   here    (green)  this device holds the baton; a click finishes the work at once
//   other   (red)    another device works; the table is read only; a click starts anyway after a question
//   paused  (yellow) given back after 10 minutes without a click or a key, or by the click on the green plate;
//                    the next click or key in the page takes the baton again when it is free
//   unknown (grey)   no access code or no connection: work is allowed, nobody could be asked
// The device beats every minute while it holds the baton (the Worker frees a baton after 3 silent minutes), asks every
// 30 seconds while it waits, and asks again when the tab comes back to the front.
import { displayName } from "./baton-client.js";
import { confirmDialog } from "./confirm-dialog.js";

export const BEAT_MS = 60 * 1000;
export const POLL_MS = 30 * 1000;
export const IDLE_MS = 10 * 60 * 1000;

const LABEL = { here: "עובדים כאן", paused: "מושהה", unknown: "לא נבדק" };
const formatTime = (ms) => new Date(ms).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });

// plate: the top-bar button. client: createBatonClient(). getDevice(): { device, user } of this browser.
// pushNow(): sends the last copy before the baton is given back. onChange(state): the host locks the table on "other".
export function setupBaton({
  plate,
  client,
  getDevice,
  pushNow = async () => {},
  ensureLoggedIn = async () => null,
  onChange = () => {},
  confirm = confirmDialog,
  timers = globalThis,
  now = () => Date.now(),
  activityTarget = globalThis.document,
}) {
  let state = "unknown";
  let reason = "login";
  let holder = null;
  let snapshot = null;
  let timer = null;
  let lastActivity = now();
  let queue = Promise.resolve();
  let pausing = false;
  let holderUser = null;

  function render() {
    plate.dataset.state = state;
    const otherName = holder && holder.user === holderUser ? "במחשב אחר" : `אצל ${holder?.deviceName ?? "מחשב אחר"}`;
    plate.textContent = state === "other" ? `פתוח ${otherName}` : LABEL[state];
    const lastCopy = snapshot ? ` עותק אחרון משם: ${formatTime(snapshot.at)}.` : "";
    const lastSign = holder ? formatTime(holder.lastBeat) : "—";
    const title = {
      here: "ANNATERIA פתוחה לעבודה במחשב הזה. לחיצה מסיימת את העבודה, והמחשב השני יכול להתחיל.",
      other: `הטבלה לקריאה בלבד עד שיסגרו את ANNATERIA שם (סימן אחרון: ${lastSign}).${lastCopy} לחיצה: להתחיל בכל זאת.`,
      paused: "העבודה הושהתה, והמחשב השני יכול להתחיל. לחיצה או הקלדה ימשיכו.",
      unknown: reason === "login"
        ? "לא הוזן קוד גישה, ולכן לא נבדק אם ANNATERIA פתוחה במחשב אחר. לחיצה: הזנת קוד."
        : "אין חיבור לשרת, ולכן לא נבדק אם ANNATERIA פתוחה במחשב אחר. לחיצה: לבדוק שוב.",
    }[state];
    plate.title = title;
    plate.setAttribute("aria-label", `${plate.textContent}. ${title}`);
  }

  function setState(next, data = null) {
    const before = state;
    state = next;
    if (data) {
      holder = data.holder ?? null;
      snapshot = data.snapshot ?? null;
    }
    render();
    schedule();
    if (before !== next) onChange(next);
  }

  function schedule() {
    timers.clearTimeout(timer);
    timer = null;
    const wait = { here: BEAT_MS, other: POLL_MS, unknown: POLL_MS }[state];
    if (wait) timer = timers.setTimeout(() => tick().catch(() => {}), wait);
  }

  async function tick() {
    if (state === "here" && now() - lastActivity >= IDLE_MS) return pause();
    return check();
  }

  // One request at a time, in the order asked: a "start anyway" is never swallowed by a beat that is on its way.
  function serial(action) {
    const next = queue.then(action);
    queue = next.catch(() => {});
    return next;
  }

  // Take the baton or keep it (force: "start anyway"); `pushed` reports the snapshot just written to the shared folder.
  function check({ force = false, pushed } = {}) {
    return serial(async () => {
      const { device, user } = await getDevice();
      holderUser = user ?? null;
      const answer = await client.beat({ device, deviceName: displayName(user), snapshot: pushed, force: force || undefined });
      if (answer.ok) setState("here", answer.data);
      else if (answer.reason === "taken") setState("other", answer.data);
      else {
        reason = answer.reason === "login" ? "login" : "network";
        setState("unknown");
      }
      return state;
    });
  }

  // Give the baton back: the last copy first, then the release, so the other device knows which copy to wait for.
  function pause() {
    pausing = true;
    return serial(releaseNow).finally(() => { pausing = false; });
  }

  async function releaseNow() {
    let pushed;
    try {
      pushed = await pushNow();
    } catch {
      pushed = undefined;
    }
    const { device } = await getDevice();
    const answer = await client.release({ device, snapshot: pushed ?? undefined });
    if (answer.reason === "not-holder" && answer.data?.live) setState("other", answer.data);
    else setState("paused", answer.ok ? answer.data : null);
    return state;
  }

  async function onClick() {
    if (state === "here") {
      const ok = await confirm("לסיים את העבודה? העותק האחרון יישלח, והמחשב השני יוכל להתחיל.", {
        title: "סיום עבודה",
        confirmLabel: "סיום",
      });
      if (ok) await pause();
      return;
    }
    if (state === "other") {
      const who = holder?.deviceName ?? "המחשב האחר";
      const ok = await confirm(
        `ANNATERIA פתוחה אצל ${who}. להתחיל כאן בכל זאת? שינויים שנעשו שם ולא נשלחו עלולים ללכת לאיבוד.`,
        { title: "להתחיל בכל זאת", confirmLabel: "להתחיל" },
      );
      if (ok) await check({ force: true });
      return;
    }
    if (state === "unknown" && reason === "login") await ensureLoggedIn();
    await check();
  }

  function onActivity(event) {
    lastActivity = now();
    if (state === "paused" && (event.type === "keydown" || event.type === "pointerdown") && event.target !== plate) {
      check().catch(() => {});
    }
  }

  plate.addEventListener("click", () => { onClick().catch(() => {}); });
  for (const type of ["pointerdown", "pointermove", "keydown", "wheel"]) {
    activityTarget?.addEventListener(type, onActivity, { passive: true, capture: true });
  }
  activityTarget?.addEventListener("visibilitychange", () => {
    if (activityTarget.visibilityState === "visible" && state !== "paused") check().catch(() => {});
  });
  render();

  return {
    check,
    pause,
    state: () => state,
    // The table is read only while another device works.
    blocksEditing: () => state === "other",
    // A copy is not sent while another device holds the baton; that device's copy is the one that counts.
    canPush: () => state !== "other",
    // Not awaited by the copy: during a pause the release itself carries the name.
    reportPushed: (name) => (state === "here" && !pausing ? check({ pushed: name }) : Promise.resolve(state)),
    stop: () => { timers.clearTimeout(timer); timer = null; },
  };
}
