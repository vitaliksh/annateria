// The run log (docs/AGENT_TOOLS.md, section 2): what the agent was asked, what it called and what came back, so that a wrong
// row can be explained afterwards. Local only; no images and no document text beyond what the tools returned.
const SHORT = 500;

export const shorten = (value) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > SHORT ? `${text.slice(0, SHORT)}…` : text;
};

// header: what the file says about the run besides its entries (the version of the instruction and of each skill).
export function createRunLog({ runId, now, onEvent = () => {}, header = {} }) {
  const entries = [];
  return {
    runId,
    entries,
    add(entry) {
      const stamped = { at: now(), ...entry };
      entries.push(stamped);
      try { onEvent(stamped); } catch { /* a faulty listener must not stop the run */ }
    },
    toJSON: () => ({ runId, ...header, entries }),
  };
}

// common/agent-runs/<runId>.json in the data root.
export async function writeRunLog(dataRoot, log) {
  const directory = await (await dataRoot.getDirectoryHandle("common", { create: true })).getDirectoryHandle("agent-runs", { create: true });
  const writable = await (await directory.getFileHandle(`${log.runId}.json`, { create: true })).createWritable();
  try { await writable.write(JSON.stringify(log, null, 2)); } finally { await writable.close(); }
}
