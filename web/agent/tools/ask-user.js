// ask_user (docs/AGENT_TOOLS.md, 5.4): a short question with buttons. The call waits for the answer; a dismissed question
// comes back as `dismissed` and the agent goes on. The record of the question (with the rule text that was shown, when the
// card offered "remember for this client") says what was shown. The rule is bound to one option: the page appends it to rules.md when
// the user ticks the box and clicks that option (step 4.6); this tool writes nothing. No button decides the client or the month of a
// file: every file of a run is of the client and month open in the page (step 9.6).
import { ToolError } from "../errors.js";
import { cleanRule } from "../../rule-text.js";

const normal = (text) => text.trim().replace(/\s+/g, " ").toLowerCase();
const RESERVED_IDS = ["other", "dismissed"];

function cancelled() { return new ToolError("cancelled", "The run was cancelled."); }

// Labels that only number the buttons: "לקוח א", "בחירה ב'", "אפשרות 1", "option A".
const PLACEHOLDER_LABEL = /^(לקוח|בחירה|אפשרות|option|choice|client)\s*[א-תA-Za-z0-9]?['׳"]?$/i;

export default {
  name: "ask_user",
  exclusive: true,
  description: "Ask the user one short question in Hebrew with 2 to 6 buttons and wait for the answer. Use it only when the facts cannot decide. Never ask which client or which month a file belongs to: every file of the run is of the open client and month. Optionally offer to remember the answer as a rule of one client: remember.rule is the exact Hebrew rule text shown to the user and remember.option the id of the answer it belongs to; the page saves it in the client's rules only if the user ticks the box and clicks that answer (saved: true in the result). There is no other way to save a rule.",
  schema: {
    type: "object",
    required: ["question", "options", "allow_other"],
    properties: {
      question: { type: "string", minLength: 1, maxLength: 200 },
      options: {
        type: "array", minItems: 2, maxItems: 6,
        items: {
          type: "object", required: ["id", "label"],
          properties: { id: { type: "string", minLength: 1, maxLength: 20 }, label: { type: "string", minLength: 1, maxLength: 40 } },
        },
      },
      allow_other: { type: "boolean", description: "Let the user type another answer." },
      about: {
        type: "object",
        properties: {
          files: { type: "array", maxItems: 12, items: { type: "string", maxLength: 12 }, description: "File handles the question is about." },
          rows: { type: "array", maxItems: 6, items: { type: "string", maxLength: 12 }, description: "Row handles the question is about." },
        },
      },
      remember: {
        type: "object", required: ["client", "rule", "option"],
        properties: {
          client: { type: "string", maxLength: 12, description: "Client handle." },
          rule: { type: "string", minLength: 1, maxLength: 200, description: "The rule, in Hebrew, exactly as it should be saved." },
          option: { type: "string", maxLength: 20, description: "The id of the option the rule belongs to: it is saved only when the user clicks that option." },
        },
      },
    },
  },
  async run(args, ctx) {
    if (typeof ctx.ui.ask !== "function") throw new ToolError("unavailable", "There is no one to ask.");
    const key = normal(args.question);
    const earlier = ctx.run.asked.get(key);
    if (earlier) return earlier;
    if (ctx.run.questions >= ctx.limits.questions) throw new ToolError("limit_reached", "No more questions are allowed in this run.");
    if (args.options.some((option) => PLACEHOLDER_LABEL.test(option.label.trim()))) {
      throw new ToolError("invalid_argument", "A label must say what the button means (a name, a decision), not \"option A\" or \"client B\".");
    }
    const ids = args.options.map((option) => option.id);
    if (new Set(ids).size !== ids.length || ids.some((id) => RESERVED_IDS.includes(id))) throw new ToolError("invalid_argument", "Option ids must be unique and not 'other' or 'dismissed'.");
    const files = (args.about?.files ?? []).map((handle) => ({ file: handle, ...ctx.handles.get("F", handle) }));
    const rows = (args.about?.rows ?? []).map((handle) => ({ row: handle, ...ctx.handles.get("R", handle) }));
    const client = args.remember ? ctx.handles.get("C", args.remember.client) : null;
    const rule = args.remember ? cleanRule(args.remember.rule) : null;
    if (args.remember) {
      if (!rule) throw new ToolError("invalid_argument", "remember.rule is empty.");
      if (!ids.includes(args.remember.option)) throw new ToolError("invalid_argument", "remember.option must be the id of one of the options.");
    }
    // The user must never read a handle (C1, F2).
    if (args.options.some((option) => /^[A-Z]\d+(\.\d+)?$/.test(option.label.trim()))) throw new ToolError("invalid_argument", "A label must be words for the user, not a handle.");
    const options = args.options.map(({ id, label }) => ({ id, label }));

    ctx.run.questions += 1;
    const record = { question: args.question, options, fileHandles: args.about?.files ?? [], clientId: client?.clientId ?? null, rule, ruleOption: args.remember?.option ?? null, answer: null, remembered: false, saved: false };
    const ask = ctx.handles.create("Q", ctx.run.questions, record);
    const card = {
      id: ask, question: args.question, allowOther: args.allow_other, options,
      about: { files: files.map(({ file, name, folder }) => ({ file, name, folder })), rows: rows.map(({ row }) => ({ row })) },
      // clientId is for the page, which saves the rule; optionLabel tells the user which answer the rule belongs to.
      remember: client ? { client: client.name, clientId: client.clientId, rule, option: args.remember.option, optionLabel: options.find((option) => option.id === args.remember.option).label } : null,
    };
    const aborted = new Promise((_, reject) => {
      if (ctx.signal.aborted) reject(cancelled());
      ctx.signal.addEventListener("abort", () => reject(cancelled()), { once: true });
    });
    let answer;
    try {
      answer = await Promise.race([ctx.ui.ask(card, { signal: ctx.signal }), aborted]);
    } catch (error) {
      if (error instanceof ToolError) throw error;
      if (error?.name === "AbortError" || ctx.signal.aborted) throw cancelled();
      throw new ToolError("unavailable", "The question could not be shown.");
    }
    const text = typeof answer?.text === "string" ? answer.text.trim().slice(0, 300) : "";
    const valid = answer?.type === "dismissed"
      || (answer?.type === "option" && ids.includes(answer.id))
      || (answer?.type === "other" && args.allow_other && text);
    if (!valid) throw new ToolError("internal", "The answer was not one of the offered ones.");
    record.answer = answer.type === "option" ? { type: "option", id: answer.id } : answer.type === "other" ? { type: "other", text } : { type: "dismissed" };
    // The tick counts only with the answer the rule belongs to; `saved` is what the page reports after it wrote rules.md.
    record.remembered = Boolean(client && answer.remember === true && record.answer.type === "option" && record.answer.id === record.ruleOption);
    record.saved = record.remembered && answer.saved === true;
    const output = { ask, answer: record.answer, remember: record.remembered, ...(record.remembered ? { saved: record.saved } : {}) };
    ctx.run.asked.set(key, output);
    return output;
  },
};
