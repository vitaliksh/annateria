// The dialog of "צילום חדש" (retake-flow.js): the user picks a new photo of the document of a row, it is read alone, and the values
// read are set beside the row's own; the ticked ones are applied by the page. Nothing changes before the click on "החלה".
import { recordFacts, retakeChanges, rowFacts } from "./retake-flow.js";

// read(file) resolves with the chosen record (agent/fact-record.js) or throws; apply(row, file, record, keys) writes the ticked fields.
export function setupRetake({ document: doc = globalThis.document, read, apply, onError = () => {} }) {
  const dialog = doc.createElement("dialog");
  dialog.id = "retake-dialog";
  dialog.className = "workspace-dialog";
  dialog.setAttribute("aria-labelledby", "retake-title");
  dialog.innerHTML = `<form method="dialog"><header><h2 id="retake-title">צילום חדש</h2><button value="cancel" aria-label="סגור" class="dialog-close">×</button></header>
    <p id="retake-status" role="status"></p><table id="retake-table" class="retake-table" hidden><thead><tr><th>שדה</th><th>עכשיו בשורה</th><th>בצילום החדש</th><th>להחיל</th></tr></thead><tbody></tbody></table>
    <p class="muted">הצילום הקודם נשמר בתיקיית החודש. שדה שלא נקרא בצילום החדש נשאר ריק.</p>
    <div class="dialog-actions"><button type="button" id="retake-apply" disabled>החלה</button><span></span><button type="button" class="secondary" id="retake-cancel">ביטול</button></div></form>`;
  doc.body.append(dialog);
  const input = Object.assign(doc.createElement("input"), { type: "file", accept: ".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf", hidden: true });
  doc.body.append(input);
  const status = dialog.querySelector("#retake-status");
  const table = dialog.querySelector("#retake-table");
  const body = table.querySelector("tbody");
  const applyButton = dialog.querySelector("#retake-apply");
  let state = null;

  const close = () => { state = null; if (dialog.open) dialog.close(); };
  dialog.querySelector(".dialog-close").addEventListener("click", (event) => { event.preventDefault(); close(); });
  dialog.querySelector("#retake-cancel").addEventListener("click", close);

  async function readChosen(file) {
    const row = state.row;
    table.hidden = true;
    applyButton.disabled = true;
    status.textContent = `קורא את הצילום «${file.name}»…`;
    if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
    try {
      const record = await read(file, row);
      if (state?.row !== row) return;
      if (!record) {
        status.textContent = "בצילום החדש לא נמצא מסמך. אפשר לנסות צילום אחר.";
        return;
      }
      const changes = retakeChanges(rowFacts(state.snapshot), recordFacts(record));
      body.replaceChildren(...changes.map((change) => {
        const tr = doc.createElement("tr");
        tr.dataset.key = change.key;
        const box = Object.assign(doc.createElement("input"), { type: "checkbox", checked: change.apply, disabled: change.to === "" || change.to === change.from });
        box.setAttribute("aria-label", `להחיל: ${change.label}`);
        const cells = [change.label, change.from || "—", change.to || "לא נקרא"].map((text) => Object.assign(doc.createElement("td"), { textContent: text }));
        const tick = doc.createElement("td");
        tick.append(box);
        tr.append(...cells, tick);
        return tr;
      }));
      state = { ...state, file, record };
      table.hidden = false;
      applyButton.disabled = false;
      status.textContent = "אלה הערכים שנקראו בצילום החדש. מסמנים מה להחיל ולוחצים «החלה».";
    } catch (error) {
      status.textContent = `לא ניתן לקרוא את הצילום: ${error.message}`;
    }
  }

  input.addEventListener("change", () => {
    const [file] = input.files ?? [];
    input.value = "";
    if (file && state) readChosen(file).catch((error) => onError(error.message));
  });

  applyButton.addEventListener("click", async () => {
    if (!state?.record) return;
    const keys = [...body.querySelectorAll("tr")].filter((tr) => tr.querySelector("input").checked).map((tr) => tr.dataset.key);
    applyButton.disabled = true;
    try {
      await apply(state.row, state.file, state.record, keys);
      close();
    } catch (error) {
      status.textContent = `לא ניתן להחיל: ${error.message}`;
      applyButton.disabled = false;
    }
  });

  return {
    // snapshot: the row in the draft-table format. The file picker opens inside the click; `file` skips it (a drop, the tests).
    open(row, snapshot, file = null) {
      state = { row, snapshot };
      if (file) return readChosen(file);
      input.click();
      return Promise.resolve();
    },
    dialog,
  };
}
