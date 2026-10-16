// The model of the loop, on Gemini through the Worker (web/model-client.js): one generateContent request per step. The
// parts of the answer are handed back unchanged, because Gemini 3 wants the thoughtSignature of a function call returned in
// the same part (docs/HANDOFF.md, "Gemini function calling").
const MAX_OUTPUT_TOKENS = 8192;

// client: createModelClient(...). model: a Gemini model id from ALLOWED_MODELS.
export function createGeminiModel({ client, model, maxOutputTokens = MAX_OUTPUT_TOKENS }) {
  return {
    async step({ system, contents, tools, signal }) {
      const request = {
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { maxOutputTokens },
      };
      if (tools.length) {
        request.tools = [{ functionDeclarations: tools }];
        request.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
      }
      const answer = await client.generate({ model, request, signal });
      const candidate = answer?.candidates?.[0];
      return {
        parts: candidate?.content?.parts ?? [],
        finishReason: candidate?.finishReason,
        blockReason: answer?.promptFeedback?.blockReason,
        usage: answer?.usageMetadata,
        model,
      };
    },
  };
}
