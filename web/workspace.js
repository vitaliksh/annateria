import { normalizeClientTaxProfile, normalizeWorkspaceConfig, taxIdProblem } from "./workspace-core.js";
import { DEFAULT_REPORT_SETTINGS, readReportSettings, saveReportSettings } from "./report-data.js";
import { archiveDeclaration, createDeclaration, deleteDeclaration, listDeclarations, loadDeclaration } from "./declaration-store.js";
import { declarationMonth } from "./declaration-core.js";
import { confirmDialog, dialogResult } from "./confirm-dialog.js";
import { MONTH_FORMAT_ERROR, formatMonth, parseMonthText } from "./month-format.js";
import { renderSidebarClients } from "./sidebar-clients.js";
import { DATABASE_NAME } from "./backup-handles.js";

const configName = "workspace.json", databaseName = DATABASE_NAME;
function openDatabase() { return new Promise((resolve, reject) => { const request = indexedDB.open(databaseName, 1); request.onupgradeneeded = () => request.result.createObjectStore("settings"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function setting(key, value) { const database = await openDatabase(); return new Promise((resolve, reject) => { const transaction = database.transaction("settings", value === undefined ? "readonly" : "readwrite"), request = value === undefined ? transaction.objectStore("settings").get(key) : transaction.objectStore("settings").put(value, key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }).finally(() => database.close()); }
// Clients saved before the periods became client properties kept the VAT period in report-settings.json; until they are saved again it is read from there.
async function withReportPeriods(config, directory) { if (config.vatPeriod && config.advancesPeriod) return config; const { vatPeriod } = await readReportSettings(directory).catch(() => DEFAULT_REPORT_SETTINGS); return { ...config, vatPeriod: config.vatPeriod ?? vatPeriod, advancesPeriod: config.advancesPeriod ?? config.vatPeriod ?? vatPeriod }; }
async function readConfig(directory) { const handle = await directory.getFileHandle(configName), result = normalizeWorkspaceConfig(JSON.parse(await (await handle.getFile()).text())); if (!result.valid) throw new Error(result.error); return withReportPeriods(result.config, directory); }
async function writeConfig(directory, config) { const handle = await directory.getFileHandle(configName, { create: true }), writable = await handle.createWritable(); try { await writable.write(JSON.stringify(config, null, 2)); } finally { await writable.close(); } }
async function ensureAccess(directory) { let permission = await directory.queryPermission({ mode: "readwrite" }); if (permission !== "granted") permission = await directory.requestPermission({ mode: "readwrite" }); if (permission !== "granted") throw new Error("לא ניתנה הרשאה לתיקייה המקומית."); }
function directoryName(clientName) { return clientName.replace(/[\\/:*?"<>|]/g, "-").replace(/[. ]+$/, "").replace(/\s+/g, " ").trim(); }

// Keeps the month/year selects of the dialog (when present) in step with the MM/YYYY text input that is validated.
function bindMonthPicker(dialog, input) {
  const monthSelect = dialog.querySelector("#new-declaration-month-name");
  const yearSelect = dialog.querySelector("#new-declaration-year");
  if (!monthSelect || !yearSelect) return;
  const [month, year] = input.value.split("/");
  const first = Number(year) - 5;
  yearSelect.replaceChildren(...Array.from({ length: 9 }, (_, index) => new Option(String(first + index), String(first + index))));
  monthSelect.value = month;
  yearSelect.value = year;
  const sync = () => { input.value = `${monthSelect.value}/${yearSelect.value}`; };
  monthSelect.onchange = yearSelect.onchange = sync;
}

// Tax profile inputs of a client dialog: { vatId, incomeTaxFileId, advancePercent, pcn, hint }.
function fillProfile(inputs, config) {
  inputs.vatId.value = config.vatId ?? "";
  inputs.incomeTaxFileId.value = config.incomeTaxFileId ?? "";
  inputs.pcn.checked = Boolean(config.pcnRequired);
  inputs.advancePercent.value = "";
  showProfileHint(inputs);
}
function readProfile(inputs) {
  return { vatId: inputs.vatId.value, incomeTaxFileId: inputs.incomeTaxFileId.value, pcnRequired: inputs.pcn.checked };
}
// Empty = not set (null); anything else must be a number from 0 to 100.
function advancePercentOf(inputs) {
  const text = inputs.advancePercent.value.trim().replace(",", ".");
  if (!text) return null;
  const percent = Number(text);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error("אחוז מקדמות חייב להיות מספר בין 0 ל‑100.");
  return percent;
}
// Soft warning under the fields; saving is never blocked by it.
function showProfileHint(inputs) {
  const vat = taxIdProblem(inputs.vatId.value, { checkDigit: true });
  const income = taxIdProblem(inputs.incomeTaxFileId.value);
  const problems = [vat && "מספר עוסק מורשה: " + vat, income && "מספר מס הכנסה: " + income].filter(Boolean);
  inputs.hint.textContent = problems.join(" ");
  inputs.hint.hidden = !problems.length;
}
async function saveAdvancePercent(directory, percent) {
  const settings = await readReportSettings(directory);
  if (settings.advancePercent !== percent) await saveReportSettings(directory, { ...settings, advancePercent: percent });
}

export function setupWorkspaceControls({ getInboxCounts = () => ({}), onClientsChanged = () => {}, onClientOpen = () => {}, newClientDialog = null, newClientError = null, clientMonthInput = null, declarationDialog = null, clientList, showNewButton, openExistingButton, archivedToggle, dataRootButton, dataRootSummary, creationPanel, createButton, deleteButton, archiveButton, restoreButton, saveClientButton, exportClientButton = null, onExportClient = () => {}, clientMenu, clientMenuName, clientNameInput, clientActivityInput, clientKindInput, businessActivityInput, businessKindInput, clientVatPeriodInput = null, clientAdvancesPeriodInput = null, vatPeriodInput = null, advancesPeriodInput = null, newProfileInputs = null, profileInputs = null, summary, onDataRoot, onDeclaration, onUpdated, onArchived, onDeleted, onDeclarationRemoved, onError }) {
  if (!("showDirectoryPicker" in window) || !("showOpenFilePicker" in window) || !("indexedDB" in window)) { dataRootButton.disabled = true; summary.textContent = "נדרש Edge או Chrome עם גישה לתיקיות מקומיות."; return; }
  let needsPermission = false, activeClients = [], archivedClients = [], dataRoot = null, menuClient = null, showingArchived = false, activeClientId = null, activeDeclarationId = null, expandedClientId = null;
  const showDataRoot = () => { dataRootButton.hidden = false; dataRootButton.textContent = dataRoot ? "החלפת תיקיית נתונים" : "בחירת תיקיית נתונים"; dataRootSummary.textContent = dataRoot ? "תיקיית נתונים: " + dataRoot.name : "טרם נבחרה תיקיית נתונים."; dataRootSummary.classList.toggle("workspace-ready", Boolean(dataRoot)); };
  const visibleClients = () => showingArchived ? archivedClients : activeClients;
  const nextDeclarationMonth = (client) => { const date = new Date(); let month = declarationMonth(date); while ((client.declarations || []).some((item) => item.declaration.month === month)) { date.setMonth(date.getMonth() + 1); month = declarationMonth(date); } return month; };
  const hideMenu = () => { menuClient = null; if (clientMenu.open) clientMenu.close(); };
  const renderClients = () => {
    renderSidebarClients(clientList, { clients: visibleClients(), archivedMode: showingArchived, activeClientId, activeDeclarationId, expandedClientId, inboxCounts: getInboxCounts() }, {
      onClient: async (client) => { try { await ensureAccess(client.directory); activeClientId = expandedClientId = client.id; renderClients(); onClientOpen(client.id); } catch (error) { if (error.name !== "AbortError") onError("לא ניתן לפתוח לקוח: " + error.message); } },
      onMenu: showMenu,
      onDeclaration: async (client, month) => { try { await selectDeclaration(client, month); } catch (error) { onError("לא ניתן לפתוח הצהרה: " + error.message); } },
      onNewDeclaration: async (client) => { try { await createCurrentDeclaration(client); } catch (error) { onError("לא ניתן ליצור הצהרה: " + error.message); } },
    });
    archivedToggle.hidden = !archivedClients.length; archivedToggle.textContent = showingArchived ? "לקוחות פעילים" : "ארכיון (" + archivedClients.length + ")"; onClientsChanged();
  };
  let menuSettings = null;
  const loadProfile = (client) => {
    menuSettings = null;
    fillProfile(profileInputs, client.config);
    profileInputs.advancePercent.disabled = true;
    readReportSettings(client.directory).then((settings) => {
      if (menuClient !== client) return;
      menuSettings = settings;
      profileInputs.advancePercent.value = settings.advancePercent ?? "";
      profileInputs.advancePercent.disabled = false;
    }, () => {});
  };
  const showMenu = (client) => { menuClient = client; clientMenuName.textContent = client.clientName; businessActivityInput.value = client.config.businessActivity; businessKindInput.value = client.config.businessKind; if (vatPeriodInput) vatPeriodInput.value = client.config.vatPeriod ?? "monthly"; if (advancesPeriodInput) advancesPeriodInput.value = client.config.advancesPeriod ?? "monthly"; if (profileInputs) loadProfile(client); const rootClient = Boolean(client.parent); saveClientButton.hidden = !rootClient; archiveButton.hidden = !rootClient || client.config.archived; restoreButton.hidden = !rootClient || !client.config.archived; deleteButton.hidden = !rootClient; clientMenu.showModal(); };
  const scanClientsFromRoot = async () => { if (!dataRoot) return; const parent = await dataRoot.getDirectoryHandle("clients"), found = []; for await (const [entryName, handle] of parent.entries()) { if (handle.kind !== "directory") continue; try { const config = await readConfig(handle); found.push({ id: config.clientId || entryName, clientName: config.clientName, directory: handle, parent, entryName, config, declarations: await listDeclarations(handle) }); } catch {} } found.sort((left, right) => left.clientName.localeCompare(right.clientName, "he")); activeClients = found.filter((client) => !client.config.archived); archivedClients = found.filter((client) => client.config.archived); if (!activeClients.some((client) => client.id === activeClientId)) { activeClientId = null; activeDeclarationId = null; } renderClients(); };
  const setDataRoot = async (directory, restoring = false) => { if (!restoring) { await ensureAccess(directory); await directory.getDirectoryHandle("common", { create: true }); await directory.getDirectoryHandle("clients", { create: true }); await setting("data-root", directory); } dataRoot = directory; showDataRoot(); await onDataRoot?.(dataRoot); needsPermission = false; try { await scanClientsFromRoot(); } catch (error) { if (!restoring || error.name !== "NotAllowedError") throw error; needsPermission = true; onClientsChanged(); } };
  const selectDeclaration = async (client, month, { keepDrawer = false } = {}) => { await ensureAccess(client.directory); const selected = await loadDeclaration(client.directory, month); const workspace = { directory: client.directory, config: client.config }; if (await onDeclaration({ workspace, ...selected, keepDrawer }) === false) return; activeClientId = client.id; activeDeclarationId = selected.declaration.declarationId; summary.textContent = `נבחרה הצהרה: «${client.clientName}» · ${formatMonth(selected.declaration.month)}.`; summary.classList.add("workspace-ready"); renderClients(); };
  const validDeclarationMonth = (client, value) => {
    const month = parseMonthText(value);
    if (!month) throw new Error(MONTH_FORMAT_ERROR);
    if ((client.declarations || []).some((item) => item.declaration.month === month)) throw new Error("כבר קיימת הצהרה לחודש זה.");
    return month;
  };
  // Resolves to the chosen month, or null when cancelled. An in-page dialog is used when available: window.prompt is
  // not shown by every embedded browser.
  const askDeclarationMonth = (client) => {
    if (!declarationDialog) {
      const answer = window.prompt("לאיזה חודש ליצור הצהרה? (MM/YYYY)", formatMonth(nextDeclarationMonth(client)));
      return Promise.resolve(answer === null ? null : validDeclarationMonth(client, answer));
    }
    const input = declarationDialog.querySelector("#new-declaration-month");
    const errorLine = declarationDialog.querySelector("#new-declaration-error");
    input.value = formatMonth(nextDeclarationMonth(client));
    errorLine.textContent = "";
    bindMonthPicker(declarationDialog, input);
    return dialogResult(declarationDialog, {
      accept: declarationDialog.querySelector("#new-declaration-create"),
      getValue: () => validDeclarationMonth(client, input.value),
      onInvalid: (error) => { errorLine.textContent = error.message; },
    });
  };
  const firstDeclarationMonth = () => {
    const text = clientMonthInput?.value?.trim();
    if (!text) return declarationMonth(new Date());
    const month = parseMonthText(text);
    if (!month) throw new Error(MONTH_FORMAT_ERROR);
    return month;
  };
  const createCurrentDeclaration = async (client) => { const month = await askDeclarationMonth(client); if (!month) return; const created = await createDeclaration(client.directory, { clientId: client.config.clientId, month }); await scanClientsFromRoot(); expandedClientId = client.id; await selectDeclaration(activeClients.find((item) => item.id === client.id), created.declaration.month, { keepDrawer: true }); };
  const openExisting = async () => { const directory = await window.showDirectoryPicker({ mode: "readwrite", startIn: "documents" }); const config = await readConfig(directory); const temporary = { id: config.clientId || directory.name, clientName: config.clientName, directory, parent: null, config, declarations: await listDeclarations(directory) }; expandedClientId = temporary.id; activeClients = [temporary]; archivedClients = []; renderClients(); };
  const createNew = async () => { const clientName = clientNameInput.value.trim(), businessActivity = clientActivityInput.value.trim(), name = directoryName(clientName); if (!clientName || !businessActivity) throw new Error("יש למלא שם לקוח וסוג פעילות."); const percent = newProfileInputs ? advancePercentOf(newProfileInputs) : null; if (!name) throw new Error("שם הלקוח אינו יכול לשמש כשם תיקייה."); if (!dataRoot) throw new Error("יש לבחור תחילה תיקיית נתונים."); const parent = await dataRoot.getDirectoryHandle("clients", { create: true }), directory = await parent.getDirectoryHandle(name, { create: true }); try { await readConfig(directory); throw new Error("בתיקייה זו כבר קיים לקוח. יש לפתוח אותו במקום ליצור מחדש."); } catch (error) { if (error.message.includes("כבר קיים")) throw error; if (error.name !== "NotFoundError") throw error; } const config = { schemaVersion: 1, clientId: crypto.randomUUID(), clientName, businessActivity, businessKind: clientKindInput.value, archived: false, vatPeriod: clientVatPeriodInput?.value || "monthly", advancesPeriod: clientAdvancesPeriodInput?.value || "monthly", ...(newProfileInputs ? normalizeClientTaxProfile(readProfile(newProfileInputs)) : {}) }; await createDeclaration(directory, { clientId: config.clientId, month: firstDeclarationMonth() }); await writeConfig(directory, config); if (percent !== null) await saveAdvancePercent(directory, percent); creationPanel.hidden = true; clientNameInput.value = ""; clientActivityInput.value = ""; if (newProfileInputs) fillProfile(newProfileInputs, {}); expandedClientId = config.clientId; await scanClientsFromRoot(); };
  const saveMenuConfig = async (changes, callback) => { if (!menuClient || !menuClient.parent) throw new Error("פעולה זו זמינה רק ללקוח שבתיקיית הנתונים."); const result = normalizeWorkspaceConfig({ ...menuClient.config, ...changes }); if (!result.valid) throw new Error(result.error); await writeConfig(menuClient.directory, result.config); const saved = { ...menuClient, config: result.config, clientName: result.config.clientName }; if (result.config.archived && activeClientId === saved.id) activeClientId = null; hideMenu(); await scanClientsFromRoot(); callback?.(saved); };
  showDataRoot(); renderClients();
  for (const inputs of [newProfileInputs, profileInputs]) {
    for (const input of inputs ? [inputs.vatId, inputs.incomeTaxFileId] : []) input.addEventListener("input", () => showProfileHint(inputs));
  }
  clientMenu.addEventListener("close", () => { menuClient = null; });
  dataRootButton.addEventListener("click", async () => { try { await setDataRoot(await window.showDirectoryPicker({ mode: "readwrite", startIn: "documents" })); } catch (error) { if (error.name !== "AbortError") onError("לא ניתן לבחור תיקיית נתונים: " + error.message); } });
  showNewButton.addEventListener("click", () => { if (newClientDialog) { if (newClientError) newClientError.textContent = ""; if (clientMonthInput && !clientMonthInput.value) clientMonthInput.value = formatMonth(declarationMonth(new Date())); newClientDialog.showModal(); clientNameInput.focus(); return; } creationPanel.hidden = !creationPanel.hidden; if (clientMonthInput && !clientMonthInput.value) clientMonthInput.value = formatMonth(declarationMonth(new Date())); if (!creationPanel.hidden) clientNameInput.focus(); });
  openExistingButton?.addEventListener("click", async () => { try { await openExisting(); } catch (error) { if (error.name !== "AbortError") onError("לא ניתן לפתוח לקוח: " + error.message); } });
  archivedToggle.addEventListener("click", () => { showingArchived = !showingArchived; hideMenu(); renderClients(); });
  createButton.addEventListener("click", async () => { try { await createNew(); newClientDialog?.close(); } catch (error) { if (error.name === "AbortError") return; const message = "לא ניתן ליצור לקוח: " + error.message; if (newClientError && newClientDialog?.open) newClientError.textContent = message; else onError(message); } });
  exportClientButton?.addEventListener("click", () => { if (!menuClient) return; const client = menuClient; hideMenu(); onExportClient(client.id); });
  saveClientButton.addEventListener("click", async () => { try { const percent = profileInputs ? advancePercentOf(profileInputs) : null; if (profileInputs && menuSettings && menuClient) await saveAdvancePercent(menuClient.directory, percent); await saveMenuConfig({ businessActivity: businessActivityInput.value.trim(), businessKind: businessKindInput.value, ...(vatPeriodInput ? { vatPeriod: vatPeriodInput.value, advancesPeriod: advancesPeriodInput.value } : {}), ...(profileInputs ? readProfile(profileInputs) : {}) }, onUpdated); } catch (error) { onError("לא ניתן לשמור את פרטי הלקוח: " + error.message); } });
  archiveButton.addEventListener("click", async () => { try { await saveMenuConfig({ archived: true }, onArchived); } catch (error) { onError("לא ניתן לארכב לקוח: " + error.message); } });
  restoreButton.addEventListener("click", async () => { try { await saveMenuConfig({ archived: false }, (saved) => { showingArchived = false; renderClients(); onUpdated(saved); }); } catch (error) { onError("לא ניתן לשחזר לקוח: " + error.message); } });
  deleteButton.addEventListener("click", async () => { try { if (!menuClient?.parent) throw new Error("פעולה זו זמינה רק ללקוח שבתיקיית הנתונים."); const client = menuClient; if (!await confirmDialog("למחוק לצמיתות את «" + client.clientName + "»? יימחקו גם ההיסטוריה, קובצי PDF, TXT וכל החבילות.", { title: "מחיקת לקוח", confirmLabel: "מחיקה" })) return; await ensureAccess(client.parent); const target = await client.parent.getDirectoryHandle(client.entryName); if (!await target.isSameEntry(client.directory)) throw new Error("התיקייה שנבחרה אינה תיקיית הלקוח. המחיקה בוטלה."); await client.parent.removeEntry(client.entryName, { recursive: true }); hideMenu(); await scanClientsFromRoot(); onDeleted?.(client.id); } catch (error) { if (error.name !== "AbortError") onError("לא ניתן למחוק לקוח: " + error.message); } });
  (async () => { try { const storedRoot = await setting("data-root"); if (storedRoot) await setDataRoot(storedRoot, true); } catch (error) { onError("לא ניתן לשחזר את ההגדרות המקומיות: " + error.message); } })();
  const refreshFromUserAction = async () => { if (!dataRoot) return; await ensureAccess(dataRoot); needsPermission = false; await scanClientsFromRoot(); };
  const showActiveClients = () => { showingArchived = false; hideMenu(); renderClients(); };
  // Read access and actions for the clients home and the client card (clients-home.js).
  const findClient = (clientId) => [...activeClients, ...archivedClients].find((client) => client.id === clientId);
  const clientsApi = {
    getClients: () => ({ active: activeClients, archived: archivedClients, activeClientId, activeDeclarationId, hasRoot: Boolean(dataRoot), needsPermission }),
    openDeclaration: async (clientId, month) => { const client = findClient(clientId); if (client) await selectDeclaration(client, month); },
    newDeclaration: async (clientId) => { const client = findClient(clientId); if (client) await createCurrentDeclaration(client); },
    editClient: (clientId) => { const client = findClient(clientId); if (client) showMenu(client); },
    setDeclarationArchived: async (clientId, month, archive) => {
      const client = findClient(clientId), item = client?.declarations.find((entry) => entry.declaration.month === month);
      if (!item) return;
      const verb = archive ? "לארכב" : "לשחזר";
      if (!await confirmDialog(`${verb} את ההצהרה ${formatMonth(month)}?`, { confirmLabel: archive ? "ארכוב" : "שחזור" })) return;
      await archiveDeclaration(client.directory, month, archive);
      if (archive && activeDeclarationId === item.declaration.declarationId) { activeDeclarationId = null; onDeclarationRemoved?.(item.declaration.declarationId); }
      await scanClientsFromRoot();
    },
    deleteDeclaration: async (clientId, month) => {
      const client = findClient(clientId), item = client?.declarations.find((entry) => entry.declaration.month === month);
      if (!item) return;
      if (!await confirmDialog(`למחוק לצמיתות את ההצהרה ${formatMonth(month)}? יימחקו תמונות, ייצואים וקובצי הדיווח של חודש זה.`, { title: "מחיקת הצהרה", confirmLabel: "מחיקה" })) return;
      await ensureAccess(client.directory);
      await deleteDeclaration(client.directory, month);
      if (activeDeclarationId === item.declaration.declarationId) { activeDeclarationId = null; onDeclarationRemoved?.(item.declaration.declarationId); }
      await scanClientsFromRoot();
    },
    refresh: refreshFromUserAction,
  };
  return { clearPending: hideMenu, refreshFromUserAction, showActiveClients, renderSidebar: renderClients, ...clientsApi };
}
