// The skills of the agent (step 5.1): web/skills/<name>/SKILL.md in the Agent Skills format (frontmatter with name, description and
// metadata.version, then the text). The page fetches them from its own site at the start of every run, so Ctrl+F5 updates them; if one
// cannot be read the run does not start (no running on part of the rules). docs/AGENT_TOOLS.md, section 2.
import { BASE_PROMPT } from "./prompts.js";

// The closed list: a skill file that is not here is never loaded. role: which model call the text goes into. The vision call of
// extract_document gets only the extraction skill (its text says "you only read"); the orchestrator gets the base prompt and the others.
export const SKILL_ROLES = {
  "invoice-extraction": "extraction",
  classification: "orchestrator",
  "periods-and-duplicates": "orchestrator",
  "pcn-allocation": "orchestrator",
};

export class SkillsUnavailableError extends Error {
  // missing: [{ name, reason }]
  constructor(missing) {
    super(`Skills could not be loaded: ${missing.map((item) => `${item.name} (${item.reason})`).join(", ")}`);
    this.name = "SkillsUnavailableError";
    this.code = "skills_unavailable";
    this.missing = missing;
  }
}

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

// Reads one SKILL.md. The frontmatter is the small part of YAML that the format needs: `name:`, `description:` and
// `metadata:` with an indented `version:` (a positive integer). Anything else is refused, so a typo cannot pass quietly.
export function parseSkill(raw, folder) {
  const text = String(raw).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const match = FRONTMATTER.exec(text);
  if (!match) throw new Error("no frontmatter between --- lines");
  const top = {};
  const metadata = {};
  let inMetadata = false;
  for (const line of match[1].split("\n")) {
    const nested = /^ {2}([a-z-]+): (.+)$/.exec(line);
    const key = /^([a-z-]+):(?: (.*))?$/.exec(line);
    if (inMetadata && nested) {
      metadata[nested[1]] = nested[2].trim();
    } else if (key && ["name", "description", "metadata"].includes(key[1]) && !(key[1] in top)) {
      inMetadata = key[1] === "metadata";
      top[key[1]] = (key[2] ?? "").trim();
    } else {
      throw new Error(`unexpected frontmatter line: ${line}`);
    }
  }
  if (!NAME.test(top.name ?? "") || top.name.length > 64) throw new Error("name must be lowercase letters, digits and single hyphens, at most 64");
  if (top.name !== folder) throw new Error(`name ${top.name} differs from the folder ${folder}`);
  if (!top.description || top.description.length > 1024) throw new Error("description must be 1 to 1024 characters");
  if (/: | #|^["'\[{>|&*!%@`-]/.test(top.description)) throw new Error("description must be a plain YAML value (no \": \", \" #\" or leading indicator)");
  if (!/^[1-9]\d*$/.test(metadata.version ?? "")) throw new Error("metadata.version must be a positive integer");
  if (Object.keys(metadata).some((name) => name !== "version")) throw new Error("metadata may hold only version");
  const body = match[2].trim();
  if (!body) throw new Error("the skill has no text");
  return { name: top.name, description: top.description, version: Number(metadata.version), body };
}

// fetchText(name) -> the text of that skill's SKILL.md. Resolves with { <name>: { name, description, version, body, role } } for the whole
// closed list, or rejects with SkillsUnavailableError naming every skill that failed.
export async function loadSkills(fetchText, names = Object.keys(SKILL_ROLES)) {
  const results = await Promise.all(names.map(async (name) => {
    try {
      return { name, skill: { ...parseSkill(await fetchText(name), name), role: SKILL_ROLES[name] } };
    } catch (error) {
      return { name, reason: error?.message ?? String(error) };
    }
  }));
  const failed = results.filter((result) => !result.skill);
  if (failed.length) throw new SkillsUnavailableError(failed.map(({ name, reason }) => ({ name, reason })));
  return Object.fromEntries(results.map((result) => [result.name, result.skill]));
}

// From the site the page was loaded from; "no-cache" makes the browser ask the server whether the file changed (Ctrl+F5 not needed
// for a skill, but it is for the page's own scripts).
export async function fetchSkillFromSite(name, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`skills/${name}/SKILL.md`, { cache: "no-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

const ofRole = (skills, role) => Object.values(skills).filter((skill) => skill.role === role);

// The system instruction of one kind of model call.
export function instructionFor(role, skills) {
  const own = ofRole(skills, role);
  if (role === "extraction") return own.map((skill) => skill.body).join("\n\n");
  return [BASE_PROMPT, ...own.map((skill) => `SKILL ${skill.name}\n\n${skill.body}`)].join("\n\n");
}

// { name: version } of every skill that was loaded, written into every row of the run.
export const skillVersions = (skills) => Object.fromEntries(Object.values(skills).map((skill) => [skill.name, skill.version]));
