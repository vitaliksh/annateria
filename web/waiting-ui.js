// The strip "ממתין לך" under the top bar (docs/UI_REDESIGN_PROPOSAL.md, C6): what waits for the user, outside the assistant's feed
// and on every view, hidden when nothing waits. The page feeds each part from its own source (the panel, the inbox, the journal
// toolbar) through set(); a click calls onGo({ kind, index }) and the page goes there. This file only draws.

const count = (value, one, many) => (value === 1 ? one : `${value} ${many}`);

// Parts: question (open questions of the agent), imports ([{ name }] of import cards not done), inbox (files), review (rows to look
// at in the open month).
export function setupWaiting({ root, onGo = () => {} }) {
  const doc = root.ownerDocument;
  const state = { question: 0, imports: [], inbox: 0, review: 0 };

  const items = () => [
    ...(state.question ? [{ kind: "question", text: "שאלה של העוזר ממתינה לתשובה" }] : []),
    ...state.imports.map((item, index) => ({ kind: "import", index, text: `ייבוא שלא הושלם: ${item.name}` })),
    ...(state.inbox ? [{ kind: "inbox", text: `${count(state.inbox, "קובץ אחד", "קבצים")} בתיבת הקלט` }] : []),
    ...(state.review ? [{ kind: "review", text: `${count(state.review, "שורה אחת", "שורות")} לבדיקה בחודש הפתוח` }] : []),
  ];

  function draw() {
    const shown = items();
    root.hidden = !shown.length;
    const title = doc.createElement("strong");
    title.className = "waiting-title";
    title.textContent = "ממתין לך";
    root.replaceChildren(title, ...shown.map(({ kind, index, text }) => {
      const go = doc.createElement("button");
      go.type = "button";
      go.className = "waiting-item";
      go.dataset.kind = kind;
      // A file name is isolated, so that a Latin name is not turned around by the Hebrew text.
      if (kind === "import") {
        const name = doc.createElement("bdi");
        name.textContent = state.imports[index].name;
        go.append("ייבוא שלא הושלם: ", name);
      } else go.textContent = text;
      go.addEventListener("click", () => onGo({ kind, index }));
      return go;
    }));
  }

  draw();
  return {
    set(part, value) {
      if (!(part in state)) return;
      state[part] = value ?? (part === "imports" ? [] : 0);
      draw();
    },
    items,
  };
}
