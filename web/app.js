import { setupWorkspaceControls } from "./workspace.js";
import { pdfSourceFileName, validatePdfFile } from "./pdf-import.js";
import {
  finalizeDeclaration,
  reopenLockedDeclaration,
  loadDeclaration,
  readSourceImage,
  saveDraft,
  saveSourceImage,
} from "./declaration-store.js";
import { chartForClient, readChartOfAccounts, readClientChart } from "./chart-of-accounts.js";
import { setupLedgerCheck } from "./ledger-check-ui.js";
import { setupRowsMove } from "./rows-move-ui.js";
import { buildIncomeRows, hasIncomeRow, readIncomeReportFile } from "./income-report.js";
import { setupLedgerCodes } from "./ledger-codes-ui.js";
import { confirmDialog, dialogResult } from "./confirm-dialog.js";
import { NO_EXPORT_MARKER, declarationActions } from "./declaration-core.js";
import { formatMonth } from "./month-format.js";
import { createClientsHome } from "./clients-home.js";
import { setupJournalColumns } from "./journal-columns.js";
import { setupJournalToolbar } from "./journal-toolbar.js";
import { summarise } from "./journal-summary.js";
import { readUiSettings, saveUiSettings } from "./ui-settings.js";
import { setupExcelImport } from "./excel-import-ui.js";
import { setupReports } from "./reports-ui.js";
import { setupBackup } from "./backup-ui.js";
import { setupAccess } from "./access-ui.js";
import { checkModelConnection, createModelClient } from "./model-client.js";
import { setupTransfer } from "./transfer-ui.js";
import { setupInbox } from "./inbox-ui.js";
import { progressLabel, setupAssistant } from "./assistant-ui.js";
import { buildMessage, createAssistantFlow, resultNote } from "./assistant-flow.js";
import { setupModelSettings } from "./model-settings-ui.js";
import { applyProposal } from "./proposal-apply.js";
import { setupPcnReview } from "./pcn-review-ui.js";
import { recognisedAmounts, sourceAmountsFromGross, sourceAmountsFromNet, sourceAmountsFromVat } from "./row-calculations.js";
import { isHomeUtility } from "./home-utilities.js";
import {
  readCustomRivhitMapping,
  readCustomRivhitMappingMetadata,
  readForm6111Mappings,
  saveCustomRivhitMapping,
  saveForm6111Mapping,
} from "./custom-rivhit-mapping.js";

const clientsHome = createClientsHome();
const journalColumns = setupJournalColumns({
  table: document.querySelector("#journal-table"),
  menu: document.querySelector("#columns-menu"),
  onChange: (hiddenColumns) => {
    if (dataRoot) saveUiSettings(dataRoot, { hiddenColumns }).catch((error) => showError(`לא ניתן לשמור את בחירת העמודות: ${error.message}`));
  },
});
const api = (window.ANNATERIA_API || "").replace(/\/$/, ""),
  builtInMapping = { ...(window.RIVHIT_MAPPING || {}) };
const importIncomeReportButton = document.querySelector("#import-income-report"),
  status = document.querySelector("#status"),
  records = document.querySelector("#records"),
  count = document.querySelector("#count"),
  emptyRow = document.querySelector("#empty-row"),
  photoWindow = document.querySelector("#photo-window"),
  dialogImage = document.querySelector("#dialog-image"),
  photoTitle = document.querySelector("#photo-title"),
  photoViewport = document.querySelector("#photo-viewport"),
  businessActivity = document.querySelector("#business-activity"),
  businessKind = document.querySelector("#business-kind"),
  workspaceSummary = document.querySelector("#workspace-summary"),
  currentClient = document.querySelector("#current-client"),
  journalTitle = document.querySelector("#journal-title"),
  backendVersion = document.querySelector("#backend-version"),
  dataRootTitle = document.querySelector("#data-root-title"),
  closeDeclarationButton = document.querySelector("#close-declaration"),
  reopenDeclarationButton = document.querySelector("#reopen-declaration"),
  declarationBadge = document.querySelector("#declaration-badge"),
  openPackage = document.querySelector("#open-package"),
  uploadRequirements = document.querySelector("#upload-requirements"),
  customClassificationDialog = document.querySelector("#custom-classification-dialog"),
  customClassificationCode = document.querySelector("#custom-classification-code"),
  customClassificationName = document.querySelector("#custom-classification-name"),
  customClassificationError = document.querySelector("#custom-classification-error"),
  saveCustomClassification = document.querySelector("#save-custom-classification"),
  manageClassifications = document.querySelector("#manage-classifications"),
  classificationManagementDialog = document.querySelector("#classification-management-dialog"),
  customClassificationList = document.querySelector("#custom-classification-list");
let dataRoot = null,
  inboxUi = null,
  modelSettings = null,
  inboxFileCounts = {},
  workspace = null,
  committedWorkspace = null,
  currentDeclaration = null,
  currentDeclarationDirectory = null,
  recordCount = 0,
  imageCount = 0,
  drag = null,
  resize = null,
  imageDrag = null,
  zoom = 1,
  panX = 0,
  panY = 0,
  tableLocked = false,
  draftSaveTimer = null,
  rivhitMapping = { ...builtInMapping },
  customMapping = {},
  chartAccounts = {},
  customMappingMetadata = {},
  form6111Mappings = {},
  pendingClassificationRow = null,
  newCustomCodes = new Set();

function apiUrl(path) {
  return `${api}${path}`;
}
async function loadBackendVersion() {
  if (!api) {
    backendVersion.textContent = "גרסת שרת: לא הוגדרה";
    return;
  }
  try {
    const response = await fetch(apiUrl("/health"));
    const data = await response.json();
    if (!response.ok || !data.version) throw new Error();
    backendVersion.textContent = `גרסת שרת: ${data.version}`;
  } catch {
    backendVersion.textContent = "גרסת שרת: לא זמינה";
  }
}
function showError(message) {
  status.dataset.nextKind = "error";
  status.textContent = message;
}
function showExportResult({ title, message, error = false }) {
  const dialog = document.querySelector("#export-result-dialog"),
    heading = document.querySelector("#export-result-title"),
    body = document.querySelector("#export-result-message");
  heading.textContent = title;
  body.textContent = message;
  body.className = error ? "export-result-error" : "export-result-success";
  dialog.showModal();
}
function updateStartAvailability() {
  const open = currentDeclaration?.status === "open";
  const actions = declarationActions({ dataRoot, declaration: currentDeclaration, workspaceCommitted: committedWorkspace });
  importIncomeReportButton.disabled = !actions.canStart;
  closeDeclarationButton.disabled = !actions.canClose;
  declarationBadge.hidden = !currentDeclaration;
  declarationBadge.textContent = actions.open ? "פתוחה" : "נעולה";
  declarationBadge.dataset.state = actions.open ? "open" : "locked";
  reopenDeclarationButton.hidden = !actions.canReopen;
  closeDeclarationButton.hidden = actions.canReopen;
  uploadRequirements.textContent = !dataRoot
    ? "יש לבחור תחילה תיקיית נתונים בסביבות העבודה."
    : !currentDeclaration
      ? "יש לבחור הצהרה לפני העלאת תמונות."
      : !open
        ? "ההצהרה נעולה ואי אפשר להוסיף אליה תמונות."
        : "";
}
async function activateDeclaration(selected) {
  if (
    currentDeclaration &&
    currentDeclaration.declarationId !== selected.declaration.declarationId &&
    records.querySelector("tr[data-document-id]") &&
    !(await confirmDialog("לעבור להצהרה אחרת? הטיוטה הנוכחית תישמר מקומית.", { confirmLabel: "מעבר" }))
  )
    return false;
  await saveCurrentDraft();
  workspace = committedWorkspace = selected.workspace;
  await applyClientChart(workspace.directory);
  currentDeclaration = selected.declaration;
  currentDeclarationDirectory = selected.directory;
  businessActivity.value = workspace.config.businessActivity;
  businessKind.value = workspace.config.businessKind;
  records.replaceChildren();
  recordCount = 0;
  imageCount = 0;
  newCustomCodes = new Set(
    Object.entries(customMappingMetadata)
      .filter(([, metadata]) => Date.parse(metadata.createdAt) >= Date.parse(currentDeclaration.createdAt))
      .map(([code]) => code),
  );
  for (const saved of selected.draft?.rows || []) {
    try {
      // A copy restored without images (the default of the backup) has no image files: the row opens without a photo.
      const blob = saved.imageFile
        ? await readSourceImage(selected.directory, saved.imageFile).catch((error) => {
            if (error.name === "NotFoundError") return null;
            throw error;
          })
        : null;
      restoreRow(saved, blob);
      imageCount = Math.max(imageCount, Number(saved.imageIndex) || 0);
    } catch (error) {
      // The table is half built: no later save may write it over the file of this month.
      currentDeclaration = null;
      currentDeclarationDirectory = null;
      throw new Error(`לא ניתן לשחזר תמונה ${saved.imageFile || ""}: ${error.message}`);
    }
  }
  refreshRows();
  setTableLocked(currentDeclaration.status !== "open");
  currentClient.textContent = `לקוח: ${workspace.config.clientName} · הצהרה: ${formatMonth(currentDeclaration.month)}`;
  journalTitle.textContent = currentClient.textContent;
  clientsHome.showJournal({ clientId: workspace.config.clientId, month: currentDeclaration.month });
  applyBusinessRules();
  status.textContent = currentDeclaration.status === "open" ? "" : "ההצהרה נעולה לקריאה בלבד.";
  updateStartAvailability();
  return true;
}
function updateWorkspace(selected) {
  if (workspace?.config.clientId === selected.config.clientId) workspace = { ...workspace, config: selected.config };
  if (committedWorkspace?.config.clientId === selected.config.clientId) {
    committedWorkspace = { ...committedWorkspace, config: selected.config };
    businessActivity.value = selected.config.businessActivity;
    businessKind.value = selected.config.businessKind;
    applyBusinessRules();
    pcnJournal?.refresh();
  }
}
function clearActiveClient(clientId) {
  if (workspace?.config.clientId === clientId) workspace = null;
  if (committedWorkspace?.config.clientId === clientId) {
    committedWorkspace = null;
    currentDeclaration = null;
    currentClient.textContent = "לא נבחרה הצהרה";
    journalTitle.textContent = "לקוח והצהרה לא נבחרו";
    updateStartAvailability();
    pcnJournal?.refresh();
  }
}
function clearActiveDeclaration(declarationId) {
  if (currentDeclaration?.declarationId !== declarationId) return;
  currentDeclaration = null;
  currentDeclarationDirectory = null;
  records.replaceChildren(emptyRow);
  recordCount = 0;
  currentClient.textContent = "לא נבחרה הצהרה";
  journalTitle.textContent = "לקוח והצהרה לא נבחרו";
  updateStartAvailability();
}
async function switchDataRoot(selected) {
  await saveCurrentDraft();
  dataRoot = selected;
  inboxUi?.refreshCounts();
  folderPathInput.value = "";
  readUiSettings(selected)
    .then((settings) => {
      journalColumns.setHidden(settings.hiddenColumns, { persist: false });
      folderPathInput.value = settings.folderPath;
      modelSettings?.setOverrides(settings.models);
    })
    .catch(() => {});
  backup.runAuto("start");
  clientsHome.showHome();
  dataRootTitle.textContent = `תיקיית נתונים: ${selected.name}`;
  workspace = null;
  committedWorkspace = null;
  currentDeclaration = null;
  currentDeclarationDirectory = null;
  recordCount = 0;
  imageCount = 0;
  newCustomCodes = new Set();
  records.replaceChildren(emptyRow);
  currentClient.textContent = "לא נבחרה הצהרה";
  journalTitle.textContent = "לקוח והצהרה לא נבחרו";
  workspaceSummary.textContent = "נבחרה תיקיית נתונים חדשה. יש לבחור לקוח והצהרה.";
  workspaceSummary.classList.remove("workspace-ready");
  customMapping = {};
  chartAccounts = {};
  customMappingMetadata = {};
  form6111Mappings = {};
  rivhitMapping = currentMapping();
  try {
    await loadCustomMapping(selected);
  } catch (error) {
    showError("לא ניתן לטעון קודי מיון מקומיים: " + error.message);
  }
  status.textContent = "תיקיית הנתונים הוחלפה. יש לבחור לקוח והצהרה מהתיקייה החדשה.";
  updateStartAvailability();
}
function refreshClassificationSelectors() {
  for (const row of records.querySelectorAll("tr[data-document-id]")) {
    const value = row.cells[1].querySelector("select")?.value || "";
    row.cells[1].replaceChildren(classificationSelect(value));
  }
}
// Chart-of-accounts codes (Excel import) are shown by name; built-in and custom codes take precedence.
function currentMapping() {
  const chart = Object.fromEntries(Object.entries(chartAccounts).map(([code, account]) => [code, account.name]));
  return { ...chart, ...builtInMapping, ...customMapping };
}
// A client with its own codes (loaded from its ledger) is shown by them; any other client by the shared chart.
async function applyClientChart(clientDirectory) {
  chartAccounts = (await readClientChart(clientDirectory, builtInMapping)) ?? (await readChartOfAccounts(dataRoot, builtInMapping)) ?? {};
  rivhitMapping = currentMapping();
}
async function loadCustomMapping(root) {
  [customMapping, customMappingMetadata, form6111Mappings, chartAccounts] = await Promise.all([
    readCustomRivhitMapping(root, builtInMapping),
    readCustomRivhitMappingMetadata(root, builtInMapping),
    readForm6111Mappings(root, builtInMapping),
    readChartOfAccounts(root, builtInMapping).then((chart) => chart ?? {}),
  ]);
  rivhitMapping = currentMapping();
  refreshClassificationSelectors();
}
const backup = setupBackup({
  dialog: document.querySelector("#backup-dialog"),
  openButton: document.querySelector("#open-backup"),
  getDataRoot: () => dataRoot,
  onError: showError,
});
const workspaceControls = setupWorkspaceControls({
  getInboxCounts: () => inboxFileCounts,
  onClientsChanged: () => clientsHome.refresh(),
  onClientOpen: (clientId) => clientsHome.openClient(clientId),
  newClientDialog: document.querySelector("#new-client-dialog"),
  newClientError: document.querySelector("#new-client-error"),
  clientList: document.querySelector("#client-list"),
  showNewButton: document.querySelector("#show-new-client"),
  openExistingButton: document.querySelector("#open-existing-client"),
  archivedToggle: document.querySelector("#toggle-archived-clients"),
  dataRootButton: document.querySelector("#select-data-root"),
  dataRootSummary: document.querySelector("#data-root-summary"),
  creationPanel: document.querySelector("#new-client-form"),
  createButton: document.querySelector("#create-client"),
  deleteButton: document.querySelector("#delete-client"),
  archiveButton: document.querySelector("#archive-client"),
  restoreButton: document.querySelector("#restore-client"),
  saveClientButton: document.querySelector("#save-client-settings"),
  exportClientButton: document.querySelector("#export-client"),
  onExportClient: (clientId) => transfer.openExport({ clientId }),
  clientMenu: document.querySelector("#client-menu"),
  clientMenuName: document.querySelector("#client-menu-name"),
  clientNameInput: document.querySelector("#new-client-name"),
  clientActivityInput: document.querySelector("#new-client-activity"),
  clientKindInput: document.querySelector("#new-client-kind"),
  clientMonthInput: document.querySelector("#new-client-month"),
  declarationDialog: document.querySelector("#new-declaration-dialog"),
  businessActivityInput: businessActivity,
  businessKindInput: businessKind,
  vatPeriodInput: document.querySelector("#client-vat-period"),
  advancesPeriodInput: document.querySelector("#client-advances-period"),
  clientVatPeriodInput: document.querySelector("#new-client-vat-period"),
  clientAdvancesPeriodInput: document.querySelector("#new-client-advances-period"),
  newProfileInputs: {
    vatId: document.querySelector("#new-client-vat-id"),
    incomeTaxFileId: document.querySelector("#new-client-income-tax-id"),
    advancePercent: document.querySelector("#new-client-advance-percent"),
    pcn: document.querySelector("#new-client-pcn"),
    hint: document.querySelector("#new-client-tax-hint"),
  },
  profileInputs: {
    vatId: document.querySelector("#client-vat-id"),
    incomeTaxFileId: document.querySelector("#client-income-tax-id"),
    advancePercent: document.querySelector("#client-advance-percent"),
    pcn: document.querySelector("#client-pcn"),
    hint: document.querySelector("#client-tax-hint"),
  },
  summary: workspaceSummary,
  onDataRoot: switchDataRoot,
  onDeclaration: activateDeclaration,
  onUpdated: updateWorkspace,
  onArchived: (selected) => {
    clearActiveClient(selected.config.clientId);
  },
  onDeclarationRemoved: clearActiveDeclaration,
  onDeleted: clearActiveClient,
  onError: showError,
});
clientsHome.bind(workspaceControls, {
  onError: showError,
  onOpenReports: (clientId, kind) => {
    const state = workspaceControls.getClients();
    const client = [...state.active, ...state.archived].find((item) => item.id === clientId);
    if (client) reports.open({ client, kind });
  },
  onExportMonth: (clientId, month) => transfer.openExport({ clientId, month }),
});
const folderPathInput = document.querySelector("#data-root-path");
folderPathInput.addEventListener("change", () => {
  if (dataRoot) saveUiSettings(dataRoot, { folderPath: folderPathInput.value }).catch((error) => showError(`לא ניתן לשמור את הנתיב: ${error.message}`));
});
setupJournalToolbar({
  records: document.querySelector("#records"),
  menu: document.querySelector("#filter-menu"),
  summary: {
    element: document.querySelector("#journal-summary"),
    compute: () =>
      summarise(
        [...document.querySelectorAll("#records tr[data-document-id]")].map((row) => rowSnapshot(row)),
        { chart: chartForClient(chartAccounts, committedWorkspace?.config.clientId), names: rivhitMapping },
      ),
  },
});
const excelImport = setupExcelImport({
  button: document.querySelector("#import-excel"),
  dialog: document.querySelector("#excel-import-dialog"),
  getContext: () =>
    dataRoot && committedWorkspace
      ? { dataRoot, client: committedWorkspace, reserved: { ...builtInMapping, ...customMapping } }
      : null,
  // Saving the open table after the import would overwrite the imported rows, so detach it first.
  onBeforeCommit: async (month) => {
    if (currentDeclaration?.month !== month) return;
    await saveCurrentDraft();
    clearActiveDeclaration(currentDeclaration.declarationId);
  },
  onImported: async ({ chart }, month) => {
    chartAccounts = chart;
    rivhitMapping = currentMapping();
    refreshClassificationSelectors();
    await workspaceControls.refreshFromUserAction();
    const selected = await loadDeclaration(committedWorkspace.directory, month);
    await activateDeclaration({ workspace: committedWorkspace, ...selected });
  },
  onOpenCodes: () => ledgerCodes.open(),
  onError: showError,
});
const ledgerCodes = setupLedgerCodes({
  dialog: document.querySelector("#ledger-codes-dialog"),
  getContext: () =>
    dataRoot && committedWorkspace
      ? { dataRoot, client: committedWorkspace, reserved: { ...builtInMapping, ...customMapping } }
      : null,
  // Writing the remapped tables under the open table would be overwritten by its next save, so detach it first.
  onBeforeWrite: async (months) => {
    if (!currentDeclaration || !months.includes(currentDeclaration.month)) return null;
    const month = currentDeclaration.month;
    await saveCurrentDraft();
    clearActiveDeclaration(currentDeclaration.declarationId);
    return month;
  },
  onSaved: async ({ chart }, month) => {
    chartAccounts = chart;
    rivhitMapping = currentMapping();
    refreshClassificationSelectors();
    excelImport.refreshCodes();
    if (!month) return;
    const selected = await loadDeclaration(committedWorkspace.directory, month);
    await activateDeclaration({ workspace: committedWorkspace, ...selected });
  },
  onError: showError,
});
const ledgerCheck = setupLedgerCheck({
  button: document.querySelector("#check-ledger"),
  dialog: document.querySelector("#ledger-check-dialog"),
  getContext: () =>
    dataRoot && committedWorkspace
      ? { dataRoot, client: committedWorkspace, reserved: { ...builtInMapping, ...customMapping } }
      : null,
  // Same as for the ledger codes: the open table is detached while its file is rewritten and opened again afterwards.
  onBeforeWrite: async (months) => {
    if (!currentDeclaration || !months.includes(currentDeclaration.month)) return null;
    const month = currentDeclaration.month;
    await saveCurrentDraft();
    clearActiveDeclaration(currentDeclaration.declarationId);
    return month;
  },
  onSaved: async (result, month) => {
    await workspaceControls.refreshFromUserAction();
    const reopen = month ?? currentDeclaration?.month;
    if (!reopen) return;
    const selected = await loadDeclaration(committedWorkspace.directory, reopen);
    await activateDeclaration({ workspace: committedWorkspace, ...selected });
  },
  onError: showError,
});
let movingMonth = null;
const rowsMove = setupRowsMove({
  button: document.querySelector("#move-rows"),
  dialog: document.querySelector("#rows-move-dialog"),
  getContext: () =>
    committedWorkspace && currentDeclaration?.status === "open"
      ? { client: committedWorkspace, month: currentDeclaration.month, isIncomeCode }
      : null,
  // The table is read from its file, so it must be saved first and must not change while the dialog is open.
  beforeOpen: async () => {
    await saveCurrentDraft();
    return null;
  },
  // Same as for the ledger check: the open table is detached while its file is rewritten and opened again afterwards.
  onBeforeWrite: async () => {
    movingMonth = currentDeclaration.month;
    await saveCurrentDraft();
    clearActiveDeclaration(currentDeclaration.declarationId);
  },
  onSaved: async () => {
    await workspaceControls.refreshFromUserAction();
    if (!movingMonth) return;
    const month = movingMonth;
    movingMonth = null;
    const selected = await loadDeclaration(committedWorkspace.directory, month);
    await activateDeclaration({ workspace: committedWorkspace, ...selected });
  },
  onError: showError,
});
let pcnJournal = null;
// Clients with a PCN duty: yellow rows and a tick for invoices above the allocation ceiling (pcn-review.js).
pcnJournal = setupPcnReview({
  records,
  plate: document.querySelector("#pcn-plate"),
  columns: journalColumns,
  snapshot: rowSnapshot,
  isTableLocked: () => tableLocked,
  onChange: queueDraftSave,
  getContext: () => (committedWorkspace ? { pcnRequired: Boolean(committedWorkspace.config.pcnRequired) } : null),
});
// The table shows only the last four digits of a reference: a typed reference replaces the full one read by OCR.
// The rows of the agent for the table that is open: they go in at the end like rows of any other source. Resolves with their numbers.
function appendSnapshots(snapshots) {
  const first = records.querySelectorAll("tr[data-document-id]").length;
  for (const snapshot of snapshots) restoreRow(snapshot, null);
  refreshRows();
  queueDraftSave();
  pcnJournal?.refresh();
  return snapshots.map((_, index) => first + index + 1);
}
// Gives a row its original (a photo or a PDF) and the button that opens it.
function setRowImage(row, blob, imageFile, imageIndex) {
  row.dataset.imageFile = imageFile;
  row.dataset.imageIndex = String(imageIndex);
  row.documentImage = blob;
  row.imageUrl = URL.createObjectURL(blob);
  const open = document.createElement("button");
  open.type = "button";
  open.className = "photo-button";
  open.textContent = isPdfRow(row) ? `PDF #${imageIndex}` : `תמונה #${imageIndex}`;
  open.addEventListener("click", () => openPhoto(row.imageUrl, imageIndex, row));
  row.cells[13].replaceChildren(open);
  imageCount = Math.max(imageCount, imageIndex);
}
// After the agent filed an original: every row of the open table made from that file gets it. Resolves with how many did.
async function attachRowImages({ fileHash, imageFile, imageIndex }) {
  const blob = await readSourceImage(currentDeclarationDirectory, imageFile);
  let count = 0;
  for (const row of records.querySelectorAll("tr[data-document-id]")) {
    if ((row.dataset.agent ? JSON.parse(row.dataset.agent).file : null) !== fileHash) continue;
    setRowImage(row, blob, imageFile, imageIndex);
    count += 1;
  }
  queueDraftSave();
  return count;
}
records.addEventListener("input", (event) => {
  const cell = event.target.closest?.("td"),
    row = cell?.parentElement;
  if (row?.dataset.documentId && [...row.cells].indexOf(cell) === 6) delete row.dataset.fullReference;
});
function isIncomeCode(code) {
  const account = chartForClient(chartAccounts, committedWorkspace?.config.clientId)[String(code)];
  return (account?.type ?? (rivhitMapping[code] === "הכנסות" ? "income" : "expense")) === "income";
}
// After a batch of documents: offers the distribution dialog when some rows belong to another month.
const offerDistribution = () => rowsMove.offer().catch(() => false);
const transfer = setupTransfer({
  dialog: document.querySelector("#transfer-dialog"),
  openButton: document.querySelector("#open-transfer"),
  getDataRoot: () => dataRoot,
  getCurrent: () => (committedWorkspace && currentDeclaration ? { client: committedWorkspace.config, declaration: currentDeclaration } : null),
  getClients: () => workspaceControls?.getClients().active ?? [],
  saveCurrent: saveCurrentDraft,
  // Saving the open table after the import would overwrite the imported rows, so detach it first.
  beforeImport: async ({ clientId, months }) => {
    if (committedWorkspace?.config.clientId !== clientId || !months.includes(currentDeclaration?.month)) return;
    await saveCurrentDraft();
    clearActiveDeclaration(currentDeclaration.declarationId);
  },
  afterImport: async ({ clientId, months }) => {
    await workspaceControls?.refreshFromUserAction();
    if (months.length === 1) await workspaceControls?.openDeclaration(clientId, months[0]);
    else clientsHome.openClient(clientId);
  },
});
inboxUi = setupInbox({
  dialog: document.querySelector("#inbox-dialog"),
  openButton: document.querySelector("#open-inbox"),
  getDataRoot: () => dataRoot,
  getClients: () => workspaceControls?.getClients().active ?? [],
  onCheck: () => assistant.trigger("process"),
  onCounts: ({ byFolder }) => {
    inboxFileCounts = byFolder;
    workspaceControls?.renderSidebar?.();
  },
  onError: showError,
});
document.querySelector("#export-declaration").addEventListener("click", () => {
  if (committedWorkspace && currentDeclaration) transfer.openExport({ clientId: committedWorkspace.config.clientId, month: currentDeclaration.month });
});
const reports = setupReports({
  button: document.querySelector("#open-reports"),
  dialog: document.querySelector("#reports-view"),
  printRoot: document.querySelector("#report-print"),
  getContext: (client) => {
    const target = client ?? committedWorkspace;
    return dataRoot && target ? { client: target, dataRoot, names: rivhitMapping } : null;
  },
  onOpen: (context) => clientsHome.showReports({ clientId: context.client.config.clientId ?? context.client.id }),
  onError: showError,
});
updateStartAvailability();
loadBackendVersion();
// The access code (step 1.1): asked once per page load while a Worker is configured; the token stays in memory.
const accessUi = setupAccess({ dialog: document.querySelector("#access-dialog"), api });
if (api) accessUi.ensureLoggedIn();
const modelClient = createModelClient({ api, access: accessUi.access, ensureLoggedIn: accessUi.ensureLoggedIn });
modelSettings = setupModelSettings({ container: document.querySelector("#settings-dialog"), getDataRoot: () => dataRoot, onError: showError });
document.querySelector("#check-model").addEventListener("click", async () => {
  const result = document.querySelector("#model-check-result");
  result.textContent = "בודק…";
  const checked = await checkModelConnection(modelClient, modelSettings.getModels().orchestrator);
  result.textContent = checked.message;
});
// The assistant dock (step 4.3): "בדוק מסמכים חדשים", "מה נשאר?" and typed requests start one run of the agent (web/agent/); the report
// button opens the existing reports. One run at a time; the stop button aborts it.
const assistantFlow = createAssistantFlow({
  modelClient,
  getModels: () => modelSettings.getModels(),
  getDataRoot: () => dataRoot,
  getClients: () => workspaceControls?.getClients().active ?? [],
  getLiveTable: () =>
    committedWorkspace && currentDeclaration
      ? {
          clientId: committedWorkspace.config.clientId, month: currentDeclaration.month, rows: [...records.querySelectorAll("tr[data-document-id]")].map(rowSnapshot),
          append: async (snapshots) => appendSnapshots(snapshots), attachImage: attachRowImages, flush: saveCurrentDraft,
        }
      : null,
  onDeclarationCreated: () => { workspaceControls?.refreshFromUserAction().catch(() => {}); },
  builtInChart: () => Object.fromEntries(Object.entries(builtInMapping).map(([code, name]) => [code, { name, type: "expense" }])),
  reserved: () => ({ ...builtInMapping, ...customMapping }),
});
let assistantRun = null;
let assistantLastAnswer = "";
async function runAssistant(kind, text) {
  if (!api) return assistant.addMessage("error", "החיבור לשרת ה‑AI אינו מוגדר.");
  if (!dataRoot) return assistant.addMessage("error", "יש לבחור תחילה תיקיית נתונים.");
  const controller = new AbortController();
  const counts = {};
  assistantRun = controller;
  assistant.setBusy(true);
  try {
    const result = await assistantFlow.run({
      message: buildMessage({
        kind, text, today: new Date().toISOString().slice(0, 10), previous: assistantLastAnswer,
        active: committedWorkspace ? { clientName: committedWorkspace.config.clientName, month: currentDeclaration?.month ?? null } : null,
      }),
      ui: assistant.ui,
      signal: controller.signal,
      onProgress: (event) => assistant.setProgress(progressLabel(event, counts)),
    });
    const note = resultNote(result);
    assistant.addMessage(note.kind, note.text);
    if (result.status === "completed") assistantLastAnswer = result.text;
    if (result.logError) assistant.addMessage("note", `לא ניתן לשמור את יומן הריצה: ${result.logError}`);
  } catch (error) {
    assistant.addMessage("error", `העוזר נעצר: ${error.message}`);
  } finally {
    assistantRun = null;
    assistant.setBusy(false);
  }
}
// The edits of a proposal go through the functions of the table, as if the user typed them.
const proposalOps = {
  locked: () => tableLocked,
  month: () => currentDeclaration?.month ?? null,
  rows: () => [...records.querySelectorAll("tr[data-document-id]")],
  setText(row, cell, text) {
    row.cells[cell].textContent = text === "" ? "—" : text;
    if (cell === 3) addFieldSwapButton(row);
  },
  setReference(row, full) { row.dataset.fullReference = full; },
  setAmount(row, column, value) {
    row.cells[column].querySelector("input").value = Number(value).toFixed(2);
    manualAmountChanged(row, column);
  },
  setAccount(row, code) {
    row.cells[1].replaceChildren(classificationSelect(code));
    applyBusinessRule(row);
  },
  setPercent(row, role, value) {
    row.cells[role === "vat" ? 11 : 12].querySelector("select").value = String(value);
    recalculateRow(row);
  },
  setInclude: setExportIncluded,
  edited(row) {
    updateDuplicateState(row);
    queueDraftSave();
    pcnJournal?.refresh();
  },
};
function applyProposalToTable(proposal, kept) {
  return applyProposal({ ...proposal, changes: kept.map((index) => proposal.changes[index]) }, proposalOps);
}
const assistant = setupAssistant({
  root: document.querySelector("#assistant"),
  onApply: async (proposal, kept) => applyProposalToTable(proposal, kept),
  onCommand: (command) => {
    if (command.type === "cancel") assistantRun?.abort();
    else if (command.type === "report") reports.open();
    else runAssistant(command.type, command.text);
  },
});
async function saveCurrentDraft() {
  if (!currentDeclaration || currentDeclaration.status !== "open" || !currentDeclarationDirectory) return;
  clearTimeout(draftSaveTimer);
  try {
    await saveDraft(
      currentDeclarationDirectory,
      currentDeclaration,
      [...records.querySelectorAll("tr[data-document-id]")].map(rowSnapshot),
    );
  } catch (error) {
    showError("לא ניתן לשמור טיוטה מקומית: " + error.message);
    throw error;
  }
}
function queueDraftSave() {
  if (!currentDeclaration || currentDeclaration.status !== "open" || !currentDeclarationDirectory) return;
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => {
    saveCurrentDraft().catch(() => {});
  }, 250);
}
function receivedAtText(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? String(value || "—")
    : new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(date);
}
function displayDate(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1].slice(-2)}` : display(value);
}
function emptyCell(text = "—", className = "") {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}
function display(value) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}
function editableCell(value) {
  const cell = emptyCell(display(value), "editable");
  cell.contentEditable = "true";
  cell.spellcheck = false;
  return cell;
}
function amountCell(value, label) {
  const cell = document.createElement("td"),
    input = document.createElement("input");
  cell.className = "amount-cell";
  input.type = "number";
  input.inputMode = "decimal";
  input.min = "0";
  input.step = "0.01";
  input.value = value === null || value === undefined || value === "" ? "" : Number(value).toFixed(2);
  input.setAttribute("aria-label", label);
  cell.append(input);
  return cell;
}
function setTableLocked(locked) {
  tableLocked = locked;
  records.classList.toggle("table-locked", locked);
  for (const cell of records.querySelectorAll(".editable")) cell.contentEditable = locked ? "false" : "true";
  for (const control of records.querySelectorAll("select,input,.delete,.field-swap")) control.disabled = locked;
  pcnJournal?.refresh();
}
function refreshRows() {
  const rows = [...records.querySelectorAll("tr[data-document-id]")];
  recordCount = rows.length;
  rows.forEach((row, index) => {
    row.cells[0].textContent = String(index + 1);
  });
  count.textContent = `שורות ביומן: ${recordCount}`;
  if (!recordCount) records.append(emptyRow);
}
function setStatus(row, text, state = "") {
  const cell = row.cells[16];
  cell.replaceChildren(document.createTextNode(text));
  cell.className = `state ${state}`;
}
function percentSelect(value = 100, choices = [100, 25], role = "") {
  const select = document.createElement("select");
  select.dataset.role = role;
  for (const item of choices) {
    const option = new Option(`${item}%`, String(item), false, Number(value) === item);
    select.add(option);
  }
  select.addEventListener("change", () => {
    const row = select.closest("tr");
    if (role === "expense" && Number(row.dataset.rawVat || 0))
      row.cells[11].querySelector("select").value = select.value;
    recalculateRow(row);
    queueDraftSave();
  });
  return select;
}
function nextFreeClassificationCode() {
  let candidate =
    Math.max(
      799,
      ...Object.keys(rivhitMapping)
        .filter((code) => /^\d{3}$/.test(code))
        .map(Number),
    ) + 1;
  while (candidate <= 999 && rivhitMapping[String(candidate)]) candidate += 1;
  return candidate <= 999 ? String(candidate) : "";
}
function classificationSelect(code = "") {
  const wrap = document.createElement("span"),
    search = document.createElement("input"),
    select = document.createElement("select");
  wrap.className = "classification-picker";
  search.type = "search";
  search.placeholder = "חיפוש…";
  search.setAttribute("aria-label", "חיפוש קוד מיון");
  select.setAttribute("aria-label", "תוצאות חיפוש קוד מיון");
  const fill = (query = "") => {
    const needle = query.trim().toLocaleLowerCase("he");
    select.replaceChildren(new Option("—", ""));
    for (const [value, label] of Object.entries(rivhitMapping))
      if (!needle || value.includes(needle) || label.toLocaleLowerCase("he").includes(needle))
        select.add(new Option(label, value, false, value === code));
    select.add(new Option("הוספת קוד מיון חדש…", "__add_custom__"));
    if (code && !select.querySelector(`option[value="${CSS.escape(code)}"]`))
      select.add(new Option(rivhitMapping[code] || code, code, false, true));
    select.size = needle ? Math.min(Math.max(select.options.length, 1), 6) : 1;
  };
  const closeResults = () => {
    select.size = 1;
  };
  fill();
  select.dataset.lastValue = code;
  search.addEventListener("input", () => fill(search.value));
  search.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && search.value.trim()) {
      event.preventDefault();
      select.focus();
    }
    if (event.key === "Escape") {
      search.value = "";
      closeResults();
    }
  });
  search.addEventListener("blur", () => setTimeout(closeResults, 150));
  select.addEventListener("change", () => {
    const row = select.closest("tr");
    if (select.value === "__add_custom__") {
      select.value = select.dataset.lastValue || "";
      pendingClassificationRow = row;
      customClassificationError.textContent = "";
      customClassificationCode.value = nextFreeClassificationCode();
      customClassificationName.value = "";
      customClassificationDialog.showModal();
      customClassificationName.focus();
      return;
    }
    select.dataset.lastValue = select.value;
    code = select.value;
    search.value = "";
    closeResults();
    saveClassificationOverride(row, code);
    applyBusinessRule(row);
    queueDraftSave();
  });
  wrap.append(search, select);
  return wrap;
}
async function saveClassificationOverride(row, rivhitCode) {
  const form6111 = row.dataset.form6111Code;
  if (!form6111 || !rivhitCode) return;
  try {
    await saveForm6111Mapping(dataRoot, form6111, rivhitCode, builtInMapping);
    form6111Mappings[form6111] = rivhitCode;
  } catch (error) {
    showError("לא ניתן לשמור את מיפוי טופס 6111: " + error.message);
  }
}
function recalculateRow(row) {
  const expensePercent = row.cells[12].querySelector("select")?.value || 100,
    vatRecognisedPercent = row.cells[11].querySelector("select")?.value || 100,
    amounts = recognisedAmounts(row.dataset.rawNet, row.dataset.rawVat, expensePercent, vatRecognisedPercent);
  const gross = row.cells[8].querySelector("input");
  if (gross) gross.value = amounts.gross;
  else row.cells[8].textContent = amounts.gross;
  const net = row.cells[9].querySelector("input");
  if (net) net.value = amounts.net;
  else row.cells[9].textContent = amounts.net;
  const vatInput = row.cells[10].querySelector("input");
  if (vatInput) vatInput.value = amounts.vat;
  else row.cells[10].textContent = amounts.vat;
  const partial = Number(expensePercent) !== 100 || Number(vatRecognisedPercent) !== 100;
  row.cells[10].toggleAttribute("data-partial", partial);
  // The percent columns are hidden by default, so a partial recognition is also written under the VAT amount.
  if (partial) row.cells[10].dataset.recognised = `הוכר ${Number(expensePercent) !== 100 ? expensePercent : vatRecognisedPercent}%`;
  else delete row.cells[10].dataset.recognised;
  row.cells[10].title = partial ? `מוכר: מע״מ ${vatRecognisedPercent}% · הוצאה ${expensePercent}%` : "";
}
function vatRate(row) {
  const stored = Number(row.dataset.vatPercent);
  if (Number.isFinite(stored)) return stored;
  const net = Number(row.dataset.rawNet),
    vat = Number(row.dataset.rawVat);
  return net > 0 ? Math.round((vat / net) * 10000) / 100 : 18;
}
function manualAmountChanged(row, column) {
  const text = cellValue(row.cells[column]).replace(/,/g, "").trim();
  const entered = Number(text);
  if (text === "" || !Number.isFinite(entered) || entered < 0) return recalculateRow(row);
  const amounts =
    column === 10
      ? sourceAmountsFromVat(entered, Number(row.dataset.rawNet || 0) + Number(row.dataset.rawVat || 0))
      : column === 8
        ? sourceAmountsFromGross(entered, vatRate(row))
        : sourceAmountsFromNet(entered, vatRate(row));
  if (!amounts) {
    showError("המע״מ לא יכול להיות גבוה מהסכום הכולל.");
    return recalculateRow(row);
  }
  row.dataset.rawNet = amounts.net;
  row.dataset.rawVat = amounts.vat;
  if (column === 10) row.dataset.vatPercent = String(amounts.percent);
  recalculateRow(row);
}
function normalReference(value) {
  return String(value || "")
    .trim()
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toUpperCase();
}
function displayedReference(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? digits.slice(-4) : String(value || "").trim();
}
function addFieldSwapButton(row) {
  const purpose = row.cells[3];
  purpose.querySelector(".field-swap")?.remove();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "field-swap";
  button.contentEditable = "false";
  button.textContent = "⇄";
  button.title = "החלף בין פרטים לספק";
  button.setAttribute("aria-label", button.title);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const details = cellValue(row.cells[3]),
      supplier = cellValue(row.cells[4]);
    row.cells[3].textContent = supplier;
    row.cells[4].textContent = details;
    addFieldSwapButton(row);
    queueDraftSave();
  });
  purpose.append(button);
}
function setExportIncluded(row, included) {
  const checkbox = row.cells[17].querySelector("input");
  checkbox.checked = Boolean(included);
  row.classList.toggle("not-for-export", !checkbox.checked);
}
function updateDuplicateState(row) {
  const reference = normalReference(cellValue(row.cells[6]));
  if (!reference) return;
  const duplicate = [...records.querySelectorAll("tr[data-document-id]")].some(
    (candidate) =>
      candidate !== row &&
      candidate.dataset.documentId !== row.dataset.documentId &&
      normalReference(cellValue(candidate.cells[6])) === reference,
  );
  if (!duplicate) return;
  setExportIncluded(row, false);
  row.dataset.duplicate = "true";
  setStatus(row, "חשד לכפילות לפי אסמכתא — נדרש עיון", "review");
}
function applyBusinessRule(row) {
  const code = row.cells[1].querySelector("select")?.value,
    homeUtility =
      businessKind.value === "home" &&
      isHomeUtility({
        accountName: chartAccounts[code]?.name || rivhitMapping[code],
        texts: [cellValue(row.cells[3]), row.dataset.documentTitle],
      }),
    limitedVat = ["806", "807", "812"].includes(code),
    expense = row.cells[12].querySelector("select"),
    vat = row.cells[11].querySelector("select");
  if (expense) expense.value = homeUtility ? "25" : "100";
  if (vat && Number(row.dataset.rawVat || 0)) vat.value = homeUtility ? "25" : limitedVat ? "66.67" : "100";
  recalculateRow(row);
}
function applyBusinessRules() {
  for (const row of records.querySelectorAll("tr[data-document-id]")) applyBusinessRule(row);
}
businessKind.addEventListener("change", applyBusinessRules);
function updateImageTransform() {
  dialogImage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
}
let imagePopup = null;
let imagePopupKind = "image";
// The name of a stored original ends with its kind (001.pdf, 002.jpg), which is what the browser's guess of the type is built from.
const isPdfRow = (row) => /\.pdf$/i.test(row?.dataset.imageFile || "") || row?.documentImage?.type === "application/pdf";
// The original of a row that is a PDF opens in the viewer of the browser, at the page the agent read the row from.
function openPdf(imageUrl, row) {
  const page = Number(row.dataset.agent ? JSON.parse(row.dataset.agent).page : 0) || 1;
  const url = `${imageUrl}#page=${page}`;
  if (imagePopup && !imagePopup.closed && imagePopupKind === "pdf") imagePopup.location.href = url;
  else {
    if (imagePopup && !imagePopup.closed) imagePopup.close();
    imagePopup = window.open(url, "rivhit-document-image", "popup=yes,width=1000,height=800,resizable=yes");
  }
  if (!imagePopup) return showError("הדפדפן חסם את חלון המסמך. יש לאפשר חלונות קופצים לאתר זה.");
  imagePopupKind = "pdf";
  imagePopup.focus();
}
function openPhoto(imageUrl, imageIndex, row = null) {
  if (!imageUrl) return;
  if (isPdfRow(row)) return openPdf(imageUrl, row);
  if (imagePopup && !imagePopup.closed && imagePopupKind === "pdf") imagePopup.close();
  imagePopupKind = "image";
  if (!imagePopup || imagePopup.closed)
    imagePopup = window.open(
      "",
      "rivhit-document-image",
      "popup=yes,width=1000,height=800,resizable=yes,scrollbars=no",
    );
  if (!imagePopup) return showError("הדפדפן חסם את חלון התמונה. יש לאפשר חלונות קופצים לאתר זה.");
  const doc = imagePopup.document;
  if (!doc.querySelector("#document-image")) {
    doc.title = "תמונת מסמך";
    doc.body.style.cssText = "margin:0;background:#111;color:#fff;font:14px Arial;overflow:hidden";
    const bar = doc.createElement("header"),
      title = doc.createElement("strong"),
      controls = doc.createElement("span"),
      out = doc.createElement("button"),
      plus = doc.createElement("button"),
      image = doc.createElement("img"),
      viewport = doc.createElement("div");
    title.id = "document-title";
    controls.style.cssText = "display:flex;gap:8px";
    bar.style.cssText =
      "height:42px;display:flex;align-items:center;justify-content:space-between;padding:0 10px;background:#34566c";
    viewport.style.cssText = "height:calc(100vh - 42px);position:relative;overflow:hidden;touch-action:none";
    image.id = "document-image";
    image.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;transform-origin:center;cursor:grab;user-select:none";
    out.textContent = "−";
    plus.textContent = "+";
    [out, plus].forEach((button) => {
      button.style.cssText = "padding:2px 10px;font-size:18px";
      controls.append(button);
    });
    bar.append(title, controls);
    viewport.append(image);
    doc.body.append(bar, viewport);
    image.draggable = false;
    let zoomLevel = 1,
      dragging = null,
      panXLocal = 0,
      panYLocal = 0;
    const transform = () => {
      image.style.transform = `translate(${panXLocal}px,${panYLocal}px) scale(${zoomLevel})`;
    };
    plus.onclick = () => {
      zoomLevel = Math.min(4, zoomLevel + 0.25);
      transform();
    };
    out.onclick = () => {
      zoomLevel = Math.max(0.5, zoomLevel - 0.25);
      transform();
    };
    viewport.onpointerdown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragging = { x: event.clientX, y: event.clientY, panX: panXLocal, panY: panYLocal };
      image.style.cursor = "grabbing";
      viewport.setPointerCapture(event.pointerId);
    };
    viewport.onpointermove = (event) => {
      if (!dragging) return;
      panXLocal = dragging.panX + event.clientX - dragging.x;
      panYLocal = dragging.panY + event.clientY - dragging.y;
      transform();
    };
    viewport.onpointerup = viewport.onpointercancel = () => {
      dragging = null;
      image.style.cursor = "grab";
    };
    viewport.onwheel = (event) => {
      event.preventDefault();
      panYLocal -= event.deltaY;
      transform();
    };
    image.ondragstart = (event) => event.preventDefault();
  }
  doc.querySelector("#document-title").textContent = `תמונה #${imageIndex}`;
  doc.querySelector("#document-image").src = imageUrl;
  imagePopup.focus();
}

// Adds the rows of a periodic income report read from its text layer.
async function importIncomeReportFile(file, report = null) {
  if (!currentDeclarationDirectory || currentDeclaration?.status !== "open") throw new Error("יש לבחור הצהרה פתוחה.");
  report ??= await readIncomeReportFile(file);
  if (!report) throw new Error("הקובץ אינו דוח הכנסות תקופתי של חשבונית ירוקה (morning), או שאין בו שכבת טקסט.");
  const rows = buildIncomeRows(report, await ensureIncomeClassification());
  const existing = [...records.querySelectorAll("tr[data-document-id]")].map(rowSnapshot);
  if (rows.some((row) => hasIncomeRow(existing, row))) throw new Error("דוח ההכנסות לתקופה זו כבר נמצא בהצהרה.");
  await saveSourceImage(currentDeclarationDirectory, pdfSourceFileName(new Date(), crypto.randomUUID()), file);
  for (const row of rows) restoreRow(row, null);
  queueDraftSave();
  status.textContent = rows[0].agentOpinion;
  offerDistribution();
}
function chooseIncomeReport() {
  if (!currentDeclarationDirectory || currentDeclaration?.status !== "open") return showError("יש לבחור הצהרה פתוחה.");
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/pdf,.pdf";
  input.addEventListener(
    "change",
    async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        validatePdfFile(file);
        await importIncomeReportFile(file);
      } catch (error) {
        showError(error.message);
      }
    },
    { once: true },
  );
  input.click();
}
importIncomeReportButton.addEventListener("click", chooseIncomeReport);
function addPendingRecord(imageUrl, receivedAt, documentId, imageIndex, insertAfter = null, imageBlob = null) {
  emptyRow?.remove();
  recordCount += 1;
  count.textContent = `שורות ביומן: ${recordCount}`;
  const row = document.createElement("tr");
  row.dataset.documentId = documentId;
  row.dataset.imageIndex = String(imageIndex);
  row.dataset.receivedAt = String(receivedAt);
  row.documentImage = imageBlob;
  row.imageUrl = imageUrl;
  row.append(
    emptyCell(String(recordCount)),
    emptyCell(),
    emptyCell(receivedAtText(receivedAt)),
    emptyCell("ממתין לעיבוד"),
    emptyCell(),
    emptyCell(),
    emptyCell(),
    emptyCell(),
    emptyCell(),
    emptyCell(),
    emptyCell(),
    emptyCell(),
    emptyCell(),
  );
  const photo = document.createElement("td"),
    open = document.createElement("button");
  open.type = "button";
  open.className = "photo-button";
  open.textContent = `תמונה #${imageIndex}`;
  open.addEventListener("click", () => openPhoto(row.imageUrl || imageUrl, imageIndex, row));
  photo.append(open);
  row.append(photo);
  row.append(emptyCell("ממתין ל‑Gemini", "agent-opinion"), emptyCell(), emptyCell("התקבל", "state received"));
  const exportCell = document.createElement("td"),
    include = document.createElement("input");
  include.type = "checkbox";
  include.disabled = true;
  include.addEventListener("change", () => {
    setExportIncluded(row, include.checked);
    queueDraftSave();
  });
  exportCell.append(include);
  row.append(exportCell);
  const deleteCell = document.createElement("td"),
    remove = document.createElement("button");
  remove.type = "button";
  remove.className = "delete";
  remove.textContent = "מחק";
  remove.addEventListener("click", () => {
    row.remove();
    refreshRows();
    queueDraftSave();
  });
  deleteCell.append(remove);
  row.append(deleteCell);
  if (insertAfter?.parentNode === records) records.insertBefore(row, insertAfter.nextSibling);
  else records.append(row);
  refreshRows();
  return row;
}
async function ensureIncomeClassification() {
  const existing = Object.entries(rivhitMapping).find(([, label]) => label === "הכנסות")?.[0];
  if (existing) return existing;
  const code = nextFreeClassificationCode();
  if (!code) throw new Error("לא נותר קוד מיון פנוי להכנסות.");
  customMapping = await saveCustomRivhitMapping(dataRoot, { ...customMapping, [code]: "הכנסות" }, builtInMapping);
  rivhitMapping = currentMapping();
  newCustomCodes.add(code);
  return code;
}
async function applyRecord(row, record) {
  row.dataset.rawNet = String(record.net_amount || 0);
  row.dataset.rawVat = String(record.vat_amount || 0);
  row.dataset.vatPercent = String(record.vat_percent ?? (Number(record.vat_amount) ? 18 : 0));
  row.dataset.documentKind = record.document_kind || "other";
  row.dataset.form6111Code = record.form_6111_code || "";
  row.dataset.fullReference = record.transaction_number || record.invoice_number || "";
  row.dataset.documentTitle = record.document_title || "";
  row.dataset.periodFrom = record.period_from || "";
  row.dataset.periodTo = record.period_to || "";
  row.dataset.autoExclude = "";
  row.dataset.wouldInclude = "";
  row.highlights = Array.isArray(record.highlight_regions) ? record.highlight_regions : [];
  const values = [
    displayDate(record.date),
    null,
    record.purpose,
    record.supplier_name,
    record.supplier_vat_id,
    displayedReference(record.transaction_number || record.invoice_number),
    record.allocation_number,
    null,
    record.net_amount,
    record.vat_amount,
  ];
  row.replaceChild(editableCell(null), row.cells[1]);
  row.replaceChild(editableCell(values[0]), row.cells[2]);
  values.slice(2).forEach((value, index) => row.replaceChild(editableCell(value), row.cells[index + 3]));
  row.replaceChild(amountCell(values[7], "סכום כולל מע״מ"), row.cells[8]);
  row.replaceChild(amountCell(values[8], "סכום ללא מע״מ"), row.cells[9]);
  row.replaceChild(amountCell(values[9], "מע״מ"), row.cells[10]);
  const classification =
    record.document_kind === "income_report" ? await ensureIncomeClassification() : record.rivhit_code || "";
  row.cells[1].replaceChildren(classificationSelect(classification));
  row.cells[11].replaceChildren(percentSelect(record.vat_recognized_percent ?? 100, [100, 66.67, 25, 0], "vat"));
  row.cells[12].replaceChildren(percentSelect(record.recognized_percent || 100, [100, 25, 0], "expense"));
  applyBusinessRule(row);
  addFieldSwapButton(row);
  row.cells[14].textContent = record.agent_opinion;
  row.cells[14].className = "agent-opinion";
  row.cells[15].textContent = String(record.confidence) + "%";
  const include = row.cells[17].querySelector("input");
  include.disabled = false;
  setExportIncluded(row, record.include || record.document_kind === "income_report");
  setStatus(
    row,
    include.checked
      ? row.highlights.length
        ? "מוכן לייצוא"
        : "מוכן, חסרים סימונים"
      : record.document_kind === "payment_confirmation"
        ? "אישור תשלום"
        : "לא מיועד לייצוא",
    include.checked && row.highlights.length ? "ready" : "review",
  );
  updateDuplicateState(row);
  queueDraftSave();
}
function cellValue(cell) {
  return (
    cell.querySelector("select")?.value ??
    cell.querySelector("input")?.value ??
    cell.textContent.replace("⇄", "").trim().replace(/^—$/, "")
  );
}
function rowSnapshot(row) {
  return {
    documentId: row.dataset.documentId || "",
    imageIndex: Number(row.dataset.imageIndex || 0),
    imageFile: row.dataset.imageFile || "",
    receivedAt: row.dataset.receivedAt || new Date().toISOString(),
    values: [
      cellValue(row.cells[2]),
      cellValue(row.cells[1]),
      ...Array.from({ length: 10 }, (_, index) => cellValue(row.cells[index + 3])),
    ],
    rawNet: row.dataset.rawNet || "0",
    rawVat: row.dataset.rawVat || "0",
    vatPercent: row.dataset.vatPercent || "0",
    form6111Code: row.dataset.form6111Code || "",
    documentKind: row.dataset.documentKind || "",
    reference: row.dataset.fullReference || "",
    documentTitle: row.dataset.documentTitle || "",
    periodFrom: row.dataset.periodFrom || "",
    periodTo: row.dataset.periodTo || "",
    autoExclude: row.dataset.autoExclude || "",
    wouldInclude: row.dataset.wouldInclude || "",
    pcnApproved: row.dataset.pcnApproved || "",
    agent: row.dataset.agent ? JSON.parse(row.dataset.agent) : undefined,
    highlights: row.highlights || [],
    active: Boolean(row.cells[17].querySelector("input")?.checked),
    agentOpinion: row.cells[14].textContent.trim(),
    confidence: row.cells[15].textContent.trim(),
    statusText: row.cells[16].childNodes[0]?.textContent?.trim() || row.cells[16].textContent.trim(),
    statusClass: row.cells[16].className.replace(/^state\s*/, ""),
  };
}
function restoreRow(saved, blob) {
  const imageUrl = blob ? URL.createObjectURL(blob) : "",
    row = addPendingRecord(
      imageUrl,
      saved.receivedAt || new Date().toISOString(),
      saved.documentId || "saved",
      saved.imageIndex || 0,
      null,
      blob,
    ),
    values = Array.isArray(saved.values) ? saved.values : [];
  row.dataset.imageFile = saved.imageFile || "";
  if (!blob) row.cells[13].textContent = "—";
  row.dataset.rawNet = String(saved.rawNet || 0);
  row.dataset.rawVat = String(saved.rawVat || 0);
  row.dataset.vatPercent = String(saved.vatPercent ?? (Number(saved.rawVat) ? 18 : 0));
  row.dataset.form6111Code = saved.form6111Code || "";
  for (const [key, field] of [["documentKind", "documentKind"], ["fullReference", "reference"], ["documentTitle", "documentTitle"], ["periodFrom", "periodFrom"], ["periodTo", "periodTo"], ["autoExclude", "autoExclude"], ["wouldInclude", "wouldInclude"], ["pcnApproved", "pcnApproved"]])
    if (saved[field]) row.dataset[key] = saved[field];
  row.highlights = Array.isArray(saved.highlights) ? saved.highlights : [];
  if (saved.agent) row.dataset.agent = JSON.stringify(saved.agent);
  row.replaceChild(editableCell(values[1]), row.cells[1]);
  row.replaceChild(editableCell(displayDate(values[0])), row.cells[2]);
  values.slice(2, 12).forEach((value, index) => row.replaceChild(editableCell(value), row.cells[index + 3]));
  row.replaceChild(amountCell(values[7], "סכום כולל מע״מ"), row.cells[8]);
  row.replaceChild(amountCell(values[8], "סכום ללא מע״מ"), row.cells[9]);
  row.replaceChild(amountCell(values[9], "מע״מ"), row.cells[10]);
  row.cells[6].textContent = displayedReference(values[5]);
  row.cells[1].replaceChildren(classificationSelect(values[1] || ""));
  row.cells[11].replaceChildren(percentSelect(values[10] || 100, [100, 66.67, 25, 0], "vat"));
  row.cells[12].replaceChildren(percentSelect(values[11] || 100, [100, 25, 0], "expense"));
  addFieldSwapButton(row);
  recalculateRow(row);
  row.cells[14].textContent = saved.agentOpinion || "—";
  row.cells[14].className = "agent-opinion";
  row.cells[15].textContent = saved.confidence || "—";
  const include = row.cells[17].querySelector("input");
  include.disabled = false;
  setExportIncluded(row, saved.active);
  // A row of the agent has no marked regions by design: its own status stands.
  const needsMarks = saved.active && !row.highlights.length && !saved.agent;
  setStatus(
    row,
    needsMarks ? "מוכן, חסרים סימונים" : saved.statusText || (saved.active ? "מוכן לייצוא" : "לא מיועד לייצוא"),
    needsMarks ? "review" : saved.statusClass || (saved.active ? "ready" : "review"),
  );
  updateDuplicateState(row);
}
records.addEventListener("input", (event) => {
  const cell = event.target.closest?.("td"),
    row = cell?.parentElement,
    column = row ? [...row.cells].indexOf(cell) : -1;
  if (row?.dataset.documentId && (column === 8 || column === 9 || column === 10)) return;
  if (row?.dataset.documentId && column === 6) updateDuplicateState(row);
  queueDraftSave();
});
records.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.matches(".amount-cell input")) {
    event.preventDefault();
    event.target.blur();
  }
});
records.addEventListener("change", (event) => {
  const row = event.target.closest?.("tr[data-document-id]"),
    cell = event.target.closest?.("td"),
    column = row && cell ? [...row.cells].indexOf(cell) : -1;
  if (row && (column === 8 || column === 9 || column === 10)) manualAmountChanged(row, column);
  if (row && column === 6) updateDuplicateState(row);
  queueDraftSave();
});
closeDeclarationButton.addEventListener("click", async () => {
  if (
    !committedWorkspace ||
    !currentDeclaration ||
    currentDeclaration.status !== "open" ||
    !currentDeclarationDirectory
  )
    return showError("יש לבחור הצהרה פתוחה לפני הסגירה.");
  const allRows = [...records.querySelectorAll("tr[data-document-id]")],
    snapshots = allRows.map((row, index) => ({ ...rowSnapshot(row), tableRow: index + 1 })),
    reportRows = allRows
      .map((row, index) => ({ ...snapshots[index], imageBlob: row.documentImage }))
      .filter((row) => row.active);
  if (!reportRows.length) return showError("יש לסמן לפחות שורה פעילה לפני נעילת ההצהרה.");
  const pcnProblem = pcnJournal?.lockProblem();
  if (pcnProblem) return showError(pcnProblem);
  const closeMessage = "לנעול את ההצהרה? הטבלה תינעל והשורות יצטרפו להיסטוריה. אפשר לפתוח מחדש עם ציון סיבה.";
  if (!(await confirmDialog(closeMessage, { title: "נעילת הצהרה", confirmLabel: "נעילה" }))) return;
  closeDeclarationButton.disabled = true;
  status.textContent = "סוגר הצהרה…";
  try {
    await saveCurrentDraft();
    currentDeclaration = await finalizeDeclaration({
      clientDirectory: committedWorkspace.directory,
      declarationDirectory: currentDeclarationDirectory,
      declaration: currentDeclaration,
      finalExport: NO_EXPORT_MARKER,
      rows: snapshots,
    });
    setTableLocked(true);
    updateStartAvailability();
    status.textContent = "ההצהרה ננעלה. ההיסטוריה עודכנה.";
    backup.runAuto("lock");
  } catch (error) {
    if (error.name !== "AbortError") {
      const message = `לא ניתן לנעול את ההצהרה: ${error.message}`;
      showError(message);
      showExportResult({ title: "הנעילה נכשלה", message, error: true });
    }
    updateStartAvailability();
  }
});
reopenDeclarationButton.addEventListener("click", async () => {
  if (!committedWorkspace || currentDeclaration?.status !== "closed" || !currentDeclarationDirectory) return;
  const dialog = document.querySelector("#reopen-dialog"),
    reason = dialog.querySelector("#reopen-reason"),
    errorLine = dialog.querySelector("#reopen-error");
  reason.value = "";
  errorLine.textContent = "";
  const answer = await dialogResult(dialog, {
    accept: dialog.querySelector("#reopen-confirm"),
    getValue: () => {
      if (!reason.value.trim()) throw new Error("יש להזין סיבה לפתיחה מחדש.");
      return reason.value.trim();
    },
    onInvalid: (error) => {
      errorLine.textContent = error.message;
    },
  });
  if (!answer) return;
  try {
    currentDeclaration = await reopenLockedDeclaration({
      clientDirectory: committedWorkspace.directory,
      declarationDirectory: currentDeclarationDirectory,
      declaration: currentDeclaration,
      reason: answer,
    });
    setTableLocked(false);
    status.textContent = "ההצהרה נפתחה מחדש. אפשר לערוך ולנעול שוב.";
  } catch (error) {
    showError(`לא ניתן לפתוח מחדש את ההצהרה: ${error.message}`);
  }
  updateStartAvailability();
});
openPackage?.addEventListener("click", async () => {
  try {
    const directory = await window.showDirectoryPicker({ mode: "readwrite", startIn: "documents" }),
      manifestFile = await (await directory.getFileHandle("table.json")).getFile(),
      manifest = JSON.parse(await manifestFile.text());
    if (!Array.isArray(manifest.rows) || !manifest.client) throw new Error("קובץ table.json אינו חבילת מסמכים תקינה.");
    if (
      records.querySelector("tr[data-document-id]") &&
      !(await confirmDialog("הטבלה הנוכחית תוחלף בחבילה השמורה. להמשיך?", { confirmLabel: "החלפה" }))
    )
      return;
    const images = await directory.getDirectoryHandle("images"),
      cache = new Map();
    records.replaceChildren();
    recordCount = 0;
      imageCount = Math.max(0, ...manifest.rows.map((row) => Number(row.imageIndex) || 0));
    for (const saved of manifest.rows) {
      const fileName = String(saved.image?.file || "")
        .split("/")
        .pop();
      if (!fileName) throw new Error("באחת השורות חסר קישור לתמונה.");
      if (!cache.has(fileName)) cache.set(fileName, await (await images.getFileHandle(fileName)).getFile());
      restoreRow(saved, cache.get(fileName));
    }
    refreshRows();
    setTableLocked(true);
    status.textContent = `החבילה נטענה: ${directory.name}. הטבלה נעולה עד לבחירת מצב העלאה.`;
  } catch (error) {
    if (error.name !== "AbortError") showError(`לא ניתן לטעון את החבילה: ${error.message}`);
  }
});
saveCustomClassification.addEventListener("click", async () => {
  const code = customClassificationCode.value.trim(),
    label = customClassificationName.value.trim();
  customClassificationError.textContent = "";
  if (!/^\d{3}$/.test(code)) return (customClassificationError.textContent = "יש להזין קוד בן שלוש ספרות.");
  if (!label) return (customClassificationError.textContent = "יש להזין שם לקוד.");
  if (rivhitMapping[code]) return (customClassificationError.textContent = "קוד מיון זה כבר קיים.");
  try {
    saveCustomClassification.disabled = true;
    customMapping = await saveCustomRivhitMapping(dataRoot, { ...customMapping, [code]: label }, builtInMapping);
    rivhitMapping = currentMapping();
    newCustomCodes.add(code);
    const row = pendingClassificationRow;
    refreshClassificationSelectors();
    if (row?.isConnected) {
      const select = row.cells[1].querySelector("select");
      select.value = code;
      select.dataset.lastValue = code;
      await saveClassificationOverride(row, code);
      applyBusinessRule(row);
      queueDraftSave();
    }
    pendingClassificationRow = null;
    customClassificationDialog.close();
  } catch (error) {
    customClassificationError.textContent = "לא ניתן לשמור את קוד המיון: " + error.message;
  } finally {
    saveCustomClassification.disabled = false;
  }
});
customClassificationDialog.addEventListener("close", () => {
  pendingClassificationRow = null;
});
function renderCustomClassificationList() {
  customClassificationList.replaceChildren();
  const entries = Object.entries(customMapping);
  if (!entries.length) {
    customClassificationList.textContent = "אין קודי מיון מותאמים אישית.";
    return;
  }
  for (const [code, label] of entries) {
    const item = document.createElement("div"),
      remove = document.createElement("button"),
      used = [...records.querySelectorAll("tr[data-document-id]")].some((row) => cellValue(row.cells[1]) === code);
    item.className = "custom-classification-item";
    item.append(document.createTextNode(`${code} — ${label}`));
    remove.type = "button";
    remove.className = "delete";
    remove.textContent = "מחיקה";
    remove.disabled = used;
    remove.title = used ? "הקוד נמצא בשימוש בטבלה הנוכחית." : "";
    remove.addEventListener("click", async () => {
      if (!(await confirmDialog(`למחוק את קוד המיון ${code} — ${label}?`, { title: "מחיקת קוד מיון", confirmLabel: "מחיקה" }))) return;
      const next = { ...customMapping };
      delete next[code];
      try {
        customMapping = await saveCustomRivhitMapping(dataRoot, next, builtInMapping);
        rivhitMapping = currentMapping();
        refreshClassificationSelectors();
        renderCustomClassificationList();
      } catch (error) {
        showError("לא ניתן למחוק קוד מיון: " + error.message);
      }
    });
    item.append(remove);
    customClassificationList.append(item);
  }
}
manageClassifications.addEventListener("click", () => {
  if (!dataRoot) return showError("יש לבחור תחילה תיקיית נתונים.");
  renderCustomClassificationList();
  classificationManagementDialog.showModal();
});
document.querySelector("#close-photo").addEventListener("click", () => {
  photoWindow.hidden = true;
});
document.querySelector("#zoom-in").addEventListener("click", () => {
  zoom = Math.min(4, zoom + 0.25);
  updateImageTransform();
});
document.querySelector("#zoom-out").addEventListener("click", () => {
  zoom = Math.max(0.5, zoom - 0.25);
  updateImageTransform();
});
function stopImageDrag() {
  imageDrag = null;
  dialogImage.style.cursor = "grab";
}
photoViewport.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  imageDrag = { x: event.clientX, y: event.clientY, panX, panY };
  dialogImage.style.cursor = "grabbing";
});
window.addEventListener("pointermove", (event) => {
  if (!imageDrag) return;
  panX = imageDrag.panX + event.clientX - imageDrag.x;
  panY = imageDrag.panY + event.clientY - imageDrag.y;
  updateImageTransform();
});
window.addEventListener("pointerup", stopImageDrag);
window.addEventListener("pointercancel", stopImageDrag);
dialogImage.addEventListener("dragstart", (event) => event.preventDefault());
photoViewport.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    panY -= event.deltaY;
    updateImageTransform();
  },
  { passive: false },
);
window.addEventListener(
  "keydown",
  (event) => {
    if (!event.ctrlKey || !["Equal", "NumpadAdd", "Minus", "NumpadSubtract"].includes(event.code) || photoWindow.hidden)
      return;
    event.preventDefault();
    event.stopPropagation();
    zoom = ["Minus", "NumpadSubtract"].includes(event.code) ? Math.max(0.5, zoom - 0.25) : Math.min(4, zoom + 0.25);
    updateImageTransform();
  },
  true,
);
