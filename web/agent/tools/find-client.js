// find_client (docs/AGENT_TOOLS.md, 5.1): which client a document is for. Only a VAT number is evidence for routing; a name
// match must be confirmed by the user. Registers a handle C<n> for every match.
import { ToolError } from "../errors.js";
import { nameTokens } from "../../intake-facts.js";

const digits = (value) => String(value ?? "").replace(/\D/g, "").replace(/^0+/, "");
const ORDER = { vat_id: 0, name_exact: 1, name_partial: 2 };

function nameMatch(query, name) {
  const wanted = nameTokens(query), actual = nameTokens(name);
  if (!wanted.length || !actual.length) return null;
  if (wanted.join(" ") === actual.join(" ")) return "name_exact";
  const shared = wanted.filter((token) => token.length >= 3 && actual.includes(token));
  const contained = wanted.every((token) => actual.includes(token)) || actual.every((token) => wanted.includes(token));
  return shared.length && contained ? "name_partial" : null;
}

export default {
  name: "find_client",
  description: "Find the client a document is for by the buyer's VAT number or by name. Only a VAT number match (match: vat_id) is evidence; a name match must be confirmed with the user.",
  schema: {
    type: "object",
    properties: {
      vat_id: { type: "string", maxLength: 20 },
      name: { type: "string", maxLength: 120 },
    },
  },
  async run(args, ctx) {
    if (!args.vat_id && !args.name) throw new ToolError("invalid_argument", "Give vat_id or name.");
    const vat = digits(args.vat_id);
    const matches = [];
    for (const client of await ctx.services.clients.list()) {
      const match = vat && digits(client.vatId) === vat ? "vat_id" : args.name ? nameMatch(args.name, client.clientName) : null;
      if (!match) continue;
      const handle = ctx.handles.create("C", client.clientId, { clientId: client.clientId, name: client.clientName, vatId: client.vatId ?? "" });
      matches.push({ client: handle, name: client.clientName, vat_id: client.vatId ?? "", match });
    }
    matches.sort((a, b) => ORDER[a.match] - ORDER[b.match] || a.name.localeCompare(b.name, "he"));
    return { matches: matches.slice(0, 5) };
  },
};
