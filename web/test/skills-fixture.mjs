// The skills as the page gets them, but read from disk: web/skills/<name>/SKILL.md.
import { readFile } from "node:fs/promises";
import { instructionFor, loadSkills } from "../agent/skills.js";

export const SKILLS_DIR = new URL("../skills/", import.meta.url);
export const diskFetch = (name) => readFile(new URL(`${name}/SKILL.md`, SKILLS_DIR), "utf8");
export const diskSkills = () => loadSkills(diskFetch);
export const orchestratorInstruction = async () => instructionFor("orchestrator", await diskSkills());
export const extractionInstruction = async () => instructionFor("extraction", await diskSkills());
