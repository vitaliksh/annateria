// What the user decided by clicking a button of a question card (ask_user). add_rows accepts a client or a month that did not come
// from the folder of the file or from the document only if it comes from here: the model cannot name a decision that the user did not
// make. The option must belong to a question that was asked about this very file and was answered with a button.
import { ToolError } from "./errors.js";

// Resolves with the option the user clicked ({ id, label, clientId?, month? }).
export function clickedOption(ctx, ask, fileHandle) {
  const record = ctx.handles.get("Q", ask);
  if (record.answer?.type !== "option") throw new ToolError("not_allowed", `The question ${ask} was not answered with a button.`);
  if (!record.fileHandles.includes(fileHandle)) throw new ToolError("not_allowed", `The question ${ask} was not about the file ${fileHandle}.`);
  return record.options.find((option) => option.id === record.answer.id);
}
