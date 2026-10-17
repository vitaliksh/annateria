// The inbox dialog (#inbox-dialog): a drop target and a file picker that put the user's files into inbox/ (inbox-store.js),
// the list of what is waiting there (thumbnails, remove one file, clear all) and the counts shown in the sidebar.
// No AI is involved. This file chooses the folder, filters the file types, runs the actions and says what happened.
import { confirmDialog } from "./confirm-dialog.js";
import {
  ACCEPTED_EXTENSIONS, UNSORTED, addToInbox, ensureInbox, inboxCounts, moveToTrash, readInboxFile, readInboxIndex, reconcileInbox, refusalReason,
} from "./inbox-store.js";

const PLATE_CLASS = { info: "plate-info", success: "plate-success", warning: "plate-warning", error: "plate-error" };
const DIRECTORY_REASON = "תיקייה: יש לגרור קבצים ולא תיקיות";
const THUMBNAIL_SIZE = 96;
const THUMBNAIL_TYPES = /^image\/(jpeg|png|webp)$/;
const plural = (count, one, many) => (count === 1 ? one : `${count} ${many}`);
const sizeText = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

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

// A small canvas of a photo, or null when the browser cannot show it (HEIC without the Windows codec, PDF, Excel).
async function canvasThumbnail(file, entry, doc) {
  if (!THUMBNAIL_TYPES.test(entry.type) || typeof createImageBitmap !== "function") return null;
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, THUMBNAIL_SIZE / Math.max(bitmap.width, bitmap.height));
    const canvas = doc.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close?.();
  }
}

// getClients() returns this PC's active clients ({ entryName, clientName, parent, ... }); only those inside the data root
// ("parent" set) have an inbox folder. The store functions and `makeThumbnail(file, entry)` are replaceable in tests.
// getOpenFolder() is the inbox folder of the client that is open in the journal (or null): the dialog offers it for new files.
// onCounts({ total, byFolder }) is called whenever the index was read, for the sidebar. onCheck() is called by the button that
// hands the files to the assistant.
export function setupInbox({
  dialog, openButton, getDataRoot, getClients, getOpenFolder = () => null, onError = () => {}, onCounts = () => {}, onCheck = () => {},
  add = addToInbox, ensure = ensureInbox, readIndex = readInboxIndex, reconcile = reconcileInbox, trash = moveToTrash, readFile = readInboxFile,
  makeThumbnail = null, confirm = confirmDialog, now = () => new Date().toISOString(),
}) {
  const part = (id) => dialog.querySelector(`#${id}`);
  const [plate, zone, pick, input, select, problems, errorLine, list, countLine, clearButton, checkButton] = [
    "inbox-summary", "inbox-drop", "inbox-pick", "inbox-file", "inbox-client", "inbox-problems", "inbox-error", "inbox-list", "inbox-count", "inbox-clear",
    "inbox-check",
  ].map(part);
  const navBadge = openButton.querySelector("[data-inbox-total]");
  const doc = dialog.ownerDocument;
  // The phone guide (step 2.4) is a plain help dialog; the button only opens it.
  part("inbox-guide").addEventListener("click", () => doc.querySelector("#phone-guide-dialog")?.showModal());
  const thumbnail = makeThumbnail ?? ((file, entry) => canvasThumbnail(file, entry, doc));
  let running = false;
  let message = null;
  let shown = [];
  let index = { files: [] };
  let listToken = 0;

  const homeClients = () => (getClients() ?? []).filter((client) => client.parent && client.entryName);
  const setMessage = (kind, text, lines = []) => { message = { kind, text }; shown = lines; render(); };

  function render() {
    const root = getDataRoot();
    const current = message ?? { kind: root ? "info" : "warning", text: root ? "גררו לכאן תמונות, PDF וקובצי Excel, או בחרו קבצים. הקבצים נשמרים בתיבת הקלט ואינם נשלחים לשום מקום." : "יש לבחור תחילה תיקיית נתונים." };
    plate.className = `plate ${PLATE_CLASS[current.kind]}`;
    plate.textContent = current.text;
    const disabled = !root || running;
    pick.disabled = select.disabled = disabled;
    clearButton.disabled = disabled || !index.files.length;
    checkButton.disabled = disabled || !index.files.length;
    for (const button of list.querySelectorAll("button")) button.disabled = disabled;
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

  const folderLabel = (folder) => (folder === UNSORTED ? "ללא שיוך" : homeClients().find((client) => client.entryName === folder)?.clientName ?? folder);
  const where = (of) => of.folder ? `בתיבת הקלט (${folderLabel(of.folder)})` : of.imports ? `בקבצים שיובאו של «${of.client}»` : `בהצהרה ${of.month} של «${of.client}»`;

  // Unassigned first, then the clients in the order of the sidebar, then folders that no client owns any more.
  function groups() {
    const order = [UNSORTED, ...homeClients().map((client) => client.entryName)];
    const folders = [...new Set(index.files.map((entry) => entry.folder))].sort((a, b) => {
      const rank = (folder) => (order.includes(folder) ? order.indexOf(folder) : order.length);
      return rank(a) - rank(b) || a.localeCompare(b, "he");
    });
    return folders.map((folder) => ({ folder, entries: index.files.filter((entry) => entry.folder === folder) }));
  }

  function itemOf(entry) {
    const item = doc.createElement("div"), box = doc.createElement("span"), text = doc.createElement("span"), name = doc.createElement("strong");
    const meta = doc.createElement("span"), remove = doc.createElement("button");
    item.className = "inbox-item";
    item.dataset.hash = entry.hash;
    box.className = "inbox-thumb";
    box.textContent = (entry.storedName.split(".").pop() || "").slice(0, 5).toUpperCase();
    text.className = "inbox-item-text";
    name.textContent = entry.name;
    name.title = entry.name;
    meta.className = "muted";
    meta.textContent = [sizeText(entry.size), entry.sourceDate ?? entry.addedAt.slice(0, 10)].join(" · ");
    text.append(name, meta);
    remove.type = "button";
    remove.className = "secondary small inbox-remove";
    remove.textContent = "הסר";
    remove.setAttribute("aria-label", `הסר את ${entry.name} מהתיבה`);
    remove.addEventListener("click", () => moveFiles([entry.hash], `הועבר לפח: ${entry.name}`));
    item.append(box, text, remove);
    return item;
  }

  async function fillThumbnails(token) {
    const root = getDataRoot();
    for (const entry of index.files) {
      if (token !== listToken || !root) return;
      if (!THUMBNAIL_TYPES.test(entry.type)) continue;
      const box = [...list.querySelectorAll(".inbox-item")].find((item) => item.dataset.hash === entry.hash)?.querySelector(".inbox-thumb");
      if (!box) continue;
      try {
        const shownThumb = await thumbnail(await readFile(root, entry), entry);
        if (shownThumb && token === listToken) box.replaceChildren(shownThumb);
      } catch { /* the label with the extension stays */ }
    }
  }

  function renderList() {
    listToken += 1;
    const total = index.files.length;
    countLine.textContent = total ? `בתיבה: ${plural(total, "קובץ אחד", "קבצים")}` : "התיבה ריקה";
    list.replaceChildren(...groups().flatMap(({ folder, entries }) => {
      const head = doc.createElement("h4");
      head.textContent = `${folderLabel(folder)} (${entries.length})`;
      return [head, ...entries.map(itemOf)];
    }));
    render();
    fillThumbnails(listToken);
  }

  // Reads the index again, tells the sidebar and redraws the list. Returns false when the index could not be read.
  async function refreshCounts() {
    const root = getDataRoot();
    try {
      if (root) await reconcile(root);
      index = root ? await readIndex(root) : { files: [] };
    } catch (error) {
      index = { files: [] };
      onError("תיבת הקלט: " + error.message);
      renderList();
      return false;
    }
    const counts = inboxCounts(index);
    if (navBadge) { navBadge.textContent = String(counts.total); navBadge.hidden = !counts.total; }
    onCounts(counts);
    renderList();
    return true;
  }

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
      await refreshCounts();
    }
  }

  // Moves files to inbox/_trash/ (nothing is deleted for good) and says what happened.
  async function moveFiles(hashes, doneText) {
    const root = getDataRoot();
    if (!root || running || !hashes.length) return;
    errorLine.textContent = "";
    running = true;
    render();
    try {
      const result = await trash(root, hashes, { now: now() });
      const problemLines = [
        ...result.failed.map((item) => `${item.name}: ${item.error}`),
        ...result.missing.map((entry) => `${entry.name}: הקובץ כבר לא היה בתיקייה והוסר מהרשימה`),
      ];
      const text = !result.moved.length ? "לא הועברו קבצים" : hashes.length === 1 ? doneText : `הועברו לפח: ${result.moved.length}`;
      setMessage(result.failed.length ? "warning" : "success", text, problemLines);
    } catch (error) {
      setMessage("error", error.message);
      errorLine.textContent = error.message;
      onError("תיבת הקלט: " + error.message);
    } finally {
      running = false;
      await refreshCounts();
    }
  }

  // The check by the assistant is the next step after adding files: the dialog closes and the dock takes over.
  checkButton.addEventListener("click", () => {
    if (checkButton.disabled) return;
    dialog.close();
    onCheck();
  });

  clearButton.addEventListener("click", async () => {
    const hashes = index.files.map((entry) => entry.hash);
    if (!hashes.length || running) return;
    const question = `להעביר ${plural(hashes.length, "קובץ אחד", "קבצים")} מהתיבה לפח? הקבצים יישמרו בתיקייה inbox/_trash ולא יימחקו.`;
    if (await confirm(question, { title: "ניקוי תיבת הקלט", confirmLabel: "העברה לפח" })) await moveFiles(hashes, "");
  });

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
    const openFolder = getOpenFolder();
    if (openFolder && [...select.options].some((item) => item.value === openFolder)) select.value = openFolder;
    await refreshCounts();
    dialog.showModal();
  }

  openButton.addEventListener("click", open);
  render();
  return { open, submit, refreshCounts, getState: () => ({ running }) };
}
