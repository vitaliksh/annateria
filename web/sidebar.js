// Docked sidebar: collapse to an icon rail, drag to resize, remember both. Also opens the settings dialog.

export const SIDEBAR_KEY = "annateria-sidebar-v1";
export const MIN_WIDTH = 220;
export const MAX_WIDTH = 420;
export const DEFAULT_WIDTH = 280;

export function clampSidebarWidth(value) {
  const width = Number(value);
  if (!Number.isFinite(width)) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
}

// The stored text is a per-viewer convenience: anything unreadable falls back to the defaults.
export function readSidebarState(raw) {
  try {
    const value = JSON.parse(raw);
    return { collapsed: value?.collapsed === true, width: clampSidebarWidth(value?.width ?? DEFAULT_WIDTH) };
  } catch {
    return { collapsed: false, width: DEFAULT_WIDTH };
  }
}

export function setupSidebar({ shell, sidebar, toggle, resizer, storage = globalThis.localStorage }) {
  let state = { collapsed: false, width: DEFAULT_WIDTH };
  try { state = readSidebarState(storage?.getItem(SIDEBAR_KEY)); } catch { /* storage blocked */ }

  const apply = () => {
    shell.style.setProperty("--sidebar-w", state.collapsed ? "" : `${state.width}px`);
    shell.dataset.sidebar = state.collapsed ? "collapsed" : "expanded";
    toggle.setAttribute("aria-expanded", String(!state.collapsed));
  };
  const save = () => {
    try { storage?.setItem(SIDEBAR_KEY, JSON.stringify(state)); } catch { /* storage blocked */ }
  };
  const setWidth = (width) => { state = { ...state, width: clampSidebarWidth(width) }; apply(); };

  toggle.addEventListener("click", () => {
    state = { ...state, collapsed: !state.collapsed };
    apply();
    save();
  });

  resizer.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    resizer.setPointerCapture(event.pointerId);
    resizer.classList.add("dragging");
    const rtl = sidebar.ownerDocument.defaultView.getComputedStyle(sidebar).direction === "rtl";
    const move = (moveEvent) => {
      const rect = sidebar.getBoundingClientRect();
      setWidth(rtl ? rect.right - moveEvent.clientX : moveEvent.clientX - rect.left);
    };
    const stop = () => {
      resizer.removeEventListener("pointermove", move);
      resizer.removeEventListener("pointerup", stop);
      resizer.removeEventListener("pointercancel", stop);
      resizer.classList.remove("dragging");
      save();
    };
    resizer.addEventListener("pointermove", move);
    resizer.addEventListener("pointerup", stop);
    resizer.addEventListener("pointercancel", stop);
  });

  // Keyboard: arrows resize by 16 px; in the right-to-left page the left arrow widens the sidebar.
  resizer.addEventListener("keydown", (event) => {
    const widen = sidebar.ownerDocument.defaultView.getComputedStyle(sidebar).direction === "rtl" ? "ArrowLeft" : "ArrowRight";
    const narrow = widen === "ArrowLeft" ? "ArrowRight" : "ArrowLeft";
    if (event.key !== widen && event.key !== narrow) return;
    event.preventDefault();
    setWidth(state.width + (event.key === widen ? 16 : -16));
    save();
  });

  apply();
  return { apply, getState: () => ({ ...state }) };
}

const shell = typeof document === "undefined" ? null : document.querySelector(".app-shell");
if (shell) {
  setupSidebar({ shell, sidebar: shell.querySelector(".sidebar"), toggle: document.querySelector("#open-workspaces-drawer"), resizer: document.querySelector("#sidebar-resizer") });
  document.querySelector("#open-settings")?.addEventListener("click", () => document.querySelector("#settings-dialog").showModal());
}
