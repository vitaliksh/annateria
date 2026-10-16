// Limits of one agent run (docs/AGENT_TOOLS.md, sections 2 and 3). Starting values; the owner approved them as constants.
export const LIMITS = Object.freeze({
  turns: 60,
  toolCalls: 400,
  extractions: 200,
  extractionsPerFile: 2,
  parallelExtractions: 3,
  questions: 15,
  minutes: 30,
  modelRetries: 2,
  resultBytes: 20000,
});
