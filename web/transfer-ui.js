// The transfer dialog (#transfer-dialog): save a client (all months) or one month into one .annateria file, or import such a file
// into this PC. transfer-store.js does the work; this file chooses, asks and shows what happened.
import { BACKUP_KEY_NAME, readSetting, writeSetting } from "./backup-handles.js";
import { confirmDialog } from "./confirm-dialog.js";
import { formatMonth } from "./month-format.js";
import { TRANSFER_EXTENSION, collectClient, createClient, decodeTransfer, describeTransfer, encodeTransfer, imagesSize, importTransfer } from "./transfer-store.js";

const PLATE_CLASS = { info: "plate-info", success: "plate-success", warning: "plate-warning", error: "plate-error" };
const NEW_CLIENT = "__new__";
const MAIL_LIMIT = 20 * 1024 * 1024;
const FILE_TYPES = [{ description: "ANNATERIA", accept: { "application/octet-stream": [TRANSFER_EXTENSION] } }];
const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const megabytes = (bytes) => (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0);

const ACTION_TEXT = {
  created: (r) => `${formatMonth(r.month)}: נוצרה, ${r.added} שורות`,
  appended: (r) => `${formatMonth(r.month)}: נוספו ${r.added} שורות${r.duplicates ? ` (${r.duplicates} כבר היו)` : ""}`,
  "copied-locked": (r) => `${formatMonth(r.month)}: הועתקה כנעולה, ${r.added} שורות`,
  "skipped-locked": (r) => `${formatMonth(r.month)}: דולגה, ההצהרה כאן נעולה`,
  "skipped-invalid": (r) => `${formatMonth(r.month)}: דולגה, נתוני ההצהרה בקובץ אינם תקינים`,
};

// getClients() returns this PC's active clients ({ id, clientName, directory, config, declarations }); getCurrent() the declaration
// open in the journal ({ client, ... }) or null; saveCurrent() writes the open table; beforeImport / afterImport let the host
// detach the open table and show the result.
export function setupTransfer({
  dialog,
  openButton,
  getDataRoot,
  getClients,
  getCurrent = () => null,
  saveCurrent = async () => {},
  beforeImport = async () => {},
  afterImport = async () => {},
  store = { readSetting, writeSetting },
  pickSaveFile = (options) => window.showSaveFilePicker(options),
  pickOpenFile = (options) => window.showOpenFilePicker(options),
  now = () => new Date().toISOString(),
  confirm = confirmDialog,
}) {
  const part = (id) => dialog.querySelector(`#${id}`);
  const [plate, errorLine, exportClient, exportMonth, images, sizeLine, exportButton, openFile, details, infoLine, importClient, targetLine, importButton] = [
    "transfer-summary", "transfer-error", "transfer-export-client", "transfer-export-month", "transfer-images", "transfer-size", "transfer-export",
    "transfer-open", "transfer-details", "transfer-info", "transfer-client", "transfer-target", "transfer-import",
  ].map(part);
  const doc = dialog.ownerDocument;
  let key = null;
  let decoded = null;
  let running = false;
  let message = null;
  let sizeToken = 0;

  const option = (value, text) => Object.assign(doc.createElement("option"), { value, textContent: text });
  const clients = () => getClients() ?? [];
  const exportTarget = () => clients().find((client) => client.id === exportClient.value) ?? null;
  const setMessage = (kind, text) => { message = { kind, text }; render(); };

  function render() {
    const root = getDataRoot();
    const shown = message ?? { kind: "info", text: root ? "הקובץ מוצפן בקוד השחזור, ואפשר להעביר אותו בכונן נייד, בדוא״ל או בכל תיקייה." : "יש לבחור תחילה תיקיית נתונים." };
    plate.className = `plate ${PLATE_CLASS[shown.kind]}`;
    plate.textContent = shown.text;
    exportClient.disabled = exportMonth.disabled = images.disabled = running;
    exportButton.disabled = !root || !key || !exportTarget() || running;
    openFile.disabled = !root || !key || running;
    importButton.disabled = !decoded || !importClient.value || running;
  }

  function fillExportClients(preset = null) {
    exportClient.replaceChildren(option("", "בחר לקוח"), ...clients().map((client) => option(client.id, client.clientName)));
    exportClient.value = preset?.clientId ?? exportClient.value;
    fillExportMonths(preset);
  }

  function fillExportMonths(preset = null) {
    const client = exportTarget();
    const months = (client?.declarations ?? []).map((item) => item.declaration.month).sort().reverse();
    exportMonth.replaceChildren(option("", `כל החודשים (${months.length})`), ...months.map((month) => option(month, formatMonth(month))));
    exportMonth.value = preset?.month && months.includes(preset.month) ? preset.month : "";
    images.checked = Boolean(exportMonth.value);
    refreshSize();
  }

  async function refreshSize() {
    const token = (sizeToken += 1);
    const client = exportTarget();
    sizeLine.textContent = "";
    delete sizeLine.dataset.state;
    if (!client) return render();
    const bytes = await imagesSize(client.directory, exportMonth.value ? [exportMonth.value] : null).catch(() => null);
    if (token !== sizeToken || bytes === null) return render();
    if (!images.checked) sizeLine.textContent = `התמונות (${megabytes(bytes)} MB) לא ייכללו.`;
    else {
      sizeLine.textContent = `גודל התמונות: ${megabytes(bytes)} MB${bytes > MAIL_LIMIT ? " — גדול לשליחה בדוא״ל (עד כ-25 MB)." : "."}`;
      if (bytes > MAIL_LIMIT) sizeLine.dataset.state = "large";
    }
    render();
  }

  function importInfo() {
    const summary = describeTransfer(decoded);
    const head = `לקוח «${summary.clientName}» · ${summary.months.length} חודשים · ${summary.rows} שורות · ${summary.images} תמונות`;
    infoLine.textContent = [head, ...summary.months.map((m) => `${formatMonth(m.month)} · ${m.status === "open" ? "פתוחה" : "נעולה"} · ${m.rows} שורות`)].join("\n");
  }

  // The client with the same name is preselected; without one the default is to create it.
  function fillImportClients() {
    const name = decoded.meta.client.clientName;
    importClient.replaceChildren(option(NEW_CLIENT, `יצירת לקוח חדש «${name}»`), ...clients().map((client) => option(client.id, client.clientName)));
    const match = clients().find((client) => sameName(client.clientName, name));
    importClient.value = match ? match.id : NEW_CLIENT;
    renderTarget();
  }

  function renderTarget() {
    targetLine.textContent = importClient.value === NEW_CLIENT
      ? "הלקוח ייווצר כאן עם כל החודשים שבקובץ."
      : "חודשים חדשים ייווצרו, בחודשים פתוחים יתווספו רק שורות שעוד אין, חודשים נעולים קיימים לא ישתנו.";
    render();
  }

  async function refresh() {
    key = (await store.readSetting(BACKUP_KEY_NAME).catch(() => null)) ?? null;
    render();
  }

  const guarded = (action) => async () => {
    errorLine.textContent = "";
    try {
      await action();
    } catch (error) {
      if (error.name === "AbortError") return;
      errorLine.textContent = error.message;
      setMessage("error", error.message);
    }
  };

  function requireKey() {
    if (!key) throw new Error("יש ליצור או להזין קוד שחזור בחלון הגיבוי.");
  }

  exportClient.addEventListener("change", () => fillExportMonths());
  exportMonth.addEventListener("change", () => { images.checked = Boolean(exportMonth.value); refreshSize(); });
  images.addEventListener("change", refreshSize);

  exportButton.addEventListener("click", guarded(async () => {
    requireKey();
    const client = exportTarget();
    if (!client) throw new Error("יש לבחור לקוח.");
    const month = exportMonth.value;
    const scope = month ? formatMonth(month).replace("/", "-") : "all";
    // The picker needs the click's user activation, so it comes before the (possibly long) work.
    const handle = await pickSaveFile({ suggestedName: `${client.clientName.replace(/[\\/:*?"<>|]/g, "-")}_${scope}${TRANSFER_EXTENSION}`, types: FILE_TYPES });
    running = true;
    render();
    try {
      const current = getCurrent();
      if (current && current.client?.clientId === client.config?.clientId) await saveCurrent();
      const collected = await collectClient({ clientDirectory: client.directory, config: client.config, months: month ? [month] : null, includeImages: images.checked, now: now() });
      const bytes = await encodeTransfer(key, collected);
      const writable = await handle.createWritable();
      try {
        await writable.write(bytes);
      } finally {
        await writable.close();
      }
      const rows = collected.months.reduce((sum, item) => sum + item.rows.length, 0);
      const pictures = collected.months.reduce((sum, item) => sum + item.images.length, 0);
      message = {
        kind: collected.missingImages ? "warning" : "success",
        text: `נשמר הקובץ «${handle.name}» (${megabytes(bytes.length)} MB): ${collected.months.length} חודשים, ${rows} שורות, ${pictures} תמונות.${collected.missingImages ? ` ${collected.missingImages} תמונות לא נמצאו ולא נכללו.` : ""}`,
      };
    } finally {
      running = false;
      render();
    }
  }));

  openFile.addEventListener("click", guarded(async () => {
    requireKey();
    const [handle] = await pickOpenFile({ multiple: false, types: FILE_TYPES });
    const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    decoded = await decodeTransfer(key, bytes);
    details.hidden = false;
    importInfo();
    fillImportClients();
    setMessage("info", "הקובץ נקרא. בחר לקוח ולחץ על ייבוא.");
  }));

  importClient.addEventListener("change", renderTarget);

  importButton.addEventListener("click", guarded(async () => {
    if (!decoded) throw new Error("יש לבחור קובץ.");
    const root = getDataRoot();
    const meta = decoded.meta;
    let target = clients().find((client) => client.id === importClient.value) ?? null;
    if (importClient.value === NEW_CLIENT) {
      const question = `ללקוח «${meta.client.clientName}» אין התאמה כאן. ליצור לקוח חדש?`;
      if (!(await confirm(question, { title: "לקוח חדש", confirmLabel: "יצירה" }))) return;
    } else if (!target) throw new Error("יש לבחור לקוח.");
    running = true;
    render();
    try {
      let created = false;
      if (!target) {
        const made = await createClient(root, meta.client);
        target = { id: made.config.clientId, clientName: made.config.clientName, directory: made.directory, config: made.config };
        created = true;
      }
      await beforeImport({ clientId: target.id, months: meta.months.map((item) => item.month) });
      const results = await importTransfer({ clientDirectory: target.directory, clientId: target.config?.clientId ?? target.id, decoded, now: now() });
      const added = results.reduce((sum, item) => sum + (item.added ?? 0), 0);
      const lines = [`יובאו ${added} שורות ל«${target.clientName}»${created ? " (לקוח חדש)" : ""}.`, ...results.map((item) => ACTION_TEXT[item.action](item))];
      message = { kind: results.some((item) => item.action.startsWith("skipped")) ? "warning" : "success", text: lines.join("\n") };
      await afterImport({ clientId: target.id, months: meta.months.map((item) => item.month), kind: meta.kind });
    } finally {
      running = false;
      render();
    }
  }));

  // `preset` ({ clientId, month }) preselects what to export (the menus of a client and of a month call this).
  async function open(preset = null) {
    errorLine.textContent = "";
    message = null;
    decoded = null;
    details.hidden = true;
    await refresh();
    fillExportClients(preset);
    dialog.showModal();
  }

  openButton.addEventListener("click", () => open());
  render();
  return { openExport: (preset) => open(preset), refresh, getState: () => ({ key: Boolean(key), decoded: Boolean(decoded), running }) };
}
