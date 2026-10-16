// Run-local handles (docs/AGENT_TOOLS.md, section 3): the model sees F1, C1, R1, Q1, P1, never a hash or a document id, so it
// cannot invent one. The table lives for one run.
import { ToolError } from "./errors.js";

export function createHandles() {
  const values = new Map();
  const byKey = new Map();
  const counters = new Map();
  return {
    // The same key always gets the same handle; the stored value is refreshed.
    create(prefix, key, value) {
      const id = `${prefix}|${key}`;
      let handle = byKey.get(id);
      if (!handle) {
        const number = (counters.get(prefix) ?? 0) + 1;
        counters.set(prefix, number);
        handle = `${prefix}${number}`;
        byKey.set(id, handle);
      }
      values.set(handle, value);
      return handle;
    },
    get(prefix, handle) {
      if (typeof handle !== "string" || !new RegExp(`^${prefix}[1-9]\\d*$`).test(handle) || !values.has(handle)) {
        throw new ToolError("not_found", `Unknown handle "${String(handle).slice(0, 20)}".`);
      }
      return values.get(handle);
    },
  };
}
