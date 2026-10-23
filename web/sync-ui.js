// The shared folder of the two PCs (WORK_PLAN 7.3): its section in the backup dialog and the ☁ icon in the top bar. After a save
// the host calls changed(); one minute later, and every five minutes as a safety net for the other writes (agent, inbox, rules),
// a snapshot goes to the shared folder (sync-store.js), only when something changed. A failure only turns the icon red: the work
// goes on. The folder handle and the key live in IndexedDB (backup-handles.js), the time of the last push in
// common/sync-state.json.
import { pushSnapshot, readSyncState } from "./sync-store.js";
import { BACKUP_KEY_NAME, SYNC_FOLDER_KEY, readSetting, writeSetting } from "./backup-handles.js";

export const PUSH_AFTER_SAVE_MS = 60 * 1000;
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
      if (!result.unchanged) lastPush = { name: result.name, at, files: result.files, ms: result.ms };
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

  icon.addEventListener("click", () => { push({ interactive: true }).catch(() => {}); });
  runButton.addEventListener("click", () => { push({ interactive: true }).catch(() => {}); });
  chooseButton.addEventListener("click", () => {
    choose().catch((error) => { if (error.name !== "AbortError") setStatus("error", error.message); });
  });
  render();
  return { refresh, push, changed, start, stop };
}
