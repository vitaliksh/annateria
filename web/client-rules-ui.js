// The rules of a client (clients/<client>/rules.md, step 4.6), opened from the client card: the user reads and edits the whole file.
// The assistant reads it in every run for that client; a line gets in from the assistant only when the user confirmed it on a card.
// Saving keeps the text before in rules.before-<time>.md (rules-store.js).
import { readRules, saveRules } from "./rules-store.js";

export function setupClientRules({ dialog, onError = () => {} }) {
  const part = (id) => dialog.querySelector(`#${id}`);
  const [title, text, status, saveButton] = ["client-rules-title", "client-rules-text", "client-rules-status", "client-rules-save"].map(part);
  let client = null;

  saveButton.addEventListener("click", async () => {
    if (!client) return;
    saveButton.disabled = true;
    try {
      const { copy, changed } = await saveRules(client.directory, text.value);
      status.textContent = !changed ? "אין שינויים לשמירה." : copy ? `נשמר. עותק של הגרסה הקודמת: ${copy}` : "נשמר.";
    } catch (error) {
      status.textContent = `לא ניתן לשמור: ${error.message}`;
    } finally {
      saveButton.disabled = false;
    }
  });
  dialog.addEventListener("close", () => { client = null; });

  return {
    // target: a client of the workspace inside the data root ({ clientName, directory }).
    async open(target) {
      try {
        const current = await readRules(target.directory);
        client = target;
        title.textContent = `כללים של «${target.clientName}»`;
        text.value = current;
        status.textContent = "";
        dialog.showModal();
      } catch (error) {
        onError(`לא ניתן לקרוא את הכללים של הלקוח: ${error.message}`);
      }
    },
  };
}
