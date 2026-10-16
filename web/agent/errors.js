// Errors of the agent tools (docs/AGENT_TOOLS.md, section 3). A tool throws a ToolError; the registry turns it into the
// result envelope { ok: false, error: { code, message } } that goes back to the model. Nothing else escapes a tool.
export const ERROR_CODES = ["not_found", "invalid_argument", "locked", "not_allowed", "conflict", "limit_reached", "cancelled", "unavailable", "internal"];

export class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ToolError";
    this.code = ERROR_CODES.includes(code) ? code : "internal";
  }
}
