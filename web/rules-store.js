// clients/<client>/rules.md: what the user confirmed as a rule of this client (docs/AGENT_TOOLS.md, remember_rule). Step 4.2b
// only reads it; the line that is added after a confirmed question is step 4.6.
const RULES_FILE = "rules.md";

// "" when the client has no rules yet.
export async function readRules(clientDirectory) {
  try {
    return await (await (await clientDirectory.getFileHandle(RULES_FILE)).getFile()).text();
  } catch (error) {
    if (error.name === "NotFoundError") return "";
    throw error;
  }
}
