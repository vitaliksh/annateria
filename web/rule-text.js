// The text of a rule of a client (rules.md): one line, no control characters, single spaces. ask_user shows the rule cleaned this way
// and rules-store.js writes it cleaned the same way, so the file holds exactly what the card showed. Pure: imports nothing.
export function cleanRule(text) {
  return String(text ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}
