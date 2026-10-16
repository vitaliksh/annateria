// Small behaviours shared by the whole page: Enter runs the primary action of a dialog, a dialog gets sensible focus
// when it opens, icon buttons get tooltips, and "open this menu" buttons (data-open-menu) work.

const FIELD = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([disabled]), select:not([disabled]), textarea:not([disabled])";

const defaultVisible = (element) => !element.closest("[hidden]") && element.getClientRects().length > 0;

// A wizard marks its step buttons with data-for="step step"; they count only for the current step.
function shownForStep(button, dialog) {
  const steps = button.dataset.for;
  return !steps || steps.split(" ").includes(dialog.dataset.step);
}

// The button Enter should press: the first enabled, shown footer button that is not a plain cancel or a secondary one.
export function primaryAction(dialog, visible = defaultVisible) {
  const buttons = [...dialog.querySelectorAll(".dialog-actions button")].filter((button) => !button.disabled && shownForStep(button, dialog) && visible(button));
  return buttons.find((button) => button.value !== "cancel" && !button.classList.contains("secondary")) ?? buttons.find((button) => button.value === "cancel" && !button.classList.contains("secondary")) ?? null;
}

export function firstField(dialog, visible = defaultVisible) {
  return [...dialog.querySelectorAll(FIELD)].find((field) => visible(field)) ?? null;
}

export function setupDialogs(doc, { visible = defaultVisible } = {}) {
  const View = doc.defaultView;
  const prepared = new WeakSet();
  const prepare = (dialog) => {
    if (prepared.has(dialog)) return;
    prepared.add(dialog);
    // Without this, Enter in a field would "submit" the form through its first button, which is the close icon.
    dialog.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing || event.defaultPrevented) return;
      const target = event.target;
      if (!target?.matches?.("input:not([type=checkbox]):not([type=radio]):not([type=file]), select")) return;
      event.preventDefault();
      primaryAction(dialog, visible)?.click();
    });
    new View.MutationObserver(() => {
      if (!dialog.open) return;
      View.setTimeout(() => (firstField(dialog, visible) ?? primaryAction(dialog, visible))?.focus(), 0);
    }).observe(dialog, { attributes: true, attributeFilter: ["open"] });
  };
  doc.querySelectorAll("dialog.workspace-dialog").forEach(prepare);
}

// Every icon-only button names itself through aria-label; show the same text as a tooltip. Navigation items keep their
// label as a tooltip too, because the collapsed sidebar hides the text.
export function addTitles(root) {
  root.querySelectorAll("button[aria-label]:not([title])").forEach((button) => { button.title = button.getAttribute("aria-label"); });
  root.querySelectorAll(".nav-item:not([title])").forEach((item) => {
    const label = item.querySelector(".label")?.textContent.trim();
    if (label) item.title = label;
  });
}

export function setupTitles(doc) {
  addTitles(doc);
  new doc.defaultView.MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) addTitles(node.parentNode ?? doc);
  }).observe(doc.body, { childList: true, subtree: true });
}

// <button data-open-menu="menu-id"> opens that <details class="menu">.
export function setupMenuOpeners(doc) {
  doc.addEventListener("click", (event) => {
    const opener = event.target.closest?.("[data-open-menu]");
    if (!opener) return;
    const menu = doc.getElementById(opener.dataset.openMenu);
    if (menu) menu.open = true;
  });
}

if (typeof document !== "undefined") {
  setupDialogs(document);
  setupTitles(document);
  setupMenuOpeners(document);
}
