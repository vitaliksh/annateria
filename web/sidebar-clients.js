// Client list of the sidebar: one row per client, and under the expanded client its declarations (newest first).
// Pure DOM rendering through root.ownerDocument; the actions are handlers supplied by workspace.js.
import { formatMonth } from "./month-format.js";

function node(root, tag, className, text) {
  const element = root.ownerDocument.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function actionButton(root, className, label, onClick) {
  const button = node(root, "button", className, label);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}

// The badge of what waits (docs/UI_REDESIGN_PROPOSAL.md, F2): the sum of the parts, and each part in the tooltip. Null when nothing waits.
// A part with level "act" (an import closed before it finished) makes the badge red, as in the strip (F4); otherwise amber.
function waitingBadge(root, parts) {
  const shown = parts.filter((part) => part.count > 0);
  if (!shown.length) return null;
  const badge = node(root, "span", "waiting-count", String(shown.reduce((sum, part) => sum + part.count, 0)));
  badge.title = shown.map((part) => `${part.label}: ${part.count}`).join(" · ");
  badge.dataset.level = shown.some((part) => part.level === "act") ? "act" : "look";
  return badge;
}

// handlers: { onClient(client), onMenu(client), onDeclaration(client, month), onNewDeclaration(client) }
// inboxCounts: files waiting in inbox/<client folder>/ by folder name. reviewCounts: rows to look at by "<client id>|<month>"
// (review-counts.js). imports: [{ clientId, state }] of import cards not done. A client shows one badge with all it waits for;
// a month, its rows to look at.
export function renderSidebarClients(root, {
  clients, archivedMode, activeClientId, activeDeclarationId, expandedClientId, inboxCounts = {}, reviewCounts = {}, imports = [],
}, handlers) {
  root.replaceChildren();
  for (const client of clients) {
    const expanded = client.id === expandedClientId;
    const item = node(root, "div", "client-item");
    const row = node(root, "div", "client-row");
    const choose = actionButton(root, "client-choice", "", () => handlers.onClient(client));
    choose.classList.toggle("active-client", client.id === activeClientId);
    choose.setAttribute("aria-expanded", String(expanded));
    choose.title = client.clientName;
    choose.append(node(root, "span", "avatar", [...client.clientName][0] || "?"), node(root, "span", "label", client.clientName));
    let rows = 0;
    for (const [key, count] of Object.entries(reviewCounts)) if (key.startsWith(`${client.id}|`)) rows += count;
    const own = imports.filter((item) => item.clientId === client.id);
    const unfinished = own.filter((item) => item.state === "unfinished").length;
    const badge = waitingBadge(root, [
      { label: "ייבוא שלא הושלם", count: unfinished, level: "act" },
      { label: "ייבוא שממתין", count: own.length - unfinished },
      { label: "קבצים בתיבת הקלט", count: inboxCounts[client.entryName] ?? 0 },
      { label: "שורות לבדיקה", count: rows },
    ]);
    if (badge) choose.append(badge);
    const menu = actionButton(root, "client-overflow", "⋯", () => handlers.onMenu(client));
    menu.setAttribute("aria-label", `פעולות עבור ${client.clientName}`);
    row.append(choose, menu);
    item.append(row);

    if (expanded) {
      const list = node(root, "div", "declaration-list");
      const declarations = (client.declarations || []).map((entry) => entry.declaration).filter((declaration) => !declaration.archived);
      for (const declaration of declarations.sort((a, b) => b.month.localeCompare(a.month))) {
        const choice = actionButton(root, "declaration-choice", "", () => handlers.onDeclaration(client, declaration.month));
        choice.classList.toggle("active-declaration", declaration.declarationId === activeDeclarationId);
        const dot = node(root, "span", "state-dot");
        dot.dataset.state = declaration.status === "open" ? "open" : "locked";
        dot.title = declaration.status === "open" ? "פתוחה" : "נעולה";
        choice.append(node(root, "span", "label", formatMonth(declaration.month)), dot);
        const review = reviewCounts[`${client.id}|${declaration.month}`] ?? 0;
        const mark = waitingBadge(root, [{ label: "שורות לבדיקה", count: review }]);
        if (mark) choice.insertBefore(mark, dot);
        list.append(choice);
      }
      if (!client.config?.archived) list.append(actionButton(root, "new-declaration", "+ הצהרה חדשה", () => handlers.onNewDeclaration(client)));
      item.append(list);
    }
    root.append(item);
  }
  if (!clients.length) root.append(node(root, "p", "clients-empty", archivedMode ? "אין לקוחות בארכיון." : "אין לקוחות בתיקייה זו."));
}
