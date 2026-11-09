// In-page replacements for window.confirm / window.prompt: some embedded browsers decline them without showing anything.

// Resolves with getValue() when the accept button is pressed and with null on cancel (button, Esc, x). Acceptance does
// not depend on the dialog's close event, which some embedded browsers never deliver.
export function dialogResult(dialog, { accept, getValue = () => true, onInvalid = () => {} }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      dialog.removeEventListener("close", onClose);
      dialog.removeEventListener("click", onClick);
      resolve(value);
    };
    const onClose = () => finish(null);
    const onClick = (event) => {
      if (event.target.closest?.('button[value="cancel"]')) finish(null);
    };
    accept.onclick = () => {
      let value;
      try {
        value = getValue();
      } catch (error) {
        onInvalid(error);
        return;
      }
      finish(value);
      dialog.close();
    };
    dialog.addEventListener("close", onClose);
    dialog.addEventListener("click", onClick);
    dialog.showModal();
  });
}

export async function confirmDialog(message, { title = "אישור", confirmLabel = "אישור" } = {}) {
  const dialog = document.querySelector("#confirm-dialog");
  if (typeof dialog?.showModal !== "function") return window.confirm(message);
  dialog.querySelector("#confirm-dialog-title").textContent = title;
  dialog.querySelector("#confirm-dialog-message").textContent = message;
  const accept = dialog.querySelector("#confirm-dialog-accept");
  accept.textContent = confirmLabel;
  return (await dialogResult(dialog, { accept })) === true;
}
