import test from "node:test";
import assert from "node:assert/strict";
import { ToolError } from "../agent/errors.js";
import { createHandles } from "../agent/handles.js";
import { createRegistry } from "../agent/registry.js";
import { toGeminiSchema, validate } from "../agent/schema.js";

const schema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 5 },
    kind: { type: "string", enum: ["a", "b"] },
    count: { type: "integer", minimum: 1, maximum: 9 },
    ratio: { type: "number" },
    flag: { type: "boolean" },
    list: { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } },
    inner: { type: "object", required: ["x"], properties: { x: { type: "integer" } } },
  },
};

test("validate accepts a good value and returns a cleaned copy", () => {
  const input = { name: "abc", kind: "a", count: 3, ratio: 0.5, flag: false, list: ["x"], inner: { x: 1 } };
  const result = validate(schema, input);
  assert.deepEqual(result, { ok: true, value: input });
  assert.notEqual(result.value, input);
});

test("validate names the problem: unknown field, missing, type, enum, bounds, lengths, nested", () => {
  const message = (value) => validate(schema, value).message;
  assert.match(message({ name: "a", extra: 1 }), /unknown field "extra"/);
  assert.match(message({}), /"name" is required/);
  assert.match(message({ name: 5 }), /arguments\.name must be a string/);
  assert.match(message({ name: "" }), /too short/);
  assert.match(message({ name: "abcdef" }), /too long/);
  assert.match(message({ name: "a", kind: "c" }), /one of: a, b/);
  assert.match(message({ name: "a", count: 1.5 }), /whole number/);
  assert.match(message({ name: "a", count: 0 }), /at least 1/);
  assert.match(message({ name: "a", count: 10 }), /at most 9/);
  assert.match(message({ name: "a", ratio: "1" }), /must be a number/);
  assert.match(message({ name: "a", ratio: Infinity }), /must be a number/);
  assert.match(message({ name: "a", flag: "yes" }), /true or false/);
  assert.match(message({ name: "a", list: [] }), /at least 1 items/);
  assert.match(message({ name: "a", list: ["1", "2", "3"] }), /too many items/);
  assert.match(message({ name: "a", list: [1] }), /list\[0\] must be a string/);
  assert.match(message({ name: "a", inner: {} }), /inner: "x" is required/);
  assert.match(message([]), /must be an object/);
});

test("null for an optional field means not given; null for a required one is refused", () => {
  assert.deepEqual(validate(schema, { name: "a", kind: null }).value, { name: "a" });
  assert.equal(validate(schema, { name: null }).ok, false);
});

test("toGeminiSchema renames the types and keeps the constraints, without extra keywords", () => {
  const out = toGeminiSchema({ type: "object", description: "d", required: ["n"], properties: { n: { type: "array", maxItems: 2, items: { type: "string", enum: ["a"], maxLength: 3 } }, i: { type: "integer", minimum: 1 } } });
  assert.deepEqual(out, {
    type: "OBJECT", description: "d", required: ["n"],
    properties: { n: { type: "ARRAY", maxItems: 2, items: { type: "STRING", enum: ["a"], maxLength: 3 } }, i: { type: "INTEGER", minimum: 1 } },
  });
});

test("handles are stable per key, run-local, checked by prefix and refuse what was never issued", () => {
  const handles = createHandles();
  const a = handles.create("F", "hash-a", { n: 1 });
  const b = handles.create("F", "hash-b", { n: 2 });
  const c = handles.create("C", "client", { n: 3 });
  assert.deepEqual([a, b, c], ["F1", "F2", "C1"]);
  assert.equal(handles.create("F", "hash-a", { n: 9 }), "F1");
  assert.deepEqual(handles.get("F", "F1"), { n: 9 });
  for (const wrong of ["F3", "C1x", "f1", "F0", "F01", "", null, 5, "F1; drop"]) {
    assert.throws(() => handles.get("F", wrong), (error) => error instanceof ToolError && error.code === "not_found", String(wrong));
  }
  assert.throws(() => handles.get("C", "F1"), /Unknown handle/);
});

test("readable replaces issued client, file, fact and row handles by names and leaves everything else", () => {
  const handles = createHandles();
  handles.create("C", "client-1", { clientId: "client-1", name: "Levi Plumbing Ltd" });
  handles.create("F", "hash-a", { name: "invoice-17.pdf", folder: "_unsorted" });
  handles.createFact("F1", 2, { total: 1 });
  handles.create("R", "client-1|2026-03|12", { clientId: "client-1", month: "2026-03", documentId: "d-1", position: 12 });
  handles.create("Q", 1, { question: "?" });
  assert.equal(handles.readable("C1: F1, F1.2 ו־R1."), "Levi Plumbing Ltd: invoice-17.pdf, invoice-17.pdf ו־שורה 12 (03/2026).");
  assert.equal(handles.readable("Q1, C2, F9, R4, R1.2, CF1, C10x, AC1 stay"), "Q1, C2, F9, R4, R1.2, CF1, C10x, AC1 stay");
  assert.equal(handles.readable("ללקוחC1"), "ללקוחLevi Plumbing Ltd", "a Hebrew letter is not a word character, so the handle still counts");
});

const tool = (extra = {}) => ({ name: "echo", description: "Echo.", schema: { type: "object", required: ["text"], properties: { text: { type: "string" } } }, run: async (args) => ({ said: args.text }), ...extra });

test("dispatch runs a valid call and wraps the data in the envelope", async () => {
  const registry = createRegistry([tool()]);
  assert.deepEqual(await registry.dispatch({ name: "echo", args: { text: "hi" } }, {}), { ok: true, said: "hi" });
});

test("an unknown tool is not_allowed and nothing runs", async () => {
  let ran = 0;
  const registry = createRegistry([tool({ run: async () => { ran += 1; return {}; } })]);
  for (const name of ["close_month", "delete_row", "echo2", undefined]) {
    const result = await registry.dispatch({ name, args: {} }, {});
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_allowed");
  }
  assert.equal(ran, 0);
});

test("bad arguments are invalid_argument and the tool does not run", async () => {
  let ran = 0;
  const registry = createRegistry([tool({ run: async () => { ran += 1; return {}; } })]);
  const result = await registry.dispatch({ name: "echo", args: { text: 5 } }, {});
  assert.deepEqual([result.ok, result.error.code], [false, "invalid_argument"]);
  assert.equal((await registry.dispatch({ name: "echo", args: { text: "a", sneaky: 1 } }, {})).error.code, "invalid_argument");
  assert.equal(ran, 0);
});

test("a ToolError keeps its code; any other exception becomes a generic internal error", async () => {
  const registry = createRegistry([
    tool({ name: "locked", run: async () => { throw new ToolError("locked", "The declaration is locked."); } }),
    tool({ name: "boom", run: async () => { throw new Error("secret path C:\\data"); } }),
    tool({ name: "odd", run: async () => { throw new ToolError("made_up", "x"); } }),
  ]);
  assert.deepEqual(await registry.dispatch({ name: "locked", args: { text: "" } }, {}), { ok: false, error: { code: "locked", message: "The declaration is locked." } });
  const boom = await registry.dispatch({ name: "boom", args: { text: "" } }, {});
  assert.deepEqual(boom, { ok: false, error: { code: "internal", message: "The tool failed." } });
  assert.equal((await registry.dispatch({ name: "odd", args: { text: "" } }, {})).error.code, "internal");
});

test("a result above the size cap is refused instead of being sent to the model", async () => {
  const registry = createRegistry([tool({ run: async () => ({ big: "x".repeat(300) }) })], { resultBytes: 200 });
  assert.equal((await registry.dispatch({ name: "echo", args: { text: "" } }, {})).error.code, "internal");
});

test("the registry lists sorted names, declarations in the Gemini shape and the exclusive flag; a name twice is refused", () => {
  const registry = createRegistry([tool({ name: "b", exclusive: true }), tool({ name: "a" })]);
  assert.deepEqual(registry.names(), ["a", "b"]);
  assert.equal(registry.isExclusive("b"), true);
  assert.equal(registry.isExclusive("a"), false);
  assert.deepEqual(registry.declarations()[1], { name: "a", description: "Echo.", parameters: { type: "OBJECT", required: ["text"], properties: { text: { type: "STRING" } } } });
  assert.throws(() => createRegistry([tool(), tool()]), /registered twice/);
});
