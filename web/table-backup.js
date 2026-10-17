// The copy of a table that is made before the agent writes to it (draft-table.before-agent-<time>.json, docs/AGENT_TOOLS.md, 5.3).
import { loadDeclaration } from "./declaration-store.js";

// The table is copied before the agent changes it, like before an import or a move.
export async function backupTable(client, month, now = new Date().toISOString()) {
  const { directory, draft } = await loadDeclaration(client.directory, month);
  const handle = await directory.getFileHandle(`draft-table.before-agent-${now.replace(/[:.]/g, "-")}.json`, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(JSON.stringify(draft, null, 2));
  } finally {
    await writable.close();
  }
}
