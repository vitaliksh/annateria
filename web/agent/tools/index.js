// The tools built so far (docs/AGENT_TOOLS.md, section 5). The others are added by the steps that need them: PENDING_TOOLS in
// test/agent-boundary.test.mjs lists what is still missing and shrinks until it is empty.
import askUser from "./ask-user.js";
import extractDocument from "./extract-document.js";
import factsFor from "./facts-for.js";
import findClient from "./find-client.js";
import getClientContext from "./get-client-context.js";
import listInbox from "./list-inbox.js";
import proposeChange from "./propose-change.js";
import queryRows from "./query-rows.js";
import readDocument from "./read-document.js";

export const TOOLS = [listInbox, readDocument, extractDocument, findClient, getClientContext, queryRows, factsFor, askUser, proposeChange];
