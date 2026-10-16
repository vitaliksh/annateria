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

// handlers: { onClient(client), onMenu(client), onDeclaration(client, month), onNewDeclaration(client) }
export function renderSidebarClients(root, { clients, archivedMode, activeClientId, activeDeclarationId, expandedClientId }, handlers) {
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
        list.append(choice);
      }
      if (!client.config?.archived) list.append(actionButton(root, "new-declaration", "+ הצהרה חדשה", () => handlers.onNewDeclaration(client)));
      item.append(list);
    }
    root.append(item);
  }
  if (!clients.length) root.append(node(root, "p", "clients-empty", archivedMode ? "אין לקוחות בארכיון." : "אין לקוחות בתיקייה זו."));
}
