// Wires the clients home, the client card and the breadcrumb to the workspace controls. One view is visible at a
// time: "clients" (start screen), "client" (card) or "journal" (the open declaration).
import { renderClientCard, renderClientsHome } from "./clients-view.js";
import { readReportSettings } from "./report-data.js";
import { loadDeclaration } from "./declaration-store.js";
import { formatMonth } from "./month-format.js";

export function createClientsHome(doc = document) {
  let report = () => {};
  let openReports = () => {};
  let exportMonth = () => {};
  const homeRoot = doc.querySelector("#clients-view"), cardRoot = doc.querySelector("#client-view"), journalRoot = doc.querySelector("#journal-view"), crumb = doc.querySelector("#breadcrumb"), reportsRoot = doc.querySelector("#reports-view"), navReports = doc.querySelector("#nav-reports");
  let controls = null, view = "clients", clientId = null, journalMonth = null, query = "", showingArchived = false, showingArchivedDeclarations = false, settings = null, settingsToken = 0;

  const findClient = (id) => {
    const all = controls?.getClients();
    return all ? [...all.active, ...all.archived].find((client) => client.id === id) : undefined;
  };

  function renderCrumb() {
    const client = findClient(clientId);
    const items = [{ label: "לקוחות", go: view === "clients" ? null : showHome }];
    if (view !== "clients" && client) items.push({ label: client.clientName, go: view === "journal" ? () => openClient(clientId) : null });
    if (view === "journal" && journalMonth) items.push({ label: formatMonth(journalMonth), go: null });
    if (view === "reports" && client) items[1].go = () => openClient(clientId);
    if (view === "reports") items.push({ label: "דוחות", go: null });
    crumb.replaceChildren();
    items.forEach((item, index) => {
      if (index) crumb.append(Object.assign(doc.createElement("span"), { className: "crumb-sep", textContent: "›", ariaHidden: "true" }));
      const node = doc.createElement(item.go ? "button" : "strong");
      node.textContent = item.label;
      if (item.go) {
        node.type = "button";
        node.className = "crumb-link";
        node.addEventListener("click", item.go);
      } else node.setAttribute("aria-current", "page");
      crumb.append(node);
    });
  }

  function render() {
    doc.body.dataset.view = view;
    homeRoot.hidden = view !== "clients";
    cardRoot.hidden = view !== "client";
    journalRoot.hidden = view !== "journal";
    if (reportsRoot) reportsRoot.hidden = view !== "reports";
    if (navReports) navReports.disabled = !clientId || (controls ? !findClient(clientId) : true);
    if (!controls) return renderCrumb();
    const state = controls.getClients();
    if (view === "clients") {
      renderClientsHome(homeRoot, { clients: showingArchived ? state.archived : state.active, archivedCount: state.archived.length, showingArchived, query, hasRoot: state.hasRoot, needsPermission: state.needsPermission }, {
        onOpen: openClient,
        onNew: openNewClientForm,
        onSearch: (value) => { query = value; render(); doc.querySelector("#clients-search")?.focus(); },
        onToggleArchived: () => { showingArchived = !showingArchived; query = ""; render(); },
        onChooseRoot: () => doc.querySelector("#select-data-root").click(),
        onGrant: () => Promise.resolve(controls.refresh()).catch((error) => report("לא ניתן לרענן את רשימת הלקוחות: " + error.message)),
      });
      const search = doc.querySelector("#clients-search");
      if (search && query) search.setSelectionRange(query.length, query.length);
    }
    if (view === "client") {
      const client = findClient(clientId);
      if (!client) return showHome();
      renderClientCard(cardRoot, { client, settings, showingArchived: showingArchivedDeclarations }, {
        onOpenDeclaration: (month) => controls.openDeclaration(clientId, month),
        onNewDeclaration: () => controls.newDeclaration(clientId),
        onEdit: () => controls.editClient(clientId),
        onToggleArchived: () => { showingArchivedDeclarations = !showingArchivedDeclarations; render(); },
        onOpenReport: (kind) => openReports(clientId, kind),
        onArchive: (month, archive) => Promise.resolve(controls.setDeclarationArchived(clientId, month, archive)).catch((error) => report("לא ניתן לעדכן הצהרה: " + error.message)),
        onExport: (month) => exportMonth(clientId, month),
        onDelete: (month) => Promise.resolve(controls.deleteDeclaration(clientId, month)).catch((error) => report("לא ניתן למחוק הצהרה: " + error.message)),
        countRows: async (month) => (await loadDeclaration(client.directory, month)).draft.rows.length,
      });
    }
    renderCrumb();
  }

  function openNewClientForm() {
    doc.querySelector("#show-new-client").click();
  }

  function showHome() {
    view = "clients";
    render();
  }

  async function openClient(id) {
    clientId = id;
    view = "client";
    showingArchivedDeclarations = false;
    settings = null;
    const token = (settingsToken += 1);
    render();
    const client = findClient(id);
    if (!client) return;
    try {
      const loaded = await readReportSettings(client.directory);
      if (token === settingsToken && view === "client" && clientId === id) { settings = loaded; render(); }
    } catch { /* the card simply shows no reporting settings */ }
  }

  function showReports({ clientId: id }) {
    clientId = id;
    view = "reports";
    render();
  }

  function showJournal({ clientId: id, month }) {
    clientId = id;
    journalMonth = month;
    view = "journal";
    render();
  }

  return {
    bind(workspaceControls, { onError, onOpenReports, onExportMonth } = {}) {
      controls = workspaceControls;
      if (onError) report = onError;
      if (onOpenReports) openReports = onOpenReports;
      if (onExportMonth) exportMonth = onExportMonth;
      navReports?.addEventListener("click", () => openReports(clientId));
      doc.querySelector("#nav-clients")?.addEventListener("click", () => {
        showHome();
        Promise.resolve(controls.refresh()).catch((error) => report("לא ניתן לרענן את רשימת הלקוחות: " + error.message));
      });
      render();
    },
    refresh: () => render(),
    showHome,
    openClient,
    showJournal,
    showReports,
  };
}
