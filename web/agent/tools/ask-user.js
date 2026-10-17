// ask_user (docs/AGENT_TOOLS.md, 5.4): a short question with buttons. The call waits for the answer; a dismissed question
// comes back as `dismissed` and the agent goes on. The record of the question (with the rule text that was shown, when the
// card offered "remember for this client") is what remember_rule later relies on. An option may carry a client handle or a month:
// a click on it is then the decision of the user about the client (or the month) of the files the question is about, and add_rows
// accepts nothing else as that decision.
import { ToolError } from "../errors.js";

const normal = (text) => text.trim().replace(/\s+/g, " ").toLowerCase();
const RESERVED_IDS = ["other", "dismissed"];

function cancelled() { return new ToolError("cancelled", "The run was cancelled."); }

const CLIENT_BUTTONS = 5;
const CLIENT_WORDS = /לקוח|client/i;
// Labels that only number the buttons: "לקוח א", "בחירה ב'", "אפשרות 1", "option A".
const PLACEHOLDER_LABEL = /^(לקוח|בחירה|אפשרות|option|choice|client)\s*[א-תA-Za-z0-9]?['׳"]?$/i;

// choose_client: the question "which client?" is built by the code, so the user always reads names and every choice carries its
// client. The candidates of the model (the open client first) become buttons; every other active client is in a list; several
// files get a button "different clients" (no client: the agent then asks per file).
async function clientOptions(args, ctx, fileCount) {
  const all = await ctx.services.clients.list();
  const handleOf = (client) => ctx.handles.create("C", client.clientId, { clientId: client.clientId, name: client.clientName, vatId: client.vatId ?? "", folder: client.folder ?? "" });
  const candidates = [...new Set((args.clients ?? []).map((handle) => ctx.handles.get("C", handle).clientId))].slice(0, CLIENT_BUTTONS);
  const options = candidates.map((clientId, index) => {
    const client = all.find((item) => item.clientId === clientId);
    if (!client) throw new ToolError("not_found", "A candidate is not an active client.");
    return { id: `client${index + 1}`, label: client.clientName, client: handleOf(client) };
  });
  const rest = all.filter((client) => !candidates.includes(client.clientId)).sort((a, b) => a.clientName.localeCompare(b.clientName, "he"));
  rest.forEach((client, index) => options.push({ id: `list${index + 1}`, label: client.clientName, client: handleOf(client), listed: true }));
  if (fileCount > 1) options.push({ id: "mixed", label: "לקוחות שונים" });
  if (!options.some((option) => option.client)) throw new ToolError("not_found", "There is no active client to choose.");
  return options;
}

export default {
  name: "ask_user",
  exclusive: true,
  description: "Ask the user one short question in Hebrew with 2 to 6 buttons and wait for the answer. Use it only when the facts cannot decide. To ask which client files belong to, do not build buttons: set choose_client true, list the files in about.files and the candidate clients (handles, the client the user has open first) in clients; the code shows the names of the clients as buttons and a list of all the other clients, and the answer gives you the handle of the chosen client (client). Optionally offer to remember the answer as a rule of one client (the exact rule text is shown to the user).",
  schema: {
    type: "object",
    required: ["question", "allow_other"],
    properties: {
      question: { type: "string", minLength: 1, maxLength: 200 },
      choose_client: { type: "boolean", description: "The question is which client the files of about.files belong to; the code builds the buttons (do not give options)." },
      clients: { type: "array", maxItems: 5, items: { type: "string", maxLength: 12 }, description: "With choose_client: candidate client handles, shown first as buttons." },
      options: {
        type: "array", minItems: 2, maxItems: 6,
        items: {
          type: "object", required: ["id", "label"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: 20 }, label: { type: "string", minLength: 1, maxLength: 40 },
            client: { type: "string", maxLength: 12, description: "Client handle: choosing this button means the files belong to this client." },
            month: { type: "string", maxLength: 7, description: "YYYY-MM: choosing this button means the files go to this month." },
          },
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
    // A file that the user already sent to a client in this run is not asked about again: the earlier answer stands.
    const fileHandles = args.about?.files ?? [];
    const routed = fileHandles.map((handle) => ctx.run.routes.get(handle));
    if (routed.length && routed.every(Boolean) && new Set(routed.map((output) => output.ask)).size === 1) return { ...routed[0], already_answered: true };
    // A question about the client of files must be choose_client: a model that builds its own buttons gave them labels such as
    // "לקוח א" with no client behind them (seen 17 October), which tell the user nothing and prove nothing.
    const aboutClient = CLIENT_WORDS.test(args.question) || (args.options ?? []).some((option) => CLIENT_WORDS.test(option.label));
    if (!args.choose_client && fileHandles.length && aboutClient && !(args.options ?? []).some((option) => option.client)) {
      throw new ToolError("invalid_argument", "To ask which client files belong to, call ask_user with choose_client true, about.files and the candidate clients in clients; give no options.");
    }
    if ((args.options ?? []).some((option) => PLACEHOLDER_LABEL.test(option.label.trim()))) {
      throw new ToolError("invalid_argument", "A label must say what the button means (a name, a month, a decision), not \"option A\" or \"client B\".");
    }
    if (args.choose_client) {
      if (!fileHandles.length) throw new ToolError("invalid_argument", "choose_client needs the files it is about (about.files).");
      if (args.options) throw new ToolError("invalid_argument", "choose_client builds the buttons itself: give clients (candidates), not options.");
      args = { ...args, options: await clientOptions(args, ctx, fileHandles.length) };
    } else if (!args.options || args.options.length < 2) throw new ToolError("invalid_argument", "options needs 2 to 6 buttons.");
    const ids = args.options.map((option) => option.id);
    if (args.options.some((option) => option.client) && !fileHandles.length) throw new ToolError("invalid_argument", "A question that offers clients must list the files it is about (about.files): a click proves nothing about other files.");
    if (new Set(ids).size !== ids.length || ids.some((id) => RESERVED_IDS.includes(id))) throw new ToolError("invalid_argument", "Option ids must be unique and not 'other' or 'dismissed'.");
    const files = (args.about?.files ?? []).map((handle) => ({ file: handle, ...ctx.handles.get("F", handle) }));
    const rows = (args.about?.rows ?? []).map((handle) => ({ row: handle, ...ctx.handles.get("R", handle) }));
    const client = args.remember ? ctx.handles.get("C", args.remember.client) : null;
    const monthOf = (month) => {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ToolError("invalid_argument", "month must look like 2026-03.");
      return month;
    };
    // The user must never read a handle (C1, F2): the button of a client carries the client's name, whatever label the model gave it.
    if (args.options.some((option) => !option.client && /^[A-Z]\d+(\.\d+)?$/.test(option.label.trim()))) throw new ToolError("invalid_argument", "A label must be words for the user, not a handle.");
    const clients = new Map(args.options.filter((option) => option.client).map((option) => [option.id, ctx.handles.get("C", option.client)]));
    const labelOf = (option) => clients.get(option.id)?.name ?? option.label;
    const options = args.options.map((option) => ({
      id: option.id, label: labelOf(option),
      ...(option.client ? { clientId: clients.get(option.id).clientId } : {}),
      ...(option.month ? { month: monthOf(option.month) } : {}),
      ...(option.listed ? { listed: true } : {}),
    }));

    ctx.run.questions += 1;
    const record = { question: args.question, options, fileHandles: args.about?.files ?? [], clientId: client?.clientId ?? null, rule: args.remember?.rule ?? null, answer: null, remembered: false };
    const ask = ctx.handles.create("Q", ctx.run.questions, record);
    const card = {
      id: ask, question: args.question, allowOther: args.allow_other,
      // Buttons; with choose_client the clients that are not candidates are in a list (`more`) instead.
      options: options.filter((option) => !option.listed).map(({ id, label }) => ({ id, label })),
      ...(args.choose_client ? { more: options.filter((option) => option.listed).map(({ id, label }) => ({ id, label })) } : {}),
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
    const chosen = record.answer.type === "option" ? record.options.find((option) => option.id === record.answer.id) : null;
    // The handle of the chosen client, so that the model can name it in add_rows or prepare_import even if it never found it.
    const chosenHandle = chosen?.clientId ? args.options.find((option) => option.id === chosen.id).client : null;
    const output = { ask, answer: record.answer, remember: record.remembered, ...(chosenHandle ? { client: chosenHandle } : {}) };
    ctx.run.asked.set(key, output);
    if (chosen?.clientId) for (const handle of record.fileHandles) ctx.run.routes.set(handle, output);
    return output;
  },
};
