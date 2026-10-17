// find_client (docs/AGENT_TOOLS.md, 5.1): which client a document is for. Only a VAT number, or an alias the user confirmed (step 4.6.2),
// is evidence for routing; a name match must be confirmed by the user. Registers a handle C<n> for every match.
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
  description: "Find the client a document is for by the buyer's VAT number or by name. A VAT number match (match: vat_id) is evidence, and so is match: alias, a buyer the user once confirmed as that client (give the buyer's VAT number when the document prints one, otherwise the buyer's name; then routed_by is alias). A name match must be confirmed with the user.",
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
      const best = ctx.run.clientMatches?.get(client.clientId);
      if (!best || ORDER[match] < ORDER[best]) ctx.run.clientMatches?.set(client.clientId, match);
    }
    matches.sort((a, b) => ORDER[a.match] - ORDER[b.match] || a.name.localeCompare(b.name, "he"));
    return { matches: matches.slice(0, 5) };
  },
};
