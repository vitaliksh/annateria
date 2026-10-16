// The AI model choice in the settings dialog: one select per role (the assistant, reading documents, a second reading of a hard
// document). The choice is kept in the data root (ui-settings.json) as an override of the default; choosing the default again
// removes the override, so a default that changes later reaches whoever never deviated.
import { MODEL_CHOICES, MODEL_ROLES, MODELS, chosenModels, normaliseModelOverrides } from "./agent/models.js";
import { saveUiSettings } from "./ui-settings.js";

// container: the element that holds #model-orchestrator, #model-extraction and #model-strong. getDataRoot(): the current data root
// or null. onChange(models) hears the models in force after a choice. save(dataRoot, changes) is saveUiSettings, replaceable in tests.
export function setupModelSettings({ container, getDataRoot, onChange = () => {}, onError = () => {}, save = saveUiSettings }) {
  const doc = container.ownerDocument;
  const selects = Object.fromEntries(MODEL_ROLES.map((role) => [role, container.querySelector(`#model-${role}`)]));
  let overrides = {};

  for (const role of MODEL_ROLES) {
    selects[role].replaceChildren(...MODEL_CHOICES.map((choice) => Object.assign(doc.createElement("option"), {
      value: choice.id,
      textContent: `${choice.label} · ${choice.id}${choice.id === MODELS[role] ? " (ברירת מחדל)" : ""}`,
    })));
  }

  function render() {
    const models = chosenModels(overrides);
    for (const role of MODEL_ROLES) {
      selects[role].value = models[role];
      selects[role].disabled = !getDataRoot();
    }
  }

  for (const role of MODEL_ROLES) {
    selects[role].addEventListener("change", async () => {
      const root = getDataRoot();
      if (!root) return render();
      const next = { ...overrides, [role]: selects[role].value };
      if (next[role] === MODELS[role]) delete next[role];
      try {
        overrides = (await save(root, { models: next })).models;
        onChange(chosenModels(overrides));
      } catch (error) {
        onError(`לא ניתן לשמור את בחירת המודל: ${error.message}`);
      }
      render();
    });
  }

  render();
  return {
    // The choices found in the data root when it is opened.
    setOverrides(value) { overrides = normaliseModelOverrides(value); render(); },
    getModels: () => chosenModels(overrides),
    refresh: render,
  };
}
