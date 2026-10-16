// Calls to Gemini through the Worker (WORK_PLAN step 1.2). The page never sees the Gemini key: it sends the access token
// (access.js) and a constrained request that the Worker validates (worker/src/model.js).

export class ModelError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = "ModelError";
    this.code = code; // login | busy | unavailable | rejected | too-large | bad-request | network
    this.status = status;
  }
}

export const MODEL_MESSAGES = {
  login: "נדרש קוד גישה.",
  busy: "Gemini עמוס כרגע. אפשר לנסות שוב בעוד דקה.",
  unavailable: "Gemini אינו זמין כרגע. אפשר לנסות שוב.",
  rejected: "Gemini דחה את הבקשה.",
  "too-large": "הבקשה גדולה מדי.",
  "bad-request": "הבקשה אינה תקינה.",
  network: "אין חיבור לשרת. יש לבדוק את החיבור לאינטרנט.",
};

const errorFor = (status, body) => {
  const code = body?.code ?? (status === 401 ? "login" : status === 413 ? "too-large" : status === 400 ? "bad-request" : status === 429 ? "busy" : "unavailable");
  return new ModelError(code, MODEL_MESSAGES[code] ?? MODEL_MESSAGES.unavailable, status);
};

// Parses a server-sent-events body and yields the JSON of every `data:` event.
export async function* readEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const parse = (block) => {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    return data && data !== "[DONE]" ? JSON.parse(data) : null;
  };
  for (;;) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const blocks = pending.split(/\r?\n\r?\n/);
    pending = done ? "" : blocks.pop();
    for (const block of done ? blocks.concat(pending) : blocks) {
      const event = parse(block);
      if (event) yield event;
    }
    if (done) return;
  }
}

// access: createAccess(); ensureLoggedIn: asks for the code (access-ui.js) and resolves with the user or null.
export function createModelClient({ api, access, ensureLoggedIn, fetchImpl = (...args) => fetch(...args) }) {
  async function send(model, request, stream, signal) {
    const headers = access.authHeaders();
    if (!headers) throw new ModelError("login", MODEL_MESSAGES.login, 401);
    try {
      return await fetchImpl(`${api}/v1/model`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ model, stream, request }),
        signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new ModelError("network", MODEL_MESSAGES.network);
    }
  }

  // One retry after an expired or refused token: the person types the code again, then the same request is repeated.
  async function open(model, request, stream, signal) {
    if (!api) throw new ModelError("unavailable", MODEL_MESSAGES.unavailable);
    if (!access.isLoggedIn() && !(await ensureLoggedIn())) throw new ModelError("login", MODEL_MESSAGES.login, 401);
    let response = await send(model, request, stream, signal);
    if (response.status === 401) {
      access.logout();
      if (!(await ensureLoggedIn())) throw new ModelError("login", MODEL_MESSAGES.login, 401);
      response = await send(model, request, stream, signal);
    }
    if (!response.ok) throw errorFor(response.status, await response.json().catch(() => null));
    return response;
  }

  return {
    // Resolves with Gemini's generateContent answer.
    async generate({ model, request, signal }) {
      return (await open(model, request, false, signal)).json();
    },
    // Async generator of the streamed answer chunks (each one is a generateContent-shaped object).
    async *stream({ model, request, signal }) {
      const response = await open(model, request, true, signal);
      yield* readEvents(response.body);
    },
  };
}

// The text of an answer or of one chunk.
export function answerText(answer) {
  return (answer?.candidates?.[0]?.content?.parts ?? []).filter((part) => typeof part.text === "string" && !part.thought).map((part) => part.text).join("");
}

// "Check the AI connection" button of the settings dialog: one tiny real request. Resolves with a line to show.
export async function checkModelConnection(client, model = "gemini-3.5-flash-lite") {
  try {
    const answer = await client.generate({
      model,
      request: { contents: [{ role: "user", parts: [{ text: "Reply with the single word OK." }] }], generationConfig: { maxOutputTokens: 64 } },
    });
    return { ok: true, message: `החיבור ל‑AI תקין (${model}).` , text: answerText(answer).trim() };
  } catch (error) {
    return { ok: false, message: error instanceof ModelError ? error.message : MODEL_MESSAGES.unavailable };
  }
}
