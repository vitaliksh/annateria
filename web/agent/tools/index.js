// The tools built so far (docs/AGENT_TOOLS.md, section 5). The others are added by the steps that need them: PENDING_TOOLS in
// test/agent-registry.test.mjs lists what is still missing and shrinks until it is empty.
import askUser from "./ask-user.js";
import findClient from "./find-client.js";
import listInbox from "./list-inbox.js";
import proposeChange from "./propose-change.js";

export const TOOLS = [listInbox, findClient, askUser, proposeChange];
