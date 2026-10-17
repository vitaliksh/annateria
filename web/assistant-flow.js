// Runs the agent for the assistant dock (step 4.3): puts the services, the registry and the Gemini model together, builds the message
// of a run and turns the outcome into lines for the user. The loop itself is web/agent/run.js; the drawing is assistant-ui.js.
import { createExtractionAdapter } from "./agent/adapters/extraction.js";
import { createDocumentReader } from "./agent/adapters/documents.js";
import { createDefaultRegistry, createGeminiModel, createServices, runAgent, writeRunLog } from "./agent/index.js";
import { MODELS } from "./agent/models.js";
import { ORCHESTRATOR_PROMPT } from "./agent/prompts.js";
import { MODEL_MESSAGES } from "./model-client.js";

const PREVIOUS_ANSWER_CHARS = 2000;
const TEXT_LAYER_CHARS = 12000;

export const QUICK_MESSAGES = {
  process: "Process the new files in the inbox.",
  left: "What is left to do? Look at the inbox and at the tables of the clients: files that wait, rows marked for review, duplicates.",
};

// kind: process | left | text. active: { clientName, month } of what the user has open, or null. previous: the last answer of
// the assistant (only given for a typed request, so that a follow-up question has something to follow).
export function buildMessage({ kind, text = "", today, active = null, previous = "" }) {
  const lines = [`Today is ${today}.`];
  if (active) lines.push(`The user has open: the client "${active.clientName}", declaration ${active.month ?? "none"} (find the client with find_client by name).`);
  if (kind === "text" && previous) lines.push(`Your previous answer in this conversation:\n${previous.slice(0, PREVIOUS_ANSWER_CHARS)}`);
  lines.push(kind === "text" ? `The user writes: ${text}` : QUICK_MESSAGES[kind]);
  return lines.join("\n\n");
}

// The files that the run did not file, from the run itself and not from what the model says (it may call everything processed).
export function leftNote(result) {
  const left = result.left ?? [];
  if (!left.length) return null;
  const names = left.slice(0, 12).map((file) => file.name).join(", ");
  return { kind: "note", text: `נשארו בתיבת הקלט ${left.length} קבצים שלא טופלו: ${names}${left.length > 12 ? " ועוד" : ""}` };
}

const LIMIT_TEXT = { turns: "הריצה הגיעה למספר הצעדים המרבי.", "tool calls": "הריצה הגיעה למספר הפעולות המרבי.", time: "הריצה נמשכה יותר מדי זמן ונעצרה." };

// { kind: "assistant" | "note" | "error", text } for the end of a run.
export function resultNote(result) {
  switch (result.status) {
    case "completed": return { kind: "assistant", text: result.truncated ? `${result.text}\n(התשובה נקטעה)` : result.text };
    case "cancelled": return { kind: "note", text: "הריצה הופסקה." };
    case "limit_reached": return { kind: "note", text: LIMIT_TEXT[result.reason] ?? "הריצה נעצרה במגבלה." };
    case "blocked": return { kind: "error", text: "המודל סירב להשיב." };
    default: return { kind: "error", text: `הריצה נכשלה: ${MODEL_MESSAGES[result.code] ?? "אירעה שגיאה בהרצת העוזר."}` };
  }
}

// modelClient: createModelClient(...). getClients(), getDataRoot(), getLiveTable(): see agent/services.js. getModels(): the model of each role.
export function createAssistantFlow({ modelClient, getDataRoot, getClients, getLiveTable = () => null, builtInChart = () => ({}), reserved = () => ({}), getModels = () => MODELS, system = ORCHESTRATOR_PROMPT, now, reader = createDocumentReader(), onDeclarationCreated }) {
  const readText = async (file) => (await reader.inspect(file, { type: "application/pdf", storedName: file.name || "file.pdf" }, { maxChars: TEXT_LAYER_CHARS })).text ?? "";
  const registry = createDefaultRegistry();

  return {
    // Resolves with the result of the loop; `logError` is set when the run log could not be written.
    async run({ message, ui, signal, onEvent, onProgress }) {
      // The models are looked up for every run: the user may have changed them in the settings.
      const models = getModels();
      const extraction = createExtractionAdapter({ client: modelClient, models, readText });
      const services = createServices({ getDataRoot, getClients, getLiveTable, builtInChart, reserved, documents: reader, extraction, onDeclarationCreated });
      const model = createGeminiModel({ client: modelClient, model: models.orchestrator });
      const result = await runAgent({ model, system, registry, message, services, ui, signal, onEvent, onProgress, ...(now ? { now } : {}) });
      try {
        await writeRunLog(getDataRoot(), result.log);
      } catch (error) {
        result.logError = error.message;
      }
      return result;
    },
  };
}
