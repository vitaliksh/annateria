// Journal toolbar: filter menu and the summary bar. Works on the rendered rows only. A row "needs review" when
// its status cell has the review class and it is not left out of the reports and either has a source image or was
// flagged as a possible duplicate (rows imported from Excel have no image and nothing to review). "Excluded" rows are
// unchecked ones; the reports leave them out.
import { summaryItems } from "./journal-summary.js";

export const FILTERS = [
  { key: "all", label: "הכול" },
  { key: "review", label: "לבדיקה" },
  { key: "duplicate", label: "כפילויות" },
  { key: "excluded", label: "מחוץ לדוחות" },
];

export function rowKinds(row) {
  const status = row.cells?.[16];
  const excluded = row.classList.contains("not-for-export");
  const duplicate = row.dataset?.duplicate === "true";
  const flagged = Boolean(status?.classList.contains("review")) && (Boolean(row.dataset?.imageFile) || duplicate);
  return { review: !excluded && flagged, duplicate, excluded };
}

export function matchesFilter(row, filter) {
  return filter === "all" || rowKinds(row)[filter] === true;
}

// menu: <details class="menu"> with a <summary> and a .menu-panel; summary: { element, compute() -> figures from journal-summary.js }
export function setupJournalToolbar({ records, menu, summary }) {
  const doc = records.ownerDocument;
  let filter = "all";
  const dataRows = () => [...records.querySelectorAll("tr[data-document-id]")];

  const panel = menu?.querySelector(".menu-panel");
  const items = FILTERS.map(({ key, label }) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.dataset.filter = key;
    button.setAttribute("role", "menuitemradio");
    button.addEventListener("click", () => { filter = key; refresh(); });
    panel?.append(button);
    return { key, label, button };
  });

  function refresh() {
    const rows = dataRows();
    const counts = Object.fromEntries(FILTERS.map(({ key }) => [key, rows.filter((row) => matchesFilter(row, key)).length]));
    if (filter !== "all" && !counts[filter]) filter = "all";
    for (const { key, label, button } of items) {
      button.textContent = key === "all" ? `${label} · ${rows.length}` : `${label} · ${counts[key]}`;
      button.setAttribute("aria-checked", String(key === filter));
      button.disabled = key !== "all" && counts[key] === 0;
    }
    const summaryLabel = menu?.querySelector("summary");
    if (summaryLabel) {
      summaryLabel.dataset.active = filter === "all" ? "" : FILTERS.find((item) => item.key === filter).label;
    }
    for (const row of rows) row.hidden = !matchesFilter(row, filter);
    if (summary?.element) {
      let parts = [];
      try {
        parts = summaryItems(summary.compute(), { review: counts.review, excluded: counts.excluded });
      } catch {
        // A failing summary must not break filtering.
      }
      summary.element.hidden = parts.length === 0;
      summary.element.replaceChildren(...parts.map((part) => {
        const item = doc.createElement("span");
        item.className = `summary-item${part.tone ? ` ${part.tone}` : ""}`;
        const label = doc.createElement("span");
        label.className = "summary-label";
        label.textContent = part.label;
        const value = doc.createElement("strong");
        value.textContent = part.value;
        item.append(label, value);
        return item;
      }));
    }
  }

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    (globalThis.requestAnimationFrame || ((callback) => setTimeout(callback, 0)))(() => { scheduled = false; refresh(); });
  };
  records.addEventListener("input", schedule);
  records.addEventListener("change", schedule);
  const Observer = doc.defaultView?.MutationObserver;
  if (Observer) new Observer(schedule).observe(records, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "data-duplicate"], characterData: true });
  refresh();
  return { refresh, getFilter: () => filter };
}
