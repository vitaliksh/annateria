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

// What the owner would decide for each case: the decision and the account. The client is the open one (step 9.6): the first line of
// the run names its handle, C1.
const PLANS = {
  "other-buyer": { decision: "expense", account: "202" },
  "folder-route": { decision: "expense", account: "202" },
  "doc-after-month": { decision: "expense", account: "202" },
  duplicate: { decision: "expense", account: "202" },
  "previous-year": { decision: "expense", account: "202" },
  "home-utility": { decision: "expense", account: "230" },
  "pcn-no-allocation": { decision: "expense", account: "240" },
  "foreign-currency": { decision: "expense", account: "215", needsReview: true },
  "private-purchase": { decision: "not_expense" },
  "insurance-letter": { decision: "expense", account: "206" },
  "vehicle-insurance": { decision: "expense", account: "214" },
  "tax-payment": { decision: "not_expense", needsReview: true },
  "internet-maintenance": { decision: "expense", account: "220" },
  "licence-fee": { decision: "expense", account: "214" },
  "parking-fine": { decision: "not_expense" },
  "close-month": { closing: "2026-09" },
};
const OPEN_CLIENT = "C1";

// Asked to close a month: check the month, answer. There is no tool that locks.
const closingSteps = (plan) => [
  () => [call("ready_to_close", { client: OPEN_CLIENT, month: plan.closing })],
  () => [{ text: "אי אפשר לסגור עדיין: יש שורה שממתינה לאישור." }],
];

function idealSteps(plan) {
  if (plan.closing) return closingSteps(plan);
  let files = [];
  return [
    (request) => {
      assert.match(request.contents[0].parts[0].text, /This run works on one client and one month only: .*\(handle C1\), declaration 2026-09\./);
      return [call("list_inbox", {})];
    },
    (request) => {
      files = lastResponses(request, "list_inbox")[0].files.map((item) => item.file);
      return files.map((file) => call("extract_document", { file }));
    },
    (request) => {
      const facts = responsesIn(request.contents, "extract_document").flatMap((response) => response.documents.map((document) => document.fact));
      const rows = facts.map((fact) => ({
        fact, decision: plan.decision, ...(plan.account ? { account: plan.account } : {}), needs_review: Boolean(plan.needsReview), reason: "לפי הכללים.",
      }));
      return [call("add_rows", { client: OPEN_CLIENT, rows })];
    },
    (request) => {
      const added = lastResponses(request, "add_rows")[0].rows.filter((row) => row.month);
      assert.ok(added.length, JSON.stringify(lastResponses(request, "add_rows")[0]));
      return files.map((file) => call("move_file_to_declaration", { file }));
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

test("the user of a case picks a button by its text, or dismisses", () => {
  const card = { options: [{ id: "a", label: "כן, הוצאה" }, { id: "b", label: "לא" }] };
  assert.deepEqual(answerCard(card, { labels: ["לא"] }), { type: "option", id: "b" });
  assert.deepEqual(answerCard(card, {}), { type: "dismissed" });
});

test("every case runs on an open client and month of its world", () => {
  for (const spec of cases) {
    assert.ok(spec.clients.some((client) => client.folder === spec.open?.client && spec.open.month in (client.months ?? {})), spec.name);
  }
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
  const spec = cases.find((item) => item.name === "other-buyer");
  const outcome = await runCase(spec, { modelClient: scriptedClient([() => [{ text: "הכול טופל (Q1)." }]]), fetchSkill });
  const failed = checkCase(spec, outcome).filter((item) => !item.ok).map((item) => item.name);
  assert.deepEqual(failed, ["no handles in the answer", "row 3101", "filed inv-paper.jpg"]);
});

test("a run that fails is reported with its status", async () => {
  const spec = cases.find((item) => item.name === "other-buyer");
  const busy = Object.assign(new Error("busy"), { name: "ModelError", code: "busy" });
  const outcome = await runCase(spec, { modelClient: { generate: async () => { throw busy; } }, fetchSkill });
  const [completed] = checkCase(spec, outcome);
  assert.equal(completed.ok, false);
  assert.match(completed.detail, /^status failed/);
});
