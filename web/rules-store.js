// clients/<client>/rules.md: what the user confirmed as a rule of this client (docs/AGENT_TOOLS.md, ask_user "remember"). The agent
// only reads it (services.rules.read). A line is added by the page when the user ticks "זכור ללקוח" and clicks the answer the rule
// belongs to (step 4.6), and the user edits the whole file from the client card; nothing in web/agent/ imports a writer of this file.
import { cleanRule } from "./rule-text.js";

const RULES_FILE = "rules.md";
const CONFIRMED = "אושר ע״י המשתמש";

// "" when the client has no rules yet.
export async function readRules(clientDirectory) {
  try {
    return await (await (await clientDirectory.getFileHandle(RULES_FILE)).getFile()).text();
  } catch (error) {
    if (error.name === "NotFoundError") return "";
    throw error;
  }
}

// The rule of a line of the file: "- <rule> (<date>, <confirmed>)" or a plain "- <rule>" that the user typed.
function ruleOfLine(line) {
  return cleanRule(line.trim().replace(/^[-*]\s*/, "").replace(/\s*\(\d{4}-\d{2}-\d{2},[^)]*\)$/, ""));
}

async function writeText(clientDirectory, name, text) {
  const writable = await (await clientDirectory.getFileHandle(name, { create: true })).createWritable();
  try {
    await writable.write(text);
  } finally {
    await writable.close();
  }
}

// Appends the rule with the date and "confirmed by the user". A rule that is already in the file is not added twice.
// Resolves with { added, line }.
export async function appendRule(clientDirectory, rule, { now = new Date().toISOString() } = {}) {
  const text = cleanRule(rule);
  if (!text) throw new Error("הכלל ריק.");
  const current = await readRules(clientDirectory);
  const line = `- ${text} (${now.slice(0, 10)}, ${CONFIRMED})`;
  if (current.split(/\r?\n/).some((item) => item.trim() && ruleOfLine(item) === text)) return { added: false, line };
  const separator = current && !current.endsWith("\n") ? "\n" : "";
  await writeText(clientDirectory, RULES_FILE, `${current}${separator}${line}\n`);
  return { added: true, line };
}

// The user's own edit of the whole file (the client card). The text before is kept in rules.before-<time>.md first; nothing is
// copied when the file did not exist or was empty. Resolves with { copy } (the name of the copy, or null).
export async function saveRules(clientDirectory, text, { now = new Date().toISOString() } = {}) {
  const current = await readRules(clientDirectory);
  const next = String(text ?? "").replace(/\r\n/g, "\n");
  if (next === current) return { copy: null, changed: false };
  let copy = null;
  if (current.trim()) {
    copy = `rules.before-${now.replace(/[:.]/g, "-")}.md`;
    await writeText(clientDirectory, copy, current);
  }
  await writeText(clientDirectory, RULES_FILE, next && !next.endsWith("\n") ? `${next}\n` : next);
  return { copy, changed: true };
}
