// `services`: the only way for an agent tool to reach data (docs/AGENT_TOOLS.md, sections 1 and 6). It offers reading the
// inbox index, listing clients and their chart, asking whether a declaration is open, and copying a table before the agent
// writes. It has no operation that closes, reopens, deletes or archives anything; a test lists its keys and fails when one
// of those words appears. Tools do not import file stores: they only see what is here.
import { readEffectiveChart } from "../chart-of-accounts.js";
import { backupTable } from "../bookkeeper-flow.js";
import { readInboxIndex } from "../inbox-store.js";

// getDataRoot(): the data root handle (changes when the user picks another). getClients(): the workspace's active clients
// ({ id, clientName, directory, parent, entryName, config, declarations }). reserved(): codes that a chart may not reuse.
export function createServices({ getDataRoot, getClients, reserved = () => ({}) }) {
  const homeClients = () => (getClients() ?? []).filter((client) => client.parent && client.entryName);
  const find = (clientId) => {
    const client = homeClients().find((item) => item.id === clientId);
    if (!client) throw new Error("Unknown client.");
    return client;
  };
  const dataRoot = () => {
    const root = getDataRoot();
    if (!root) throw new Error("No data root.");
    return root;
  };
  return Object.freeze({
    inbox: Object.freeze({
      readIndex: () => readInboxIndex(dataRoot()),
    }),
    clients: Object.freeze({
      list: () => homeClients().map((client) => ({ clientId: client.id, clientName: client.clientName, vatId: client.config?.vatId ?? "" })),
      chart: (clientId) => readEffectiveChart(dataRoot(), find(clientId).directory, clientId, reserved()),
    }),
    declarations: Object.freeze({
      // "open", "locked" or "missing"
      state: async (clientId, month) => {
        const item = find(clientId).declarations?.find((entry) => entry.declaration.month === month);
        return !item ? "missing" : item.declaration.status === "open" ? "open" : "locked";
      },
    }),
    tables: Object.freeze({
      copyBeforeAgent: (clientId, month, now) => backupTable(find(clientId), month, now),
    }),
  });
}
