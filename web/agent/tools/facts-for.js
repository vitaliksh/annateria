// facts_for (docs/AGENT_TOOLS.md, 5.1): everything the code knows about one fact in the context of one client. This is the only
// place where the rules of the bookkeeper are computed: the month, the year gate, duplicates, the VAT deduction window, the
// ceiling for an allocation number, the 25% of a home. The model never supplies a number here. The computation is in agent/facts.js.
import { computeFacts } from "../facts.js";

export default {
  name: "facts_for",
  description: "What the code knows about one extracted fact for one client: the month it belongs to, the year check, duplicates among all declarations and this run, the VAT deduction window, the allocation-number ceiling for PCN clients, the 25% rule for home clients, whether it is addressed to this client, and the reasons a row would need a look. Give month only when the user asked for a month.",
  schema: {
    type: "object",
    required: ["fact", "client"],
    properties: {
      fact: { type: "string", maxLength: 12, description: "Fact handle, for example F1.1." },
      client: { type: "string", maxLength: 12, description: "Client handle." },
      month: { type: "string", maxLength: 7, description: "YYYY-MM, only when the user asked for this month." },
    },
  },
  async run(args, ctx) {
    return (await computeFacts(ctx, args)).output;
  },
};
