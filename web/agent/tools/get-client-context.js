// get_client_context (docs/AGENT_TOOLS.md, 5.1): what the agent needs to know about one client before it decides.
import { lockedThrough } from "../../month-distribution.js";

const MAX_ACCOUNTS = 400;
const MAX_RULES_BYTES = 8000;

// The newest lines are the ones that are kept when rules.md is longer than the cap.
function capRules(text) {
  if (text.length <= MAX_RULES_BYTES) return { rules: text, rules_truncated: false };
  const kept = [];
  let size = 0;
  for (const line of text.split(/\r?\n/).reverse()) {
    if (size + line.length + 1 > MAX_RULES_BYTES) break;
    kept.unshift(line);
    size += line.length + 1;
  }
  return { rules: kept.join("\n"), rules_truncated: true };
}

export default {
  name: "get_client_context",
  description: "Everything about one client that the decision needs: activity, home or office, PCN duty, VAT number and periods, its declarations with their state, the last locked month, its chart of accounts (the only codes you may use) and its rules.md.",
  schema: {
    type: "object",
    required: ["client"],
    properties: { client: { type: "string", maxLength: 12, description: "Client handle." } },
  },
  async run(args, ctx) {
    const { clientId } = ctx.handles.get("C", args.client);
    const [profile, chart, rules] = await Promise.all([ctx.services.clients.profile(clientId), ctx.services.clients.chart(clientId), ctx.services.rules.read(clientId)]);
    const accounts = Object.entries(chart.accounts).sort(([a], [b]) => a.localeCompare(b)).slice(0, MAX_ACCOUNTS).map(([code, account]) => ({ code, name: account.name, type: account.type }));
    return {
      client: args.client, name: profile.name, activity: profile.activity, kind: profile.kind, pcn_required: profile.pcnRequired,
      vat_id: profile.vatId, vat_period: profile.vatPeriod, advances_period: profile.advancesPeriod,
      locked_through: lockedThrough(profile.declarations), declarations: profile.declarations,
      chart: accounts, chart_source: chart.source, ...capRules(rules),
    };
  },
};
