// The eval (web/eval/, WORK_PLAN step 5.3) without the real model: the cases are well formed, the checks catch a run that did
// nothing, and an agent that decides as the owner would (a script per case) passes every check, so a failure in a real run
// is the model's decision and not a case that the code cannot satisfy.
import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { taxIdProblem } from "../workspace-core.js";
import { answerCard, checkCase, diskSkills, loadCases, runCase } from "../eval/eval-core.mjs";

const webDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const cases = await loadCases(join(webDirectory, "eval", "cases"));
const fetchSkill = diskSkills(webDirectory);
const call = (name, args) => ({ functionCall: { name, args } });
const responsesIn = (contents, name) => contents.flatMap((content) => content.parts).map((part) => part.functionResponse)
  .filter((item) => item?.name === name).map((item) => item.response);
const lastResponses = (request, name) => responsesIn([request.contents.at(-1)], name);

// A model client whose orchestrator follows `steps` (request -> parts). The eval never calls the vision model.
function scriptedClient(steps) {
  let step = 0;
  return {
    generate: async ({ request }) => {
      if (request.generationConfig?.responseMimeType) throw new Error("The eval must not call the vision model.");
      const parts = steps[step](request);
      step += 1;
      return { candidates: [{ content: { parts }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1 } };
    },
  };
}

// What the owner would decide for each case: the client, how it is proven, the decision and the account.
const PLANS = {
  "vat-route": { client: "Levi Plumbing Ltd", routedBy: "vat_id", decision: "expense", account: "202" },
  "folder-route": { client: "Levi Plumbing Ltd", routedBy: "folder", decision: "expense", account: "202" },
  "unknown-buyer": { client: "Cohen Studio", routedBy: "user", decision: "expense", account: "202" },
  duplicate: { client: "Levi Plumbing Ltd", routedBy: "vat_id", decision: "expense", account: "202" },
  "previous-year": { client: "Levi Plumbing Ltd", routedBy: "vat_id", decision: "expense", account: "202" },
  "home-utility": { client: "Cohen Studio", routedBy: "vat_id", decision: "expense", account: "230" },
  "pcn-no-allocation": { client: "Pcn Trading", routedBy: "vat_id", decision: "expense", account: "240" },
  "foreign-currency": { client: "Levi Plumbing Ltd", routedBy: "folder", decision: "expense", account: "215", needsReview: true },
  "private-purchase": { client: "Levi Plumbing Ltd", routedBy: "folder", decision: "not_expense" },
};

function idealSteps(plan) {
  let files = [];
  let client = null;
  let ask = null;
  let added = [];
  return [
    () => [call("list_inbox", {})],
    (request) => {
      files = lastResponses(request, "list_inbox")[0].files.map((item) => item.file);
      return files.map((file) => call("extract_document", { file }));
    },
    () => [call("find_client", { name: plan.client })],
    (request) => {
      client = lastResponses(request, "find_client")[0].matches[0].client;
      return plan.routedBy === "user"
        ? [call("ask_user", { question: "לאיזה לקוח שייך המסמך?",
          choose_client: true, allow_other: false, clients: [client], about: { files } })]
        : [call("list_inbox", { status: "extracted" })];
    },
    (request) => {
      ask = lastResponses(request, "ask_user")[0]?.ask ?? null;
      const facts = responsesIn(request.contents, "extract_document").flatMap((response) => response.documents.map((document) => document.fact));
      const rows = facts.map((fact) => ({
        fact, routed_by: plan.routedBy, ...(ask ? { routing_ask: ask } : {}), decision: plan.decision,
        ...(plan.account ? { account: plan.account } : {}), needs_review: Boolean(plan.needsReview), reason: "לפי הכללים.",
      }));
      return [call("add_rows", { client, rows })];
    },
    (request) => {
      added = lastResponses(request, "add_rows")[0].rows.filter((row) => row.month);
      assert.ok(added.length, JSON.stringify(lastResponses(request, "add_rows")[0]));
      return files.map((file) => call("move_file_to_declaration", { file, client, months: [...new Set(added.map((row) => row.month))] }));
    },
    () => [{ text: "סיימתי." }],
  ];
}

test("every case is well formed: unique names, facts for every file, expected rows among the facts, valid supplier numbers", () => {
  assert.ok(cases.length >= 8);
  assert.equal(new Set(cases.map((item) => item.name)).size, cases.length);
  assert.deepEqual(Object.keys(PLANS).sort(), cases.map((item) => item.name).sort(), "every case has a plan in this test");
  for (const spec of cases) {
    assert.match(spec.today, /^\d{4}-\d{2}-\d{2}$/, spec.name);
    assert.ok(spec.about && spec.expect, spec.name);
    const references = spec.inbox.flatMap((file) => file.records.map((record) => record.document_number));
    for (const file of spec.inbox) assert.ok(file.records.length, `${spec.name}: ${file.name}`);
    const expected = [...(spec.expect.rows ?? []).map((row) => row.reference), ...(spec.expect.inactive ?? []), ...(spec.expect.notReady ?? [])];
    for (const reference of expected) assert.ok(references.includes(reference), `${spec.name}: ${reference}`);
    for (const record of spec.inbox.flatMap((file) => file.records)) {
      if (!record.supplier_vat_id) continue;
      assert.equal(taxIdProblem(record.supplier_vat_id, { checkDigit: true }), "", `${spec.name}: ${record.supplier_vat_id}`);
    }
  }
});

test("the user of a case picks the named client, a button by its text, or dismisses", () => {
  const levi = { id: "client1", label: "Levi Plumbing Ltd" };
  const chooseClient = { options: [levi], more: [levi, { id: "list1", label: "Cohen Studio" }] };
  assert.deepEqual(answerCard(chooseClient, { client: "Cohen Studio" }), { type: "option", id: "list1" });
  assert.deepEqual(answerCard(chooseClient, {}), { type: "dismissed" });
  const month = { options: [{ id: "a", label: "ספטמבר 2026" }, { id: "b", label: "אוקטובר 2026" }] };
  assert.deepEqual(answerCard(month, { labels: ["אוקטובר"] }), { type: "option", id: "b" });
  assert.deepEqual(answerCard(month, { client: "Cohen Studio" }), { type: "dismissed" }, "a client answer is only for the question which client");
});

for (const spec of cases) {
  test(`case ${spec.name}: an agent that decides as the owner would passes every check`, async () => {
    const outcome = await runCase(spec, { modelClient: scriptedClient(idealSteps(PLANS[spec.name])), fetchSkill });
    const failed = checkCase(spec, outcome).filter((item) => !item.ok);
    assert.deepEqual(failed, [], JSON.stringify(outcome.rows));
    assert.deepEqual(outcome.extracted.sort(), spec.inbox.map((file) => file.name).sort(), "every file was read from the facts of the case");
  });
}

test("the checks fail a run that did nothing and a handle in the answer", async () => {
  const spec = cases.find((item) => item.name === "vat-route");
  const outcome = await runCase(spec, { modelClient: scriptedClient([() => [{ text: "הכול טופל (Q1)." }]]), fetchSkill });
  const failed = checkCase(spec, outcome).filter((item) => !item.ok).map((item) => item.name);
  assert.deepEqual(failed, ["no handles in the answer", "row 3101", "filed inv-paper.jpg"]);
});

test("a run that fails is reported with its status", async () => {
  const spec = cases.find((item) => item.name === "vat-route");
  const busy = Object.assign(new Error("busy"), { name: "ModelError", code: "busy" });
  const outcome = await runCase(spec, { modelClient: { generate: async () => { throw busy; } }, fetchSkill });
  const [completed] = checkCase(spec, outcome);
  assert.equal(completed.ok, false);
  assert.match(completed.detail, /^status failed/);
});
