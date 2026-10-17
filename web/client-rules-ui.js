// The rules of a client (clients/<client>/rules.md, step 4.6), opened from the client card: the user reads and edits the whole file.
// The assistant reads it in every run for that client; a line gets in from the assistant only when the user confirmed it on a card.
// Saving keeps the text before in rules.before-<time>.md (rules-store.js). Below it, the buyers confirmed as this client
// (aliases.json, step 4.6.2), each with a button that removes it (marked removed in the file, not erased).
import { readRules, saveRules } from "./rules-store.js";
import { readAliases, removeAlias } from "./aliases-store.js";
import { formatMonth } from "./month-format.js";

export function setupClientRules({ dialog, onError = () => {} }) {
  const part = (id) => dialog.querySelector(`#${id}`);
  const [title, text, status, saveButton, aliasList] = ["client-rules-title", "client-rules-text", "client-rules-status", "client-rules-save", "client-aliases-list"].map(part);
  const doc = dialog.ownerDocument;
  let client = null;

  const item = (content, className = "") => Object.assign(doc.createElement("li"), { className, textContent: content });
  async function showAliases() {
    const { aliases, damaged } = await readAliases(client.directory);
    aliasList.replaceChildren();
    if (damaged) aliasList.append(item("הקובץ aliases.json של הלקוח פגום; הקונים שבו אינם נחשבים.", "muted"));
    else if (!aliases.length) aliasList.append(item("אין עדיין.", "muted"));
    for (const alias of aliases) {
      const added = /^\d{4}-\d{2}-\d{2}/.test(alias.addedAt) ? ` · נוסף ${alias.addedAt.slice(8, 10)}/${formatMonth(alias.addedAt.slice(0, 7))}` : "";
      const line = item([alias.name ? `«${alias.name}»` : "", alias.vatId ? `מס׳ ${alias.vatId}` : ""].filter(Boolean).join(" · ") + added);
      const remove = Object.assign(doc.createElement("button"), { type: "button", className: "link small", textContent: "הסר" });
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try {
          await removeAlias(client.directory, alias.index);
          await showAliases();
        } catch (error) {
          status.textContent = `לא ניתן להסיר: ${error.message}`;
          remove.disabled = false;
        }
      });
      line.append(" ", remove);
      aliasList.append(line);
    }
  }

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
        await showAliases();
        dialog.showModal();
      } catch (error) {
        onError(`לא ניתן לקרוא את הכללים של הלקוח: ${error.message}`);
      }
    },
  };
}
