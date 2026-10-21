// ready_to_close (docs/AGENT_TOOLS.md, 5.5): can this month be locked, and what is in the way. Read only. The blockers are those of
// the lock button itself (lock-check.js, one function for both), so the agent's answer never disagrees with the button; the
// warnings are what the bookkeeper may want to look at first. Locking stays the button of the journal and its confirmation.
import { ToolError } from "../errors.js";
import { lockProblems } from "../../lock-check.js";
import { pcnReview } from "../../pcn-review.js";

export default {
  name: "ready_to_close",
  description: "Check whether the declaration of one month of a client can be locked, and what is in the way: the blockers are exactly the refusals of the lock button (no active row; rows above the allocation ceiling of a PCN client that are not approved or have no allocation number), the warnings are rows still marked for review and files of this client still in the inbox. Read only: you cannot lock a month; the user locks it with the button \"נעילת הצהרה\" in the menu ⋯ of the journal.",
  schema: {
    type: "object",
    required: ["client", "month"],
    properties: {
      client: { type: "string", maxLength: 12, description: "Client handle." },
      month: { type: "string", maxLength: 7, description: "YYYY-MM." },
    },
  },
  async run(args, ctx) {
    const client = ctx.handles.get("C", args.client);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.month)) throw new ToolError("invalid_argument", "month must look like 2026-03.");
    const state = await ctx.services.declarations.state(client.clientId, args.month);
    if (state === "missing") throw new ToolError("not_found", `There is no declaration ${args.month}.`);
    if (state === "locked") return { month: args.month, state: "locked", ready: false, blockers: [], warnings: [], note: "This month is already locked." };

    const profile = await ctx.services.clients.profile(client.clientId);
    const [{ rows }] = await ctx.services.rows.list(client.clientId, args.month);
    const reviews = pcnReview(rows, { pcnRequired: profile.pcnRequired });
    const positions = (test) => rows.map((row, index) => (test(row, reviews[index]) ? index + 1 : 0)).filter(Boolean);
    const blockers = lockProblems(rows, { pcnRequired: profile.pcnRequired }).map(({ code, count }) => (
      code === "pcn_blocked" ? { code, count, positions: positions((_, review) => review.blocked).slice(0, 50) } : { code, count }
    ));

    const review = positions((row) => row.active !== false && row.statusClass === "review");
    const inbox = (await ctx.services.inbox.readIndex()).files;
    const waiting = inbox.filter((entry) => entry.folder === client.folder).length;
    const unsorted = inbox.filter((entry) => entry.folder === "_unsorted").length;
    const warnings = [
      ...(review.length ? [{ code: "rows_to_review", count: review.length, positions: review.slice(0, 50) }] : []),
      ...(waiting ? [{ code: "inbox_waiting", count: waiting }] : []),
      ...(unsorted ? [{ code: "inbox_unsorted", count: unsorted }] : []),
    ];
    const summary = {
      rows: rows.length, active: rows.filter((row) => row.active !== false).length, excluded: rows.filter((row) => row.active === false).length,
      review: review.length, pcn_pending: reviews.filter((item) => item.pending).length,
      pcn_missing_allocation: reviews.filter((item) => item.missingAllocation).length, inbox_waiting: waiting, inbox_unsorted: unsorted,
    };
    return { month: args.month, state: "open", ready: !blockers.length, blockers, warnings, summary };
  },
};
