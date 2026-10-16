// Which Gemini model does what. Provisional until the model comparison (phase 3, in the backlog): one line changes a choice.
// The ids must be in ALLOWED_MODELS of worker/src/model.js (ids as listed in docs/HANDOFF.md, "Gemini API facts").
export const MODELS = Object.freeze({
  orchestrator: "gemini-3.8-flash",
  extraction: "gemini-3.8-flash",
  strong: "gemini-4-argon",
});
