// ready_to_close (docs/AGENT_TOOLS.md, 5.5, step 6.2): read only; its blockers are the refusals of the lock button, and nothing the
// agent can call locks a month, even when the user asks it to.
import test from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "../agent/run.js";
import { createDefaultRegistry } from "../agent/index.js";
import { call, recordingUi, reply, say, scriptedModel, toolContext, world } from "./agent-fixtures.mjs";
import { listPaths, readFileBytes } from "./memory-binary-directory.mjs";

async function snapshotTree(root) {
  const paths = (await listPaths(root)).sort();
  return Promise.all(paths.map(async (path) => [path, Buffer.from(await readFileBytes(root, path)).toString("base64")]));
}

test("an open month: blockers of the lock button, warnings for rows to review and files in the inbox, counts from the code", async () => {
  const { dispatch, client, w } = await toolContext();
  const before = await snapshotTree(w.root);
  const levi = await dispatch("ready_to_close", { client: await client("Levi Plumbing Ltd"), month: "2026-02" });
  assert.equal(levi.ok, true);
  assert.deepEqual([levi.state, levi.ready, levi.blockers], ["open", true, []]);
  assert.deepEqual(levi.summary, { rows: 3, active: 2, excluded: 1, review: 1, pcn_pending: 0, pcn_missing_allocation: 0, inbox_waiting: 2, inbox_unsorted: 1 });
  assert.deepEqual(levi.warnings.map((item) => [item.code, item.count]), [["rows_to_review", 1], ["inbox_waiting", 2], ["inbox_unsorted", 1]]);
  assert.deepEqual(levi.warnings[0].positions, [2], "the active row marked for review; the excluded duplicate is not a warning");

  const pcn = await dispatch("ready_to_close", { client: await client("Pcn Trading"), month: "2026-02" });
  assert.deepEqual([pcn.ready, pcn.blockers], [false, [{ code: "pcn_blocked", count: 1, positions: [1] }]]);
  assert.deepEqual([pcn.summary.pcn_pending, pcn.summary.pcn_missing_allocation], [1, 1]);
  assert.deepEqual(await snapshotTree(w.root), before, "nothing was written");
});

test("a locked month says so, a missing one is not_found, a bad month is refused", async () => {
  const { dispatch, client } = await toolContext();
  const levi = await client("Levi Plumbing Ltd");
  const locked = await dispatch("ready_to_close", { client: levi, month: "2026-01" });
  assert.deepEqual([locked.state, locked.ready, locked.blockers], ["locked", false, []]);
  assert.equal((await dispatch("ready_to_close", { client: levi, month: "2026-05" })).error.code, "not_found");
  assert.equal((await dispatch("ready_to_close", { client: levi, month: "2026-13" })).error.code, "invalid_argument");
});

test("asked to close a month, the agent can only check it: a tool that would lock does not exist and the month stays open", async () => {
  const w = await world();
  const model = scriptedModel([
    reply(call("find_client", { name: "Pcn Trading" })),
    (request) => {
      const found = request.contents.at(-1).parts[0].functionResponse.response.matches[0].client;
      return reply(call("lock_declaration", { client: found, month: "2026-02" }), call("ready_to_close", { client: found, month: "2026-02" }));
    },
    reply(say("אי אפשר לנעול: שורה 1 ממתינה לאישור.")),
  ]);
  const result = await runAgent({ model, system: "s", registry: createDefaultRegistry(), message: "close February", services: w.services, ui: recordingUi(), sleep: async () => {} });
  assert.equal(result.status, "completed");
  const answers = model.requests[2].contents.at(-1).parts.map((part) => part.functionResponse);
  assert.deepEqual(answers.map((item) => [item.name, item.response.ok]), [["lock_declaration", false], ["ready_to_close", true]]);
  assert.equal(answers[0].response.error.code, "not_allowed");
  assert.equal(await w.services.declarations.state("id-Pcn", "2026-02"), "open");
});
