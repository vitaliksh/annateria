// The inbox dialog (#inbox-dialog): a drop target and a file picker that put the user's files into inbox/ (inbox-store.js).
// No AI is involved. This file chooses the folder, filters the file types, runs the add and says what happened.
import { ACCEPTED_EXTENSIONS, UNSORTED, addToInbox, ensureInbox, refusalReason } from "./inbox-store.js";

const PLATE_CLASS = { info: "plate-info", success: "plate-success", warning: "plate-warning", error: "plate-error" };
const DIRECTORY_REASON = "תיקייה: יש לגרור קבצים ולא תיקיות";
const plural = (count, one, many) => (count === 1 ? one : `${count} ${many}`);

// Files and folders of a drop event. Folders are named in `refused`; they cannot be read as files. Must run inside
// the event handler: the browser empties the DataTransfer afterwards.
export function filesFromDrop(dataTransfer) {
  const files = [], refused = [];
  const items = [...(dataTransfer?.items ?? [])].filter((item) => item.kind === "file");
  if (items.length) {
    for (const item of items) {
      const entry = item.webkitGetAsEntry?.();
      if (entry?.isDirectory) refused.push({ name: entry.name, reason: DIRECTORY_REASON });
      else { const file = item.getAsFile(); if (file) files.push(file); }
    }
  } else files.push(...(dataTransfer?.files ?? []));
  return { files, refused };
}

// getClients() returns this PC's active clients ({ entryName, clientName, parent, ... }); only those inside the data root
// ("parent" set) have an inbox folder. `add` and `ensure` are the store functions, replaceable in tests.
export function setupInbox({ dialog, openButton, getDataRoot, getClients, onError = () => {}, add = addToInbox, ensure = ensureInbox, now = () => new Date().toISOString() }) {
  const part = (id) => dialog.querySelector(`#${id}`);
  const [plate, zone, pick, input, select, problems, errorLine] = ["inbox-summary", "inbox-drop", "inbox-pick", "inbox-file", "inbox-client", "inbox-problems", "inbox-error"].map(part);
  const doc = dialog.ownerDocument;
  let running = false;
  let message = null;
  let shown = [];

  const homeClients = () => (getClients() ?? []).filter((client) => client.parent && client.entryName);
  const setMessage = (kind, text, lines = []) => { message = { kind, text }; shown = lines; render(); };

  function render() {
    const root = getDataRoot();
    const current = message ?? { kind: root ? "info" : "warning", text: root ? "גררו לכאן תמונות, PDF וקובצי Excel, או בחרו קבצים. הקבצים נשמרים בתיבת הקלט ואינם נשלחים לשום מקום." : "יש לבחור תחילה תיקיית נתונים." };
    plate.className = `plate ${PLATE_CLASS[current.kind]}`;
    plate.textContent = current.text;
    const disabled = !root || running;
    pick.disabled = select.disabled = disabled;
    zone.setAttribute("aria-disabled", String(disabled));
    zone.dataset.busy = String(running);
    problems.replaceChildren(...shown.map((text) => Object.assign(doc.createElement("li"), { textContent: text })));
    problems.hidden = !shown.length;
  }

  function fillClients() {
    const previous = select.value;
    const option = (value, text) => Object.assign(doc.createElement("option"), { value, textContent: text });
    select.replaceChildren(option("", "ללא שיוך (יסווגו אחר כך)"), ...homeClients().map((client) => option(client.entryName, client.clientName)));
    select.value = [...select.options].some((item) => item.value === previous) ? previous : "";
  }

  const where = (of) => of.folder ? `בתיבת הקלט (${of.folder === UNSORTED ? "ללא שיוך" : of.folder})` : `בהצהרה ${of.month} של «${of.client}»`;

  // `refused` are names the drop itself already turned down (folders).
  async function submit(files, refused = []) {
    const root = getDataRoot();
    if (!root || running || !(files.length + refused.length)) return;
    errorLine.textContent = "";
    const accepted = [], turnedAway = [...refused];
    for (const file of files) {
      const reason = refusalReason(file.name);
      if (reason) turnedAway.push({ name: file.name, reason }); else accepted.push(file);
    }
    running = true;
    setMessage("info", "קולט קבצים…");
    try {
      const folder = select.value || UNSORTED;
      if (folder !== UNSORTED && !homeClients().some((client) => client.entryName === folder)) throw new Error("הלקוח שנבחר אינו זמין.");
      const result = accepted.length ? await add(root, accepted, { folder, now: now() }) : { added: [], duplicates: [], failed: [] };
      const notTaken = turnedAway.length + result.failed.length;
      const parts = [result.added.length ? `${result.added.length === 1 ? "נוסף" : "נוספו"} ${plural(result.added.length, "קובץ אחד", "קבצים")}` : "לא נוספו קבצים"];
      if (result.duplicates.length) parts.push(`${plural(result.duplicates.length, "קובץ כפול", "כפולים")} דולג${result.duplicates.length === 1 ? "" : "ו"}`);
      if (notTaken) parts.push(`${plural(notTaken, "קובץ אחד לא נקלט", "קבצים לא נקלטו")}`);
      const lines = [
        ...turnedAway.map((item) => `${item.name}: ${item.reason}`),
        ...result.failed.map((item) => `${item.name}: ${item.error}`),
        ...result.duplicates.map((item) => `${item.name}: כבר קיים ${where(item.of)}`),
      ];
      setMessage(notTaken ? "warning" : result.added.length ? "success" : "info", parts.join(" · "), lines);
    } catch (error) {
      setMessage("error", error.message);
      errorLine.textContent = error.message;
      onError("תיבת הקלט: " + error.message);
    } finally {
      running = false;
      render();
    }
  }

  const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes("Files");
  const over = (on) => { zone.dataset.over = String(on); };
  // The whole dialog takes the drop: a file that misses the zone would otherwise be opened by the browser.
  for (const type of ["dragenter", "dragover"]) {
    dialog.addEventListener(type, (event) => { if (!hasFiles(event)) return; event.preventDefault(); over(true); });
  }
  dialog.addEventListener("dragleave", (event) => { if (!dialog.contains(event.relatedTarget)) over(false); });
  dialog.addEventListener("drop", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    over(false);
    const { files, refused } = filesFromDrop(event.dataTransfer);
    submit(files, refused);
  });

  const choose = () => { if (!pick.disabled) input.click(); };
  input.accept = ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`).join(",");
  pick.addEventListener("click", choose);
  zone.addEventListener("click", (event) => { if (event.target !== pick) choose(); });
  zone.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(); } });
  input.addEventListener("change", () => {
    const files = [...input.files];
    input.value = "";
    submit(files);
  });

  async function open() {
    errorLine.textContent = "";
    message = null;
    shown = [];
    const root = getDataRoot();
    try {
      if (root) await ensure(root, homeClients().map((client) => client.entryName));
    } catch (error) {
      onError("תיבת הקלט: " + error.message);
    }
    fillClients();
    render();
    dialog.showModal();
  }

  openButton.addEventListener("click", open);
  render();
  return { open, submit, getState: () => ({ running }) };
}
