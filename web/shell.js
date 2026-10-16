// Shell behaviour that app.js does not own: floating menus and the kind (info / error) of the status line.

const menus = [...document.querySelectorAll("details.menu")];

function closeMenus(except = null) {
  for (const menu of menus) if (menu !== except) menu.open = false;
}

for (const menu of menus) {
  menu.addEventListener("toggle", () => {
    if (menu.open) closeMenus(menu);
  });
}

document.addEventListener("click", (event) => {
  if (event.target.closest?.("[data-open-menu]")) return;
  const inside = event.target.closest?.("details.menu");
  if (!inside) return closeMenus();
  if (event.target.closest(".menu-panel button")) inside.open = false;
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenus();
});

// app.js sets #status.textContent in many places; showError marks its message through data-next-kind.
const statusLine = document.querySelector("#status");
if (statusLine) {
  new MutationObserver(() => {
    statusLine.dataset.kind = statusLine.dataset.nextKind || "info";
    delete statusLine.dataset.nextKind;
  }).observe(statusLine, { childList: true, characterData: true, subtree: true });
}
