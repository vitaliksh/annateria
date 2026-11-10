// The login dialog (#access-dialog). ensureLoggedIn() resolves with the user name. The dialog cannot be closed (the owner, 10 November
// 2026: Anna missed it, worked without the code, and got nothing from the other PC); only when the server cannot be reached does it
// offer to work without a connection, and then ensureLoggedIn() resolves with null.
import { createAccess } from "./access.js";

export const ACCESS_MESSAGES = {
  format: "הקוד צריך להכיל 6 תווים: אותיות באנגלית ומספרים.",
  wrong: "הקוד שגוי.",
  unavailable: "הכניסה אינה זמינה כרגע. אפשר לנסות שוב מאוחר יותר.",
  network: "אין חיבור לשרת. יש לבדוק את החיבור לאינטרנט.",
};

export function lockedMessage(retryAfterSeconds) {
  const minutes = Math.max(1, Math.ceil((retryAfterSeconds || 0) / 60));
  return `יותר מדי ניסיונות. אפשר לנסות שוב בעוד ${minutes} דקות.`;
}

export function setupAccess({ dialog, api, access = createAccess({ api }) }) {
  const input = dialog.querySelector("#access-code");
  const error = dialog.querySelector("#access-error");
  const submit = dialog.querySelector("#access-submit");
  const offline = dialog.querySelector("#access-offline");
  let waiters = [];

  function finish(user) {
    const resolving = waiters;
    waiters = [];
    for (const resolve of resolving) resolve(user);
  }

  async function attempt() {
    error.textContent = "";
    submit.disabled = true;
    const result = await access.login(input.value);
    submit.disabled = false;
    if (result.ok) {
      input.value = "";
      finish(result.user);
      dialog.close();
      return;
    }
    error.textContent = result.reason === "locked" ? lockedMessage(result.retryAfterSeconds) : ACCESS_MESSAGES[result.reason];
    if (offline) offline.hidden = !["network", "unavailable"].includes(result.reason);
    input.select();
  }

  submit.addEventListener("click", attempt);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      attempt();
    }
  });
  dialog.addEventListener("close", () => finish(null));
  // Esc does not close it; neither is there a close button.
  dialog.addEventListener("cancel", (event) => event.preventDefault());
  offline?.addEventListener("click", () => dialog.close());

  return {
    access,
    // Opens the dialog unless a valid token is already in memory; there is never more than one dialog open.
    ensureLoggedIn() {
      if (access.isLoggedIn()) return Promise.resolve(access.user());
      return new Promise((resolve) => {
        waiters.push(resolve);
        if (waiters.length > 1) return;
        error.textContent = "";
        input.value = "";
        if (offline) offline.hidden = true;
        dialog.showModal();
        input.focus();
      });
    },
  };
}
