// ask_user (docs/AGENT_TOOLS.md, 5.4): a short question with buttons. The call waits for the answer; a dismissed question
// comes back as `dismissed` and the agent goes on. The record of the question (with the rule text that was shown, when the
// card offered "remember for this client") is what remember_rule later relies on.
import { ToolError } from "../errors.js";

const normal = (text) => text.trim().replace(/\s+/g, " ").toLowerCase();
const RESERVED_IDS = ["other", "dismissed"];

function cancelled() { return new ToolError("cancelled", "The run was cancelled."); }

export default {
  name: "ask_user",
  exclusive: true,
  description: "Ask the user one short question in Hebrew with 2 to 6 buttons and wait for the answer. Use it only when the facts cannot decide. Optionally offer to remember the answer as a rule of one client (the exact rule text is shown to the user).",
  schema: {
    type: "object",
    required: ["question", "options", "allow_other"],
    properties: {
      question: { type: "string", minLength: 1, maxLength: 200 },
      options: {
        type: "array", minItems: 2, maxItems: 6,
        items: { type: "object", required: ["id", "label"], properties: { id: { type: "string", minLength: 1, maxLength: 20 }, label: { type: "string", minLength: 1, maxLength: 40 } } },
      },
      allow_other: { type: "boolean", description: "Let the user type another answer." },
      about: {
        type: "object",
        properties: {
          files: { type: "array", maxItems: 6, items: { type: "string", maxLength: 12 }, description: "File handles the question is about." },
          rows: { type: "array", maxItems: 6, items: { type: "string", maxLength: 12 }, description: "Row handles the question is about." },
        },
      },
      remember: {
        type: "object", required: ["client", "rule"],
        properties: { client: { type: "string", maxLength: 12, description: "Client handle." }, rule: { type: "string", minLength: 1, maxLength: 200, description: "The rule, in Hebrew, exactly as it should be saved." } },
      },
    },
  },
  async run(args, ctx) {
    if (typeof ctx.ui.ask !== "function") throw new ToolError("unavailable", "There is no one to ask.");
    const key = normal(args.question);
    const earlier = ctx.run.asked.get(key);
    if (earlier) return earlier;
    if (ctx.run.questions >= ctx.limits.questions) throw new ToolError("limit_reached", "No more questions are allowed in this run.");
    const ids = args.options.map((option) => option.id);
    if (new Set(ids).size !== ids.length || ids.some((id) => RESERVED_IDS.includes(id))) throw new ToolError("invalid_argument", "Option ids must be unique and not 'other' or 'dismissed'.");
    const files = (args.about?.files ?? []).map((handle) => ({ file: handle, ...ctx.handles.get("F", handle) }));
    const rows = (args.about?.rows ?? []).map((handle) => ({ row: handle, ...ctx.handles.get("R", handle) }));
    const client = args.remember ? ctx.handles.get("C", args.remember.client) : null;

    ctx.run.questions += 1;
    const record = { question: args.question, options: args.options, clientId: client?.clientId ?? null, rule: args.remember?.rule ?? null, answer: null, remembered: false };
    const ask = ctx.handles.create("Q", ctx.run.questions, record);
    const card = {
      id: ask, question: args.question, options: args.options, allowOther: args.allow_other,
      about: { files: files.map(({ file, name, folder }) => ({ file, name, folder })), rows: rows.map(({ row }) => ({ row })) },
      remember: client ? { client: client.name, rule: args.remember.rule } : null,
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
    record.remembered = Boolean(client && answer.remember === true && answer.type !== "dismissed");
    const output = { ask, answer: record.answer, remember: record.remembered };
    ctx.run.asked.set(key, output);
    return output;
  },
};
