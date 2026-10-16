// Which Gemini model does what. The defaults are provisional until the model comparison (phase 3, in the backlog); the user can choose
// another model per role in the settings (kept in common/ui-settings.json as overrides, so a default that changes here reaches
// everyone who never chose). The ids must be in ALLOWED_MODELS of worker/src/model.js (a test compares the two lists).
export const MODELS = Object.freeze({
  orchestrator: "gemini-3.8-flash",
  extraction: "gemini-3.8-flash",
  strong: "gemini-4-argon",
});

export const MODEL_ROLES = Object.freeze(["orchestrator", "extraction", "strong"]);

// What the settings offer: the allow-list of the Worker with a name for a person. Prices change, so none is written here.
export const MODEL_CHOICES = Object.freeze([
  { id: "gemini-3.5-flash-lite", label: "Flash‑Lite 3.5 — הזול והמהיר" },
  { id: "gemini-3.6-flash", label: "Flash 3.6" },
  { id: "gemini-3.8-flash", label: "Flash 3.8" },
  { id: "gemini-3.1-pro-preview", label: "Pro 3.1 (תצוגה מקדימה)" },
  { id: "gemini-4-argon", label: "Argon 4 — הדגל" },
]);

// Keeps only the roles and ids that exist; anything else is dropped (the default applies).
export function normaliseModelOverrides(value) {
  const source = value && typeof value === "object" ? value : {};
  const overrides = {};
  for (const role of MODEL_ROLES) {
    if (MODEL_CHOICES.some((choice) => choice.id === source[role])) overrides[role] = source[role];
  }
  return overrides;
}

// The models in force: the defaults with the user's choices over them.
export const chosenModels = (overrides) => ({ ...MODELS, ...normaliseModelOverrides(overrides) });
