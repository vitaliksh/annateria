import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { ALLOWED_MODELS } from "../../worker/src/model.js";
import { MODEL_CHOICES, MODEL_ROLES, MODELS, chosenModels, normaliseModelOverrides } from "../agent/models.js";
import { createAssistantFlow } from "../assistant-flow.js";
import { setupModelSettings } from "../model-settings-ui.js";
import { normaliseUiSettings, readUiSettings, saveUiSettings } from "../ui-settings.js";
import { call, rawRecord, recordingUi, world } from "./agent-fixtures.mjs";
import { memoryDirectory } from "./memory-directory.mjs";
import { diskFetch } from "./skills-fixture.mjs";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test("the models offered in the settings are exactly the models the Worker accepts, and the defaults are among them", () => {
  assert.deepEqual(MODEL_CHOICES.map((choice) => choice.id).sort(), [...ALLOWED_MODELS].sort());
  for (const role of MODEL_ROLES) assert.ok(ALLOWED_MODELS.includes(MODELS[role]), role);
  assert.deepEqual([...MODEL_ROLES], Object.keys(MODELS));
});

test("overrides keep only known roles with known ids; the models in force are the defaults under the choices", () => {
  assert.deepEqual(normaliseModelOverrides(null), {});
  assert.deepEqual(normaliseModelOverrides({ orchestrator: "gemini-3.5-flash-lite", extraction: "gemini-9", strong: 5, other: "gemini-4-argon" }), { orchestrator: "gemini-3.5-flash-lite" });
  assert.deepEqual(chosenModels({ strong: "gemini-3.6-flash" }), { ...MODELS, strong: "gemini-3.6-flash" });
  assert.deepEqual(chosenModels(undefined), { ...MODELS });
});

test("ui settings keep the model choices next to the other fields and drop what is not valid", async () => {
  assert.deepEqual(normaliseUiSettings(null).models, {});
  assert.deepEqual(normaliseUiSettings({ models: { extraction: "gemini-3.1-pro-preview", strong: "nope" } }).models, { extraction: "gemini-3.1-pro-preview" });
  const root = memoryDirectory("root");
  await saveUiSettings(root, { folderPath: "D:\\data" });
  await saveUiSettings(root, { models: { orchestrator: "gemini-3.6-flash" } });
  await saveUiSettings(root, { hiddenColumns: [] });
  const settings = await readUiSettings(root);
  assert.deepEqual([settings.models, settings.folderPath, settings.hiddenColumns], [{ orchestrator: "gemini-3.6-flash" }, "D:\\data", []]);
});

function settingsPage({ withRoot = true, save } = {}) {
  const { window } = new JSDOM(html, { url: "https://vitaliksh.github.io/annateria/" });
  const dialog = window.document.querySelector("#settings-dialog");
  const root = memoryDirectory("root");
  const changes = [], errors = [];
  const settings = setupModelSettings({ container: dialog, getDataRoot: () => (withRoot ? root : null), onChange: (models) => changes.push(models), onError: (message) => errors.push(message), ...(save ? { save } : {}) });
  const select = (role) => dialog.querySelector(`#model-${role}`);
  const choose = async (role, value) => { select(role).value = value; select(role).dispatchEvent(new window.Event("change")); await tick(); };
  return { settings, select, choose, root, changes, errors };
}

test("the settings page has a select for each role with every model, the default marked", () => {
  const { select } = settingsPage();
  for (const role of MODEL_ROLES) {
    const options = [...select(role).options];
    assert.deepEqual(options.map((option) => option.value), MODEL_CHOICES.map((choice) => choice.id));
    assert.equal(options.filter((option) => option.textContent.includes("(ברירת מחדל)")).length, 1);
    assert.equal(select(role).value, MODELS[role]);
    assert.ok(options.find((option) => option.value === MODELS[role]).textContent.endsWith("(ברירת מחדל)"));
    assert.ok(options.every((option) => option.textContent.includes(option.value)), "the id is shown");
  }
});

test("a choice is saved in the data root, reported, and survives opening the data root again", async () => {
  const { choose, root, changes, settings } = settingsPage();
  await choose("extraction", "gemini-3.1-pro-preview");
  assert.deepEqual(changes.at(-1), { ...MODELS, extraction: "gemini-3.1-pro-preview" });
  assert.deepEqual((await readUiSettings(root)).models, { extraction: "gemini-3.1-pro-preview" });
  assert.equal(settings.getModels().extraction, "gemini-3.1-pro-preview");
  const again = settingsPage();
  again.settings.setOverrides((await readUiSettings(root)).models);
  assert.equal(again.select("extraction").value, "gemini-3.1-pro-preview");
  assert.equal(again.select("orchestrator").value, MODELS.orchestrator);
});

test("choosing the default again removes the override, so a changed default reaches the user", async () => {
  const { choose, root } = settingsPage();
  await choose("orchestrator", "gemini-3.5-flash-lite");
  await choose("strong", "gemini-3.6-flash");
  await choose("orchestrator", MODELS.orchestrator);
  assert.deepEqual((await readUiSettings(root)).models, { strong: "gemini-3.6-flash" });
});

test("without a data root nothing can be chosen; a failed save is reported and the select goes back", async () => {
  const none = settingsPage({ withRoot: false });
  for (const role of MODEL_ROLES) assert.equal(none.select(role).disabled, true);
  await none.choose("orchestrator", "gemini-3.5-flash-lite");
  assert.deepEqual([none.changes, none.select("orchestrator").value], [[], MODELS.orchestrator]);

  const failing = settingsPage({ save: async () => { throw new Error("disk full"); } });
  await failing.choose("strong", "gemini-3.6-flash");
  assert.match(failing.errors[0], /לא ניתן לשמור את בחירת המודל: disk full/);
  assert.equal(failing.select("strong").value, MODELS.strong);
  assert.deepEqual(failing.changes, []);
});

test("an unknown value in the file is ignored by the page", () => {
  const { settings, select } = settingsPage();
  settings.setOverrides({ orchestrator: "gemini-0", extraction: "gemini-3.5-flash-lite" });
  assert.deepEqual([select("orchestrator").value, select("extraction").value], [MODELS.orchestrator, "gemini-3.5-flash-lite"]);
});

test("the flow asks for the models of every run: a change in the settings reaches the next run, for the assistant and for reading documents", async () => {
  const w = await world();
  let models = { ...MODELS };
  const used = [];
  const modelClient = {
    generate: async ({ model, request }) => {
      if (request.generationConfig.responseMimeType) {
        used.push(["extraction", model]);
        return { candidates: [{ content: { parts: [{ text: JSON.stringify({ documents: [rawRecord()] }) }] } }] };
      }
      used.push(["assistant", model]);
      const answers = request.contents.at(-1).parts.filter((part) => part.functionResponse).map((part) => part.functionResponse);
      const listed = answers.find((item) => item.name === "list_inbox");
      const extracted = answers.find((item) => item.name === "extract_document");
      const parts = extracted ? [{ text: "done" }] : listed ? [call("extract_document", { file: listed.response.files.find((file) => file.kind === "image").file })] : [call("list_inbox")];
      return { candidates: [{ content: { parts } }] };
    },
  };
  const flow = createAssistantFlow({ modelClient, getDataRoot: () => w.root, getClients: () => w.clients, getModels: () => models, fetchSkill: diskFetch });
  const run = () => flow.run({ message: "x", ui: recordingUi(), signal: new AbortController().signal });
  assert.equal((await run()).status, "completed");
  models = { orchestrator: "gemini-3.5-flash-lite", extraction: "gemini-3.6-flash", strong: MODELS.strong };
  assert.equal((await run()).status, "completed");
  assert.deepEqual(used, [
    ["assistant", MODELS.orchestrator], ["assistant", MODELS.orchestrator], ["extraction", MODELS.extraction], ["assistant", MODELS.orchestrator],
    ["assistant", "gemini-3.5-flash-lite"], ["assistant", "gemini-3.5-flash-lite"], ["extraction", "gemini-3.6-flash"], ["assistant", "gemini-3.5-flash-lite"],
  ]);
});
