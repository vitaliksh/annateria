// The login dialog (#access-dialog). ensureLoggedIn() resolves with the user name, or null when the person closes the
// dialog: the journal and the reports work without the Worker, only the assistant needs the code.
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
        dialog.showModal();
        input.focus();
      });
    },
  };
}
