// The skills of the agent (steps 5.1 and 5.2): the format of every file, the version ledger, the loading, and which model call gets
// which skill. (The test that 5.1 moved the old prompts without a changed word went with 5.2, which changes the rules on purpose.)
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { BASE_PROMPT } from "../agent/prompts.js";
import { SKILL_ROLES, SkillsUnavailableError, fetchSkillFromSite, instructionFor, loadSkills, parseSkill, skillVersions } from "../agent/skills.js";
import { createAssistantFlow, resultNote } from "../assistant-flow.js";
import { recordingUi, world } from "./agent-fixtures.mjs";
import { listPaths, readFileBytes } from "./memory-binary-directory.mjs";
import { SKILLS_DIR, diskFetch, diskSkills } from "./skills-fixture.mjs";

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const valid = (extra = "") => `---\nname: demo-skill\ndescription: Does a thing and says when to use it.\nmetadata:\n  version: 2\n${extra}---\nThe text.\n`;

test("the skills folder holds exactly the skills of the closed list, and every file is in the Agent Skills format", async () => {
  const folders = (await readdir(SKILLS_DIR, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.deepEqual(folders, Object.keys(SKILL_ROLES).sort(), "the closed list of agent/skills.js");
  for (const name of folders) {
    const skill = parseSkill(await diskFetch(name), name);
    assert.deepEqual([skill.name, Number.isInteger(skill.version) && skill.version >= 1], [name, true], name);
    assert.ok(skill.description.length > 20 && skill.body.length > 100, name);
  }
});

test("a SKILL.md with a wrong frontmatter is refused, with a reason", () => {
  assert.deepEqual(parseSkill(valid(), "demo-skill"), { name: "demo-skill", description: "Does a thing and says when to use it.", version: 2, body: "The text." });
  assert.equal(parseSkill(valid().replaceAll("\n", "\r\n"), "demo-skill").body, "The text.", "a Windows checkout reads the same");
  const refused = (text, folder, pattern) => assert.throws(() => parseSkill(text, folder), pattern);
  refused("no frontmatter\ntext", "demo-skill", /frontmatter/);
  refused(valid(), "other-folder", /differs from the folder/);
  refused(valid().replace("name: demo-skill", "name: Demo_Skill"), "Demo_Skill", /lowercase/);
  refused(valid().replace("name: demo-skill", "name: -demo"), "-demo", /lowercase/);
  refused(valid().replace("name: demo-skill", "name: demo--skill"), "demo--skill", /lowercase/);
  refused(valid().replace("  version: 2\n", ""), "demo-skill", /version/);
  refused(valid().replace("version: 2", "version: two"), "demo-skill", /version/);
  refused(valid().replace("version: 2", "version: 0"), "demo-skill", /version/);
  refused(valid().replace("version: 2", "version: 2.5"), "demo-skill", /version/);
  refused(valid("  owner: me\n"), "demo-skill", /only version/);
  refused(valid().replace("description: Does a thing and says when to use it.", "description: Does a thing: yes"), "demo-skill", /plain YAML/);
  refused(valid().replace("description: Does a thing and says when to use it.", "description:"), "demo-skill", /description/);
  refused(valid().replace("---\nThe text.", "---\n   "), "demo-skill", /no text/);
  refused(valid().replace("name: demo-skill", "title: x\nname: demo-skill"), "demo-skill", /unexpected/);
});

test("a skill whose text changed must have a higher metadata.version, and the ledger records both", async () => {
  const ledger = await fixture("skill-hashes.json");
  assert.deepEqual(Object.keys(ledger).sort(), Object.keys(SKILL_ROLES).sort());
  for (const name of Object.keys(SKILL_ROLES)) {
    const text = (await diskFetch(name)).replace(/\r\n?/g, "\n");
    const now = { version: parseSkill(text, name).version, sha256: createHash("sha256").update(text).digest("hex") };
    const recorded = ledger[name];
    const entry = `"${name}": { "version": ${now.version}, "sha256": "${now.sha256}" }`;
    if (now.sha256 !== recorded.sha256) {
      assert.notEqual(now.version, recorded.version, `${name}: the text changed but metadata.version did not; raise it and record ${entry} in test/fixtures/skill-hashes.json`);
      assert.fail(`${name}: the version went from ${recorded.version} to ${now.version}; now record ${entry} in test/fixtures/skill-hashes.json`);
    }
    assert.equal(now.version, recorded.version, `${name}: the version changed without a change of text; record ${entry}`);
  }
});

test("each model call gets only its skills: the orchestrator never reads the extraction prompt, the vision call never reads the rules of the books", async () => {
  const skills = await diskSkills();
  const orchestrator = instructionFor("orchestrator", skills);
  const extraction = instructionFor("extraction", skills);
  assert.ok(orchestrator.startsWith(BASE_PROMPT));
  for (const name of ["classification", "periods-and-duplicates", "pcn-allocation", "month-closing-checklist"]) assert.ok(orchestrator.includes(`SKILL ${name}`), name);
  assert.equal(orchestrator.includes("You only read; you never classify"), false);
  assert.equal(extraction.includes("THE SOFTWARE COMPUTES") || extraction.includes("decision expense"), false);
  assert.deepEqual(skillVersions(skills), { "invoice-extraction": 2, classification: 4, "periods-and-duplicates": 2, "pcn-allocation": 1, "month-closing-checklist": 1 });
  assert.equal(BASE_PROMPT.includes("decision expense (a tax invoice"), false, "the base prompt keeps only the mechanics");
});

test("a ledger page is read line by line: one record per listed document, dated by its line, no period of the report", async () => {
  const skills = await diskSkills();
  const extraction = instructionFor("extraction", skills);
  assert.ok(extraction.includes("A LIST OF BOOKED DOCUMENTS"));
  assert.ok(extraction.includes("Return one record for every line that lists one document"));
  assert.ok(extraction.includes("period_from and period_to are null"));
  assert.ok(instructionFor("orchestrator", skills).includes("each record stands for the document on its line"));
});

test("loading: every skill must come, and the error names each one that did not", async () => {
  const skills = await loadSkills(diskFetch);
  assert.deepEqual(Object.keys(skills).sort(), Object.keys(SKILL_ROLES).sort());
  assert.equal(skills.classification.role, "orchestrator");
  const failing = async (name) => {
    if (name === "classification") throw new Error("HTTP 404");
    if (name === "invoice-extraction") return "<html>an error page</html>";
    return diskFetch(name);
  };
  await assert.rejects(() => loadSkills(failing), (error) => {
    assert.ok(error instanceof SkillsUnavailableError);
    assert.deepEqual([error.code, error.missing.map((item) => item.name).sort()], ["skills_unavailable", ["classification", "invoice-extraction"]]);
    assert.match(error.missing.find((item) => item.name === "classification").reason, /404/);
    return true;
  });
});

test("the page asks its own site for each file and lets the browser check for a newer one", async () => {
  const seen = [];
  const answer = (status, body = "text") => async (url, options) => { seen.push([url, options]); return { ok: status === 200, status, text: async () => body }; };
  assert.equal(await fetchSkillFromSite("classification", answer(200)), "text");
  assert.deepEqual(seen, [["skills/classification/SKILL.md", { cache: "no-cache" }]]);
  await assert.rejects(() => fetchSkillFromSite("classification", answer(404)), /HTTP 404/);
});

// A model client that records every call and answers with text only.
function textClient() {
  const requests = [];
  return { requests, generate: async ({ model, request }) => { requests.push({ model, request: structuredClone(request) }); return { candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] }; } };
}

test("a run needs all the skills: with one missing nothing starts, no model is called, the dock gets an error", async () => {
  const w = await world();
  const modelClient = textClient();
  const flow = createAssistantFlow({
    modelClient, getDataRoot: () => w.root, getClients: () => w.clients,
    fetchSkill: async (name) => { if (name === "periods-and-duplicates") throw new Error("HTTP 404"); return diskFetch(name); },
  });
  const result = await flow.run({ message: "process", ui: recordingUi(), signal: new AbortController().signal });
  assert.deepEqual([result.status, result.code, result.missing.map((item) => item.name), result.turns], ["failed", "skills_unavailable", ["periods-and-duplicates"], 0]);
  assert.equal(modelClient.requests.length, 0);
  assert.equal((await listPaths(w.root)).some((path) => path.startsWith("common/agent-runs/")), false, "no run, no run log");
  const note = resultNote(result);
  assert.equal(note.kind, "error");
  assert.ok(note.text.includes("periods-and-duplicates") && note.text.includes("Ctrl+F5"), note.text);
});

test("the skills are read again for every run, so an updated file reaches the next run", async () => {
  const w = await world();
  const modelClient = textClient();
  let reads = 0;
  const flow = createAssistantFlow({ modelClient, getDataRoot: () => w.root, getClients: () => w.clients, fetchSkill: async (name) => { reads += 1; return diskFetch(name); } });
  const run = () => flow.run({ message: "x", ui: recordingUi(), signal: new AbortController().signal });
  assert.equal((await run()).status, "completed");
  assert.equal((await run()).status, "completed");
  assert.equal(reads, 2 * Object.keys(SKILL_ROLES).length);
});

test("the run log names the version of the instruction and of each skill", async () => {
  const w = await world();
  const flow = createAssistantFlow({ modelClient: textClient(), getDataRoot: () => w.root, getClients: () => w.clients, fetchSkill: diskFetch });
  const result = await flow.run({ message: "x", ui: recordingUi(), signal: new AbortController().signal });
  const path = (await listPaths(w.root)).find((item) => item.startsWith("common/agent-runs/"));
  const log = JSON.parse(new TextDecoder().decode(await readFileBytes(w.root, path)));
  assert.equal(log.runId, result.runId);
  assert.deepEqual(log.agent, { version: "base-2026-10-26a", skills: { "invoice-extraction": 2, classification: 4, "periods-and-duplicates": 2, "pcn-allocation": 1, "month-closing-checklist": 1 } });
  assert.ok(Array.isArray(log.entries));
});
