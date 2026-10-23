// The shared folder of the two PCs (WORK_PLAN 7.3): its section in the backup dialog and the ☁ icon in the top bar. After a save
// the host calls changed(); ten seconds later (7.4.2: was one minute), and every five minutes as a safety net for the other
// writes (agent, inbox, rules), a snapshot goes to the shared folder (sync-store.js), only when something changed. A failure
// only turns the icon red: the work goes on. The folder handle and the key live in IndexedDB (backup-handles.js), the time of
// the last push in common/sync-state.json. 7.4.3: pull() takes the other device's snapshot into the data root.
import { pullSnapshot, pushSnapshot, readSyncState, saveSyncState } from "./sync-store.js";
import { BACKUP_KEY_NAME, SYNC_FOLDER_KEY, readSetting, writeSetting } from "./backup-handles.js";

export const PUSH_AFTER_SAVE_MS = 10 * 1000;
export const PUSH_EVERY_MS = 5 * 60 * 1000;

const ICON = { idle: "☁", ok: "☁ ✓", running: "☁ …", click: "☁ !", error: "☁ ✗" };
const formatTime = (iso) => new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
const formatDateTime = (iso) => new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
const seconds = (ms) => (ms / 1000).toLocaleString("he-IL", { maximumFractionDigits: 1 });

// icon: the top-bar button; section: the "shared folder" part of the backup dialog. getDataRoot() returns the root or null.
export function setupSync({
  icon,
  section,
  getDataRoot,
  store = { readSetting, writeSetting },
  pickDirectory = () => window.showDirectoryPicker({ id: "annateria-sync", mode: "readwrite" }),
  now = () => new Date().toISOString(),
  timers = globalThis,
  // 7.4.2: no copy while another device holds the baton; the name of each new snapshot goes to the baton (not awaited).
  canPush = () => true,
  onPushed = () => {},
  afterSaveMs = PUSH_AFTER_SAVE_MS,
  everyMs = PUSH_EVERY_MS,
}) {
  const folderLine = section.querySelector('[data-role="folder"]');
  const stateLine = section.querySelector('[data-role="state"]');
  const chooseButton = section.querySelector('[data-action="choose"]');
  const runButton = section.querySelector('[data-action="run"]');
  let folder = null;
  let lastPush = null;
  let checkedAt = null;
  let status = { kind: "idle", text: "" };
  let running = false;
  let pending = null;
  let again = false;
  let afterSave = null;
  let interval = null;

  function okText() {
    const last = lastPush
      ? ` עותק אחרון: ${formatDateTime(lastPush.at)} · ${lastPush.files} קבצים · ${seconds(lastPush.ms)} שניות.`
      : "";
    return `העותק בתיקייה המשותפת מעודכן (נבדק ב־${formatTime(checkedAt)}).${last}`;
  }

  function render() {
    const kind = status.kind;
    const text = kind === "ok" ? okText() : status.text;
    icon.hidden = !folder;
    icon.dataset.state = kind;
    icon.textContent = kind === "ok" ? `${ICON.ok} ${formatTime(checkedAt)}` : ICON[kind];
    icon.title = text;
    icon.setAttribute("aria-label", text);
    folderLine.textContent = folder ? `תיקייה: «${folder.name}»` : "טרם נבחרה תיקייה משותפת.";
    stateLine.textContent = folder || kind === "error" ? text : "";
    stateLine.dataset.state = kind;
    runButton.disabled = !folder || running;
    chooseButton.disabled = running;
  }

  const setStatus = (kind, text = "") => { status = { kind, text }; render(); };

  async function refresh() {
    folder = (await store.readSetting(SYNC_FOLDER_KEY).catch(() => null)) ?? null;
    schedule();
    const root = getDataRoot();
    lastPush = root ? (await readSyncState(root).catch(() => null))?.lastPush ?? null : null;
    checkedAt = null;
    if (!running) {
      const text = lastPush
        ? `עותק אחרון: ${formatDateTime(lastPush.at)}. לחיצה תבדוק ותשלח עכשיו.`
        : "טרם נשלח עותק. לחיצה תשלח עכשיו.";
      setStatus("idle", text);
    }
  }

  // interactive: started by a click, so the browser may be asked for the folder permission.
  async function push({ interactive = false } = {}) {
    if (running) {
      again = true;
      return;
    }
    const root = getDataRoot();
    if (!root || !folder) return;
    if (!canPush()) {
      setStatus("idle", "לא נשלח עותק: ANNATERIA פתוחה במחשב אחר.");
      return;
    }
    if (typeof root.queryPermission === "function" && (await root.queryPermission({ mode: "readwrite" })) !== "granted") return;
    const key = (await store.readSetting(BACKUP_KEY_NAME).catch(() => null)) ?? null;
    if (!key) {
      setStatus("error", "אין במחשב הזה קוד שחזור. יש ליצור אותו או להזין אותו בחלון «גיבוי».");
      return;
    }
    let permission = await folder.queryPermission({ mode: "readwrite" });
    if (permission !== "granted" && interactive) permission = await folder.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") {
      setStatus("click", "יש ללחוץ כאן כדי לאשר גישה לתיקייה המשותפת.");
      return;
    }
    running = true;
    setStatus("running", "שולח עותק לתיקייה המשותפת…");
    try {
      const at = now();
      const result = await pushSnapshot({ source: root, shared: folder, key, now: at });
      if (!result.unchanged) {
        lastPush = { name: result.name, at, files: result.files, ms: result.ms };
        Promise.resolve().then(() => onPushed(result.name)).catch(() => {});
      }
      checkedAt = at;
      if (result.skipped.length) {
        status = { kind: "error", text: `העותק נשלח, אבל ${result.skipped.length} קבצים לא נקראו ולא נשלחו. לחיצה תנסה שוב.` };
      } else {
        status = { kind: "ok", text: "" };
      }
    } catch (error) {
      status = { kind: "error", text: `השליחה לתיקייה המשותפת נכשלה: ${error.message}. לחיצה תנסה שוב.` };
    } finally {
      running = false;
      render();
    }
    if (again) {
      again = false;
      await push();
    }
  }

  // The host calls this after a save; many saves in a row give one push a minute after the last one. No folder, no timer.
  function changed() {
    if (!folder) return;
    timers.clearTimeout(afterSave);
    afterSave = timers.setTimeout(() => push().catch(() => {}), afterSaveMs);
  }

  // The five-minute safety net runs only while a shared folder is chosen.
  let wanted = false;
  function schedule() {
    if (!wanted || !folder || interval !== null) return;
    interval = timers.setInterval(() => push().catch(() => {}), everyMs);
  }

  function start() {
    wanted = true;
    schedule();
  }

  function stop() {
    wanted = false;
    timers.clearTimeout(afterSave);
    timers.clearInterval(interval);
    interval = null;
  }

  // A folder inside the data root would be copied into itself and die with it.
  async function choose() {
    const picked = await pickDirectory();
    const root = getDataRoot();
    if (typeof root?.resolve === "function" && (await root.resolve(picked))) {
      setStatus("error", "לא ניתן לבחור תיקייה בתוך תיקיית הנתונים.");
      return;
    }
    await store.writeSetting(SYNC_FOLDER_KEY, picked);
    folder = picked;
    schedule();
    await push({ interactive: true });
  }

  // 7.4.3: take the snapshot `name` of the other device. Never waits: answers { applied: false, message } while the copy
  // has not fully arrived or something is missing (the caller asks again), { applied: true, written, removed, before } once
  // the data root equals it. interactive: started by a click, so the browser may ask for the folder permissions.
  async function pull(name, { interactive = false, beforeWrite } = {}) {
    pending = name;
    const root = getDataRoot();
    if (!root) return { applied: false, message: "יש לבחור תיקיית נתונים." };
    if (!folder) return { applied: false, message: "לא נבחרה תיקייה משותפת (חלון «גיבוי»)." };
    if (running) return { applied: false, message: "ממתין לסיום השליחה הקודמת." };
    const key = (await store.readSetting(BACKUP_KEY_NAME).catch(() => null)) ?? null;
    if (!key) return { applied: false, message: "אין במחשב הזה קוד שחזור (חלון «גיבוי»)." };
    for (const handle of [root, folder]) {
      if (typeof handle.queryPermission !== "function") continue;
      let permission = await handle.queryPermission({ mode: "readwrite" });
      if (permission !== "granted" && interactive) permission = await handle.requestPermission({ mode: "readwrite" });
      if (permission !== "granted") {
        setStatus("click", "יש ללחוץ כאן כדי לאשר גישה לתיקיות ולקבל את הנתונים מהמחשב השני.");
        return { applied: false, message: "יש ללחוץ על ☁ כדי לאשר גישה לתיקיות." };
      }
    }
    running = true;
    setStatus("running", "מקבל נתונים מהתיקייה המשותפת…");
    try {
      const at = now();
      const result = await pullSnapshot({ root, shared: folder, key, name, now: at, beforeWrite });
      if (!result.applied) {
        const message = result.reason === "key"
          ? "העותק הוצפן בקוד שחזור אחר. יש להזין בחלון «גיבוי» את אותו קוד בשני המחשבים."
          : "ממתין ל‑Google Drive: העותק מהמחשב השני עוד לא הגיע במלואו.";
        status = { kind: result.reason === "key" ? "error" : "running", text: message };
        return { applied: false, message };
      }
      pending = null;
      lastPush = (await readSyncState(root)).lastPush;
      checkedAt = at;
      status = { kind: "ok", text: "" };
      return result;
    } catch (error) {
      status = { kind: "error", text: `קבלת הנתונים נכשלה: ${error.message}` };
      return { applied: false, message: status.text };
    } finally {
      running = false;
      render();
    }
  }

  // 7.4.3: "work with the data of this PC": the other device's snapshot `name` counts as taken, so it is not asked for again.
  async function skip(name) {
    const root = getDataRoot();
    pending = null;
    if (!root) return;
    const state = await readSyncState(root);
    const base = state.lastPush ?? { at: now(), digest: "", files: 0, ms: 0 };
    await saveSyncState(root, { lastPush: { ...base, name }, applying: null });
  }

  icon.addEventListener("click", () => {
    (pending ? pull(pending, { interactive: true }) : push({ interactive: true })).catch(() => {});
  });
  runButton.addEventListener("click", () => { push({ interactive: true }).catch(() => {}); });
  chooseButton.addEventListener("click", () => {
    choose().catch((error) => { if (error.name !== "AbortError") setStatus("error", error.message); });
  });
  render();
  // The snapshot this PC wrote last (after a push): what the other device must wait for.
  const lastPushName = () => lastPush?.name ?? null;

  return { refresh, push, pull, skip, changed, start, stop, lastPushName };
}
