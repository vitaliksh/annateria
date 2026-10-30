// Clients home and client card: pure view models plus DOM rendering. Rendering uses root.ownerDocument only, so it
// works in the page and in tests. Actions are passed in as handlers; nothing here touches the file system.
import { formatMonth } from "./month-format.js";

export const BUSINESS_KIND_LABELS = { home: "עסק בבית פרטי", office: "עסק במשרד" };
export const REPORT_KINDS = [
  { key: "vat", label: "דוח מס ערך מוסף" },
  { key: "advances", label: "דוח מקדמות" },
  { key: "profitLoss", label: "דוח רווח והפסד" },
  { key: "ledger", label: "כרטסת קודי מיון" },
];
export const VAT_PERIOD_LABELS = { monthly: "חד‑חודשי", bimonthly: "דו‑חודשי" };

const text = (value) => String(value ?? "").trim();

// One row of the clients table.
export function clientSummary(client) {
  const items = (client.declarations || []).filter((item) => !item.declaration.archived);
  const months = items.map((item) => item.declaration.month).sort();
  return {
    id: client.id,
    name: client.clientName,
    activity: text(client.config?.businessActivity),
    open: items.filter((item) => item.declaration.status === "open").length,
    locked: items.filter((item) => item.declaration.status !== "open").length,
    last: months.at(-1) || null,
  };
}

export function filterClients(clients, query) {
  const needle = text(query).toLowerCase();
  if (!needle) return clients;
  return clients.filter((client) => `${client.clientName} ${client.config?.businessActivity ?? ""}`.toLowerCase().includes(needle));
}

// Declarations of a client grouped by year, newest first; archived ones only when asked for.
export function declarationGroups(client, { archived = false } = {}) {
  const items = (client.declarations || []).map((item) => item.declaration).filter((declaration) => Boolean(declaration.archived) === archived);
  const years = new Map();
  for (const declaration of items.sort((a, b) => b.month.localeCompare(a.month))) {
    const year = declaration.month.slice(0, 4);
    if (!years.has(year)) years.set(year, []);
    years.get(year).push(declaration);
  }
  return [...years].map(([year, declarations]) => ({ year, declarations }));
}

export function archivedDeclarationCount(client) {
  return (client.declarations || []).filter((item) => item.declaration.archived).length;
}

function el(root, tag, className, content) {
  const node = root.ownerDocument.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function button(root, label, className, onClick) {
  const node = el(root, "button", className, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

function badge(root, declaration) {
  const node = el(root, "span", "badge", declaration.status === "open" ? "פתוחה" : "נעולה");
  node.dataset.state = declaration.status === "open" ? "open" : "locked";
  return node;
}

// handlers: { onOpen(id), onNew(), onSearch(query), onToggleArchived(), onChooseRoot(), onGrant() }
// review: rows to look at in the open declarations, by client id (review-counts.js); shown in the column "לבדיקה".
export function renderClientsHome(root, { clients, archivedCount, showingArchived, query, hasRoot, needsPermission = false, review = {} }, handlers) {
  root.replaceChildren();
  const head = el(root, "div", "view-head");
  head.append(el(root, "h2", "", showingArchived ? "לקוחות בארכיון" : "לקוחות"));
  const tools = el(root, "div", "view-tools");
  const search = el(root, "input");
  search.type = "search";
  search.id = "clients-search";
  search.placeholder = "חיפוש לקוח";
  search.setAttribute("aria-label", "חיפוש לקוח");
  search.value = query;
  search.addEventListener("input", () => handlers.onSearch(search.value));
  if (hasRoot) tools.append(search);
  if (archivedCount || showingArchived) tools.append(button(root, showingArchived ? "לקוחות פעילים" : `ארכיון (${archivedCount})`, "secondary", handlers.onToggleArchived));
  if (hasRoot) tools.append(button(root, "+ לקוח חדש", "", handlers.onNew));
  head.append(tools);
  root.append(head);

  if (!hasRoot) {
    const empty = el(root, "div", "card empty-state");
    empty.append(el(root, "h3", "", "לא נבחרה תיקיית נתונים"), el(root, "p", "", "התיקייה המקומית מכילה את הלקוחות, ההצהרות והדוחות."), button(root, "בחירת תיקיית נתונים", "", handlers.onChooseRoot));
    root.append(empty);
    return;
  }

  if (needsPermission) {
    const notice = el(root, "div", "card empty-state");
    notice.append(el(root, "h3", "", "נדרש אישור גישה לתיקיית הנתונים"), el(root, "p", "", "הדפדפן ביקש לאשר מחדש את הגישה לתיקייה אחרי הטעינה."), button(root, "אישור גישה", "", handlers.onGrant));
    root.append(notice);
    return;
  }

  const shown = filterClients(clients, query);
  if (!shown.length) {
    const empty = el(root, "div", "card empty-state");
    empty.append(el(root, "h3", "", query ? "לא נמצאו לקוחות" : showingArchived ? "אין לקוחות בארכיון" : "אין לקוחות בתיקייה זו"));
    if (!query && !showingArchived) empty.append(button(root, "+ לקוח חדש", "", handlers.onNew));
    root.append(empty);
    return;
  }

  const table = el(root, "table", "data-table clients-table");
  const headRow = table.createTHead().insertRow();
  for (const label of ["לקוח", "פעילות", "הצהרה אחרונה", "פתוחות", "נעולות", "לבדיקה"]) headRow.append(el(root, "th", "", label));
  const body = table.createTBody();
  for (const client of shown) {
    const summary = clientSummary(client);
    const row = body.insertRow();
    const name = row.insertCell();
    name.append(button(root, summary.name, "link-button", () => handlers.onOpen(summary.id)));
    row.insertCell().textContent = summary.activity || "—";
    row.insertCell().textContent = summary.last ? formatMonth(summary.last) : "—";
    row.insertCell().textContent = String(summary.open);
    row.insertCell().textContent = String(summary.locked);
    const toLook = review[summary.id] ?? 0;
    const cell = row.insertCell();
    cell.textContent = toLook ? String(toLook) : "—";
    if (toLook) cell.className = "review-cell";
    row.addEventListener("dblclick", () => handlers.onOpen(summary.id));
  }
  const card = el(root, "div", "card table-card");
  card.append(table);
  root.append(card);
}

// handlers: { onOpenDeclaration(month), onNewDeclaration(), onEdit(), onToggleArchived(), onArchive(month, archive), onDelete(month), onOpenReport(kind), countRows(month) -> Promise<number> }
export function renderClientCard(root, { client, settings, showingArchived }, handlers) {
  root.replaceChildren();
  const archivedCount = archivedDeclarationCount(client);
  const head = el(root, "div", "view-head");
  head.append(el(root, "h2", "", client.clientName));
  if (client.config?.archived) head.append(el(root, "span", "badge", "בארכיון"));
  const tools = el(root, "div", "view-tools");
  const archivedClient = Boolean(client.config?.archived);
  const newDeclaration = button(root, "+ הצהרה חדשה", "", handlers.onNewDeclaration);
  newDeclaration.disabled = archivedClient;
  tools.append(button(root, "עריכת פרטי לקוח", "secondary", handlers.onEdit), newDeclaration);
  head.append(tools);
  root.append(head);

  const facts = el(root, "div", "card facts");
  const addFact = (label, value) => {
    const item = el(root, "div", "fact");
    item.append(el(root, "span", "fact-label", label), el(root, "span", "fact-value", value || "—"));
    facts.append(item);
  };
  addFact("סוג פעילות", text(client.config?.businessActivity));
  addFact("סוג העסק", BUSINESS_KIND_LABELS[client.config?.businessKind] || "");
  const vatPeriod = client.config?.vatPeriod ?? settings?.vatPeriod;
  addFact("דיווח מע״מ", VAT_PERIOD_LABELS[vatPeriod] || "");
  addFact("דיווח מקדמות", VAT_PERIOD_LABELS[client.config?.advancesPeriod ?? vatPeriod] || "");
  addFact("מספר עוסק מורשה", text(client.config?.vatId));
  addFact("מספר מס הכנסה", text(client.config?.incomeTaxFileId));
  addFact("כתובת העסק", text(client.config?.address));
  addFact("קובץ PCN", client.config?.pcnRequired ? "חובה" : "לא נדרש");
  addFact("אחוז מקדמות", settings?.advancePercent === null || settings?.advancePercent === undefined ? "" : `${settings.advancePercent}%`);
  root.append(facts);

  const reports = el(root, "div", "card");
  reports.append(el(root, "h3", "", "דוחות"));
  const tiles = el(root, "div", "report-tiles");
  for (const { key, label } of REPORT_KINDS) tiles.append(button(root, label, "report-tile secondary", () => handlers.onOpenReport?.(key)));
  reports.append(tiles);
  root.append(reports);

  const section = el(root, "div", "card");
  const sectionHead = el(root, "div", "section-head");
  sectionHead.append(el(root, "h3", "", showingArchived ? "הצהרות בארכיון" : "הצהרות"));
  if (archivedCount || showingArchived) sectionHead.append(button(root, showingArchived ? "הצהרות פעילות" : `ארכיון (${archivedCount})`, "secondary small", handlers.onToggleArchived));
  section.append(sectionHead);
  const groups = declarationGroups(client, { archived: showingArchived });
  if (!groups.length) section.append(el(root, "p", "muted", showingArchived ? "אין הצהרות בארכיון." : "עדיין אין הצהרות ללקוח זה."));
  for (const { year, declarations } of groups) {
    section.append(el(root, "h4", "year-heading", year));
    const list = el(root, "div", "declaration-cards");
    for (const declaration of declarations) {
      const item = el(root, "div", "declaration-item");
      const card = el(root, "button", "declaration-card");
      card.type = "button";
      card.disabled = archivedClient;
      if (archivedClient) card.title = "יש לשחזר לקוח לפני פתיחת הצהרה.";
      card.append(el(root, "strong", "", formatMonth(declaration.month)), badge(root, declaration));
      const rows = el(root, "span", "muted", "…");
      card.append(rows);
      card.addEventListener("click", () => handlers.onOpenDeclaration(declaration.month));
      Promise.resolve(handlers.countRows?.(declaration.month)).then(
        (count) => { rows.textContent = Number.isFinite(count) ? `${count} שורות` : ""; },
        () => { rows.textContent = "—"; },
      );
      item.append(card);
      const actions = el(root, "div", "declaration-actions");
      actions.append(button(root, "ייצוא", "quiet small", () => handlers.onExport?.(declaration.month)), button(root, showingArchived ? "שחזור" : "ארכוב", "quiet small", () => handlers.onArchive?.(declaration.month, !showingArchived)), button(root, "מחיקה", "quiet small danger", () => handlers.onDelete?.(declaration.month)));
      item.append(actions);
      list.append(item);
    }
    section.append(list);
  }
  root.append(section);
}
