// The backup dialog (#backup-dialog) and the status dot on its sidebar item. The copying itself is backup-store.js; this file
// only chooses folders, keeps the recovery key, starts runs and shows results. Everything the browser needs per PC (folder
// handles, the non-extractable key) lives in IndexedDB through backup-handles.js; the state file in the data root only remembers
// when each slot last succeeded.
import { createBackup, keyFromRecoveryCode, listSnapshots, newRecoveryCode, restoreSnapshot, verifyStore } from "./backup-store.js";
import { SLOTS, backupLevel, readBackupState, saveBackupState } from "./backup-state.js";
import { BACKUP_FOLDER_KEYS, BACKUP_KEY_NAME, readSetting, writeSetting } from "./backup-handles.js";
import { confirmDialog } from "./confirm-dialog.js";

const PLATE_CLASS = { ok: "plate-success", warning: "plate-warning", error: "plate-error", info: "plate-info", success: "plate-success" };
const LEVEL_TEXT = {
  ok: "הגיבוי מעודכן.",
  warning: "הגיבוי טרם הוגדר או לא הושלם בכל היעדים.",
  error: "הגיבוי לא עודכן זמן רב. יש לגבות עכשיו.",
};
const SLOT_STATE_TEXT = { never: "טרם בוצע גיבוי.", ok: "", stale: " — ישן מדי" };
const DAY_MS = 24 * 60 * 60 * 1000;
const AUTO_AFTER_MS = DAY_MS;

const formatTime = (iso) => new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });

export const slotText = (entry, status) =>
  !entry ? SLOT_STATE_TEXT.never : `גיבוי אחרון: ${formatTime(entry.at)} · ${entry.files} קבצים${entry.folder ? ` · «${entry.folder}»` : ""}${SLOT_STATE_TEXT[status]}`;

// getDataRoot() returns the data root handle or null; pickDirectory() asks the user for a folder (a test double in tests).
export function setupBackup({
  dialog,
  openButton,
  getDataRoot,
  onError = () => {},
  store = { readSetting, writeSetting },
  pickDirectory = () => window.showDirectoryPicker({ mode: "readwrite", startIn: "documents" }),
  now = () => new Date().toISOString(),
  confirm = confirmDialog,
}) {
  const part = (id) => dialog.querySelector(`#${id}`);
  const slotPart = (slot, role) => dialog.querySelector(`[data-slot="${slot}"] [data-role="${role}"]`);
  const [plate, errorLine, images, keyState, createKey, codeBox, codeOutput, codeSaved, codeConfirm, restoreChoose, restoreDetails, restoreSnapshotSelect, restoreCode, restoreRun] = [
    "backup-summary", "backup-error", "backup-images", "backup-key-state", "backup-create-key", "backup-code-box", "backup-code",
    "backup-code-saved", "backup-code-confirm", "backup-restore-choose", "backup-restore-details", "backup-restore-snapshot",
    "backup-restore-code", "backup-restore-run",
  ].map(part);
  const [enterBox, enterLabel, enterCode, useCode] = ["backup-enter-box", "backup-enter-label", "backup-enter-code", "backup-use-code"].map(part);
  const handles = { cloud: null, usb: null };
  let state = null;
  let key = null;
  let running = false;
  let message = null;
  let pendingCode = null;
  let restoreSource = null;

  const setMessage = (kind, text) => { message = text ? { kind, text } : null; render(); };
  const fail = (error) => {
    errorLine.textContent = error.message;
    setMessage("error", error.message);
  };

  function render() {
    const root = getDataRoot();
    const { level, slots } = backupLevel(state, now());
    openButton.dataset.level = root ? level : "warning";
    openButton.title = root ? LEVEL_TEXT[level] : "יש לבחור תיקיית נתונים לפני הגיבוי.";
    const shown = message ?? { kind: root ? level : "warning", text: root ? LEVEL_TEXT[level] : "יש לבחור תיקיית נתונים לפני הגיבוי." };
    plate.className = `plate ${PLATE_CLASS[shown.kind]}`;
    plate.textContent = shown.text;
    for (const slot of SLOTS) {
      const stateLine = slotPart(slot, "state");
      stateLine.textContent = slotText(state?.[slot], slots[slot].state);
      stateLine.dataset.state = slots[slot].state;
      slotPart(slot, "folder").textContent = handles[slot] ? `תיקייה: ${handles[slot].name}` : "לא נבחרה תיקייה.";
      dialog.querySelector(`[data-slot="${slot}"] [data-action="choose"]`).disabled = !root || running;
      dialog.querySelector(`[data-slot="${slot}"] [data-action="run"]`).disabled = !root || !handles[slot] || running;
      dialog.querySelector(`[data-slot="${slot}"] [data-action="verify"]`).disabled = !key || !handles[slot] || running;
    }
    images.checked = state?.includeImages === true;
    images.disabled = !root;
    keyState.textContent = key ? "קוד שחזור נשמר במחשב זה." : "טרם נוצר קוד שחזור. הוא נדרש לפני הגיבוי הראשון.";
    createKey.hidden = Boolean(key) || Boolean(pendingCode);
    enterBox.hidden = Boolean(pendingCode);
    enterLabel.textContent = key ? "להחלפת הקוד השמור במחשב זה, הזן קוד אחר:" : "כבר יש לך קוד שחזור (למשל מהמחשב השני)?";
    useCode.textContent = key ? "החלפת הקוד" : "שימוש בקוד";
    codeBox.hidden = !pendingCode;
    codeOutput.textContent = pendingCode ?? "";
    codeConfirm.disabled = !codeSaved.checked;
    restoreDetails.hidden = !restoreSource;
    restoreRun.disabled = running;
  }

  async function refresh() {
    const root = getDataRoot();
    state = root ? await readBackupState(root).catch(() => null) : null;
    for (const slot of SLOTS) handles[slot] = (await store.readSetting(BACKUP_FOLDER_KEYS[slot]).catch(() => null)) ?? null;
    key = (await store.readSetting(BACKUP_KEY_NAME).catch(() => null)) ?? null;
    render();
  }

  // A destination inside the data root would be copied into itself and die with it.
  async function checkOutsideRoot(root, folder) {
    if (typeof root?.resolve === "function" && (await root.resolve(folder))) throw new Error("לא ניתן לשמור גיבוי בתוך תיקיית הנתונים.");
  }

  async function destinationFor(slot, interactive) {
    const folder = handles[slot];
    if (!folder) throw new Error("יש לבחור תיקיית יעד.");
    let permission = await folder.queryPermission({ mode: "readwrite" });
    if (permission !== "granted" && interactive) permission = await folder.requestPermission({ mode: "readwrite" });
    if (permission === "granted") return folder;
    if (interactive) throw new Error("לא ניתנה הרשאה לתיקייה.");
    return null;
  }

  async function runBackup(slot, { interactive }) {
    if (running) return false;
    const root = getDataRoot();
    if (!root) throw new Error("יש לבחור תחילה תיקיית נתונים.");
    if (!key) throw new Error(pendingCode ? "הקוד עדיין לא נשמר: סמן שרשמת אותו ולחץ על «שמירת הקוד במחשב»." : "יש ליצור קוד שחזור לפני הגיבוי הראשון.");
    const destination = await destinationFor(slot, interactive);
    if (!destination) return false;
    await checkOutsideRoot(root, destination);
    running = true;
    errorLine.textContent = "";
    render();
    try {
      const at = now();
      const result = await createBackup({
        source: root,
        destination,
        key,
        images: state?.includeImages === true,
        now: at,
        onProgress: ({ phase, done, total }) => { if (phase === "scan") plate.textContent = `מעתיק… ${done}/${total}`; },
      });
      state = await saveBackupState(root, { [slot]: { folder: destination.name, at, files: result.files, skipped: result.skipped.length } });
      message = result.skipped.length
        ? { kind: "warning", text: `הגיבוי הושלם: ${result.files} קבצים, ${result.skipped.length} לא נקראו ולא נשמרו.` }
        : { kind: "success", text: `הגיבוי הושלם: ${result.files} קבצים.` };
    } finally {
      running = false;
      render();
    }
    return true;
  }

  // Started by the host at start-up and after a declaration is locked. Never asks for permission (a user gesture is needed for that)
  // and stays silent unless something is really wrong.
  async function runAuto(reason) {
    try {
      await refresh();
      const root = getDataRoot();
      if (!root || !key || !handles.cloud || running) return;
      if (typeof root.queryPermission === "function" && (await root.queryPermission({ mode: "readwrite" })) !== "granted") return;
      const last = state?.cloud ? Date.parse(state.cloud.at) : 0;
      if (reason === "start" && Date.parse(now()) - last < AUTO_AFTER_MS) return;
      await runBackup("cloud", { interactive: false });
    } catch (error) {
      onError(`הגיבוי האוטומטי נכשל: ${error.message}`);
    }
  }

  const guarded = (action) => async (...args) => {
    errorLine.textContent = "";
    try {
      await action(...args);
    } catch (error) {
      if (error.name !== "AbortError") fail(error);
    }
  };

  for (const slot of SLOTS) {
    const button = (action) => dialog.querySelector(`[data-slot="${slot}"] [data-action="${action}"]`);
    button("choose").addEventListener("click", guarded(async () => {
      const root = getDataRoot();
      const folder = await pickDirectory();
      await checkOutsideRoot(root, folder);
      await store.writeSetting(BACKUP_FOLDER_KEYS[slot], folder);
      handles[slot] = folder;
      setMessage("info", "התיקייה נבחרה. אפשר לגבות עכשיו.");
    }));
    button("run").addEventListener("click", guarded(() => runBackup(slot, { interactive: true })));
    button("verify").addEventListener("click", guarded(async () => {
      const destination = await destinationFor(slot, true);
      setMessage("info", "בודק את הגיבוי…");
      const report = await verifyStore({ destination, key, deep: true });
      setMessage(
        report.ok ? "success" : "error",
        report.ok
          ? `הגיבוי תקין: ${report.snapshots} עותקים נבדקו.`
          : `נמצאו בעיות בגיבוי: חסרים ${report.missing.length}, פגומים ${report.corrupt.length}, לא נקראו ${report.unreadable.length}.`,
      );
    }));
  }

  images.addEventListener("change", guarded(async () => {
    const root = getDataRoot();
    if (root) state = await saveBackupState(root, { includeImages: images.checked });
    render();
  }));

  createKey.addEventListener("click", () => {
    pendingCode = newRecoveryCode();
    codeSaved.checked = false;
    render();
  });
  codeSaved.addEventListener("change", render);
  codeConfirm.addEventListener("click", guarded(async () => {
    const created = await keyFromRecoveryCode(pendingCode);
    await store.writeSetting(BACKUP_KEY_NAME, created);
    key = created;
    pendingCode = null;
    setMessage("success", "קוד השחזור נשמר במחשב זה. ודא שההעתק הכתוב שמור במקום בטוח.");
  }));

  useCode.addEventListener("click", guarded(async () => {
    const created = await keyFromRecoveryCode(enterCode.value);
    if (key) {
      const warning = "להחליף את קוד השחזור השמור במחשב זה? גיבויים וקבצי העברה שנוצרו בקוד הקודם לא ייפתחו בלעדיו.";
      if (!(await confirm(warning, { title: "החלפת קוד שחזור", confirmLabel: "החלפה" }))) return;
    }
    const replaced = Boolean(key);
    await store.writeSetting(BACKUP_KEY_NAME, created);
    key = created;
    enterCode.value = "";
    setMessage("success", replaced ? "קוד השחזור הוחלף." : "קוד השחזור נשמר במחשב זה.");
  }));

  restoreChoose.addEventListener("click", guarded(async () => {
    const source = await pickDirectory();
    const found = await listSnapshots(source);
    if (!found.length) throw new Error("לא נמצא גיבוי בתיקייה שנבחרה. יש לבחור את התיקייה שמכילה את annateria-backup, או את annateria-backup עצמה.");
    restoreSource = source;
    restoreSnapshotSelect.replaceChildren(
      ...found.reverse().map(({ name, at }) => Object.assign(dialog.ownerDocument.createElement("option"), { value: name, textContent: formatTime(at) })),
    );
    render();
  }));
  restoreRun.addEventListener("click", guarded(async () => {
    const typed = restoreCode.value.trim();
    const useKey = typed ? await keyFromRecoveryCode(typed) : key;
    if (!useKey) throw new Error("יש להזין קוד שחזור.");
    const target = await pickDirectory();
    running = true;
    render();
    try {
      const result = await restoreSnapshot({
        destination: restoreSource,
        key: useKey,
        name: restoreSnapshotSelect.value,
        target,
        onProgress: ({ done, total }) => { plate.textContent = `משחזר… ${done}/${total}`; },
      });
      message = { kind: "success", text: `שוחזרו ${result.files} קבצים אל «${target.name}». כדי להשתמש בהם: הגדרות ← החלפת תיקיית נתונים.` };
    } finally {
      running = false;
      render();
    }
  }));

  openButton.addEventListener("click", async () => {
    errorLine.textContent = "";
    message = null;
    pendingCode = null;
    restoreSource = null;
    restoreCode.value = "";
    await refresh();
    dialog.showModal();
  });

  render();
  return { refresh, runAuto, getState: () => ({ state, key: Boolean(key), handles: { ...handles }, running }) };
}
