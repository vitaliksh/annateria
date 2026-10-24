// The phone scans in the inbox dialog (WORK_PLAN 2.5): every 30 s, while this PC holds the baton (the green plate), phone/ of
// the shared folder is checked (phone-intake.js); the button checks at once, for a pile of scans. The line beside it tells what
// came. The shared folder is the one chosen for the copies (7.3, IndexedDB); without it the button only says so.
import { takePhoneScans } from "./phone-intake.js";
import { SYNC_FOLDER_KEY, readSetting } from "./backup-handles.js";

export const CHECK_EVERY_MS = 30 * 1000;

const formatTime = (iso) => new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });

// canCheck({ interactive }) answers whether this PC may take scans now: the timer only while it holds the baton, the button
// also when nobody does. onTaken(result) runs after a check that took or deleted something.
export function setupPhoneIntake({
  button,
  line,
  getDataRoot,
  getSharedFolder = () => readSetting(SYNC_FOLDER_KEY),
  canCheck = async () => true,
  onTaken = () => {},
  take = takePhoneScans,
  now = () => new Date().toISOString(),
  timers = globalThis,
  everyMs = CHECK_EVERY_MS,
}) {
  let running = false;
  let interval = null;

  const say = (text, state = "idle") => {
    line.textContent = text;
    line.dataset.state = state;
  };

  function summary(result, at) {
    const parts = [];
    const came = result.added.length;
    if (came) parts.push(came === 1 ? "התקבלה סריקה אחת מהטלפון" : `התקבלו ${came} סריקות מהטלפון`);
    if (result.duplicates.length) parts.push(`${result.duplicates.length} כפולות דולגו`);
    if (result.waiting.length) parts.push(`${result.waiting.length} עוד בדרך`);
    if (result.refused.length) parts.push(`${result.refused.length} מסוג שאינו נתמך נשארו בתיקייה`);
    if (result.failed.length) parts.push(`${result.failed.length} לא נקראו וייבדקו שוב`);
    return parts.length ? `${parts.join(" · ")} (${formatTime(at)}).` : `אין סריקות חדשות מהטלפון (נבדק ב־${formatTime(at)}).`;
  }

  async function allowed(handle, interactive) {
    if (typeof handle.queryPermission !== "function") return true;
    let permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted" && interactive) permission = await handle.requestPermission({ mode: "readwrite" });
    return permission === "granted";
  }

  // interactive: started by the button, so the browser may ask for the folder permissions.
  async function check({ interactive = false } = {}) {
    if (running) return null;
    const root = getDataRoot();
    const shared = (await Promise.resolve(getSharedFolder()).catch(() => null)) ?? null;
    if (!root || !shared) {
      if (interactive) say(root ? "לא נבחרה תיקייה משותפת (חלון «גיבוי»)." : "יש לבחור תחילה תיקיית נתונים.", "error");
      return null;
    }
    const may = await canCheck({ interactive });
    if (may !== true) {
      if (interactive) say(typeof may === "string" ? may : "ANNATERIA פתוחה במחשב אחר: הסריקות יילקחו שם.", "error");
      return null;
    }
    if (!(await allowed(root, interactive)) || !(await allowed(shared, interactive))) {
      say("יש ללחוץ על «בדוק סריקות מהטלפון» כדי לאשר גישה לתיקיות.", "error");
      return null;
    }
    running = true;
    button.disabled = true;
    if (interactive) say("בודק סריקות מהטלפון…", "running");
    try {
      const at = now();
      const result = await take({ dataRoot: root, shared, now: at });
      const quiet = !interactive && !result.added.length && !result.duplicates.length && !result.refused.length
        && !result.failed.length && !result.waiting.length;
      if (!quiet) say(summary(result, at), result.failed.length ? "error" : "ok");
      if (result.added.length || result.duplicates.length) await onTaken(result);
      return result;
    } catch (error) {
      say(`בדיקת הסריקות מהטלפון נכשלה: ${error.message}`, "error");
      return null;
    } finally {
      running = false;
      button.disabled = false;
    }
  }

  // The timer runs only once a shared folder is chosen; the host calls start() again when one is.
  async function start() {
    if (interval !== null) return;
    const shared = await Promise.resolve(getSharedFolder()).catch(() => null);
    if (shared && interval === null) interval = timers.setInterval(() => check().catch(() => {}), everyMs);
  }

  function stop() {
    timers.clearInterval(interval);
    interval = null;
  }

  button.addEventListener("click", () => { check({ interactive: true }).catch(() => {}); });
  say("");
  return { check, start, stop };
}
