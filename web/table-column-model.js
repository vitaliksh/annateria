// Journal columns: the fixed order of the 19 cells (app.js addresses cells by index, so cells are never removed or
// reordered), which columns the user can hide, the presets and the width arithmetic. Pure; no DOM.

export const COLUMNS = [
  { key: "index", group: "core", locked: true, weight: 3 },
  { key: "code", group: "core", locked: true, weight: 12 },
  { key: "date", group: "core", locked: true, weight: 9 },
  { key: "details", group: "core", locked: true, weight: 12 },
  { key: "supplier", group: "core", locked: true, weight: 11 },
  { key: "supplierId", group: "tax", weight: 7 },
  { key: "reference", group: "tax", weight: 7 },
  { key: "allocation", group: "tax", weight: 7 },
  { key: "gross", group: "core", locked: true, weight: 12 },
  { key: "net", group: "core", locked: true, weight: 12 },
  { key: "vat", group: "core", locked: true, weight: 8 },
  { key: "vatPercent", group: "tax", weight: 8 },
  { key: "expensePercent", group: "tax", weight: 8 },
  { key: "image", group: "service", weight: 9 },
  { key: "agent", group: "ai", weight: 16 },
  { key: "confidence", group: "ai", weight: 7 },
  { key: "status", group: "service", weight: 11 },
  { key: "export", group: "service", weight: 5 },
  { key: "delete", group: "service", weight: 8 },
];

export const GROUP_LABELS = { core: "עיקריות", tax: "מס", ai: "AI", service: "שירות" };

export const PRESET_HIDDEN = {
  minimum: ["supplierId", "allocation", "vatPercent", "expensePercent", "agent", "confidence"],
  full: [],
};

const keys = COLUMNS.map((column) => column.key);
const byKey = new Map(COLUMNS.map((column, index) => [column.key, { ...column, index }]));

export const columnIndex = (key) => byKey.get(key)?.index ?? -1;
export const isLocked = (key) => Boolean(byKey.get(key)?.locked);

// Unknown and locked keys are dropped; the result is unique and in column order.
export function normaliseHidden(list) {
  const wanted = new Set(Array.isArray(list) ? list : []);
  return keys.filter((key) => wanted.has(key) && !isLocked(key));
}

export function toggleHidden(hidden, key) {
  if (isLocked(key) || !byKey.has(key)) return normaliseHidden(hidden);
  const set = new Set(hidden);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  return normaliseHidden([...set]);
}

// Widths in percent of the table, in column order. A hidden column has width 0; the visible columns share 100 %
// by weight (a saved weight overrides the default) and none is narrower than minPercent before normalising.
export function columnPercents(hidden, { weights = {}, minPercent = 2.5 } = {}) {
  const hiddenSet = new Set(hidden);
  const weightOf = (column) => (Number.isFinite(weights[column.key]) && weights[column.key] > 0 ? weights[column.key] : column.weight);
  const visible = COLUMNS.filter((column) => !hiddenSet.has(column.key));
  const total = visible.reduce((sum, column) => sum + weightOf(column), 0);
  const floored = COLUMNS.map((column) => (hiddenSet.has(column.key) ? 0 : Math.max(minPercent, (weightOf(column) / total) * 100)));
  const flooredTotal = floored.reduce((sum, value) => sum + value, 0);
  return floored.map((value) => (value / flooredTotal) * 100);
}

// New weights after a drag. Widths are pixels of the visible columns; they are converted to the unit of the default
// weights so that saved and default weights can be mixed when columns are hidden or shown later.
export function weightsFromWidths(hidden, widths, previous = {}) {
  const hiddenSet = new Set(hidden);
  const visible = COLUMNS.map((column, index) => ({ column, width: widths[index] })).filter(({ column, width }) => !hiddenSet.has(column.key) && Number.isFinite(width) && width > 0);
  const pixels = visible.reduce((sum, { width }) => sum + width, 0);
  if (!pixels) return { ...previous };
  const scale = visible.reduce((sum, { column }) => sum + column.weight, 0) / pixels;
  const result = { ...previous };
  for (const { column, width } of visible) result[column.key] = Math.round(width * scale * 100) / 100;
  return result;
}

// A collapsed column still has cells; without this its zero-width cells would wrap their text letter by letter and
// make every row tall. The generated rules empty the cells without removing them.
export function hiddenCss(hidden, tableSelector) {
  return hidden
    .map((key) => {
      const n = columnIndex(key) + 1;
      return [
        `${tableSelector} th:nth-child(${n}), ${tableSelector} td:nth-child(${n}) { padding: 0; border: 0; overflow: hidden; font-size: 0; line-height: 0; box-shadow: none; }`,
        `${tableSelector} th:nth-child(${n}) > *, ${tableSelector} td:nth-child(${n}) > * { display: none; }`,
      ].join("\n");
    })
    .join("\n");
}
