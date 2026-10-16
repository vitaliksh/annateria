// The closed registry of agent tools and the dispatcher (docs/AGENT_TOOLS.md, sections 1, 3 and 6). A name that is not in the
// list gets `not_allowed`; arguments are validated against the declared schema before a tool runs; a tool never throws into
// the loop: every outcome is a result envelope.
import { ToolError } from "./errors.js";
import { LIMITS } from "./limits.js";
import { toGeminiSchema, validate } from "./schema.js";

// tool: { name, description, schema, exclusive?, run(args, ctx) -> data object }. `exclusive` tools (they wait for the
// user) run one at a time, in the order the model called them.
export function createRegistry(tools, { resultBytes = LIMITS.resultBytes } = {}) {
  const byName = new Map();
  for (const tool of tools) {
    if (byName.has(tool.name)) throw new Error(`Tool "${tool.name}" is registered twice.`);
    byName.set(tool.name, Object.freeze({ ...tool }));
  }
  const failure = (code, message) => ({ ok: false, error: { code, message } });

  return Object.freeze({
    names: () => [...byName.keys()].sort(),
    isExclusive: (name) => Boolean(byName.get(name)?.exclusive),
    declarations: () => [...byName.values()].map((tool) => ({ name: tool.name, description: tool.description, parameters: toGeminiSchema(tool.schema) })),
    async dispatch(call, ctx) {
      const tool = byName.get(call?.name);
      if (!tool) return failure("not_allowed", `There is no tool "${String(call?.name).slice(0, 40)}". Use only the tools you were given.`);
      const checked = validate(tool.schema, call.args ?? {});
      if (!checked.ok) return failure("invalid_argument", checked.message);
      try {
        const data = await tool.run(checked.value, ctx);
        const envelope = { ok: true, ...data };
        if (JSON.stringify(envelope).length > resultBytes) return failure("internal", "The result is too large; ask for a smaller page.");
        return envelope;
      } catch (error) {
        if (error instanceof ToolError) return failure(error.code, error.message);
        return failure("internal", "The tool failed.");
      }
    },
  });
}
