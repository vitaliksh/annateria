// The strip "ממתין לך" under the top bar (docs/UI_REDESIGN_PROPOSAL.md, C6): what waits for the user, outside the assistant's feed
// and on every view, hidden when nothing waits. The page feeds each part from its own source (the panel, the inbox, the journal
// toolbar, the saved tables) through set(); a click calls onGo({ kind, index }) and the page goes there. This file only draws.
// Every chip of rows names its client and its month (owner, after trying C6: "4 rows in the open month" did not say whose).

import { formatMonth } from "./month-format.js";

const count = (value, one, many) => (value === 1 ? one : `${value} ${many}`);
// Chips of rows shown before "+N", which opens the list of all clients and their rows to look at.
export const ROW_CHIPS = 4;
// Colours (F4): "act" (red) only for what was started and not finished, an import wizard closed before it wrote; everything
// else waits to be looked at, "look" (amber).
export const levelOf = (item) => (item.state === "unfinished" ? "act" : "look");

// Parts: question (open questions of the agent), imports ([{ name, client }] of import cards not done), inbox (files), rows
// ([{ clientId, client, month, count }] of rows to look at, one per client and month, in the order to show).
export function setupWaiting({ root, onGo = () => {} }) {
  const doc = root.ownerDocument;
  const state = { question: 0, imports: [], inbox: 0, rows: [] };

  // Each item: { kind, index, parts }; a part is a text or { name } (a name of a client or a file, isolated when drawn).
  const items = () => [
    ...(state.question ? [{ kind: "question", parts: ["שאלה של העוזר ממתינה לתשובה"] }] : []),
    ...state.imports.map((item, index) => {
      const client = item.client ? [{ name: item.client }, " · "] : [];
      return { kind: "import", index, level: levelOf(item), parts: [...client, "ייבוא שלא הושלם: ", { name: item.name }] };
    }),
    ...(state.inbox ? [{ kind: "inbox", parts: [`${count(state.inbox, "קובץ אחד", "קבצים")} בתיבת הקלט`] }] : []),
    ...state.rows.slice(0, ROW_CHIPS).map((item, index) => {
      const rows = `${count(item.count, "שורה אחת", "שורות")} לבדיקה`;
      return { kind: "rows", index, parts: [{ name: item.client }, ` · ${formatMonth(item.month)}: ${rows}`] };
    }),
    ...(state.rows.length > ROW_CHIPS ? [{ kind: "more", parts: [`+${state.rows.length - ROW_CHIPS}`] }] : []),
  ];

  function draw() {
    const shown = items();
    root.hidden = !shown.length;
    const title = doc.createElement("strong");
    title.className = "waiting-title";
    title.textContent = "ממתין לך";
    root.replaceChildren(title, ...shown.map(({ kind, index, parts, level = "look" }) => {
      const go = doc.createElement("button");
      go.type = "button";
      go.className = "waiting-item";
      go.dataset.kind = kind;
      go.dataset.level = level;
      // A name is isolated, so that a Latin name is not turned around by the Hebrew text.
      const isolated = (name) => Object.assign(doc.createElement("bdi"), { textContent: name });
      go.append(...parts.map((part) => (typeof part === "string" ? part : isolated(part.name))));
      if (kind === "more") go.title = "כל הלקוחות והשורות לבדיקה";
      go.addEventListener("click", () => onGo({ kind, index }));
      return go;
    }));
  }

  draw();
  return {
    set(part, value) {
      if (!(part in state)) return;
      state[part] = value ?? (Array.isArray(state[part]) ? [] : 0);
      draw();
    },
    items,
  };
}
