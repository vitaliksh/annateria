// find_client (docs/AGENT_TOOLS.md, 5.1): a client by VAT number, confirmed alias (step 4.6.2) or name, for questions about another
// client. Since step 9.6 it routes nothing: every file of a run is of the client of the run. Registers a handle C<n> for every match.
import { ToolError } from "../errors.js";
import { nameTokens } from "../../intake-facts.js";
import { aliasProves } from "../../client-alias.js";

const digits = (value) => String(value ?? "").replace(/\D/g, "").replace(/^0+/, "");
const ORDER = { vat_id: 0, alias: 1, name_exact: 2, name_partial: 3 };

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
  description: "Find a client by VAT number or by name, to answer a question about a client other than the open one (match: vat_id, alias for a buyer the user once confirmed as that client, name_exact or name_partial). Files are never routed with it: every file of the run is of the open client.",
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
    // A confirmed alias proves the buyer as add_rows checks it: by the number when one is given, otherwise by the exact name.
    const buyer = { vatId: vat, name: args.name ?? "" };
    const aliases = new Map((await ctx.services.clients.aliases()).map((item) => [item.clientId, item.aliases]));
    const aliased = (client) => (aliases.get(client.clientId) ?? []).some((alias) => aliasProves(alias, buyer));
    for (const client of await ctx.services.clients.list()) {
      const match = vat && digits(client.vatId) === vat ? "vat_id" : aliased(client) ? "alias" : args.name ? nameMatch(args.name, client.clientName) : null;
      if (!match) continue;
      const handle = ctx.handles.create("C", client.clientId, { clientId: client.clientId, name: client.clientName, vatId: client.vatId ?? "", folder: client.folder ?? "" });
      matches.push({ client: handle, name: client.clientName, vat_id: client.vatId ?? "", match });
    }
    matches.sort((a, b) => ORDER[a.match] - ORDER[b.match] || a.name.localeCompare(b.name, "he"));
    return { matches: matches.slice(0, 5) };
  },
};
