import test from "node:test";
import assert from "node:assert/strict";
import { normaliseCustomMapping, normaliseCustomMappingMetadata, normaliseForm6111Mappings } from "../custom-rivhit-mapping.js";

test("сохраняет только новые трёхзначные пользовательские коды", () => {
  assert.deepEqual(normaliseCustomMapping({ codes: { "830": "טלפון נייד", "811": "Нельзя", "x": "Плохой", "831": "" } }, { "811": "הוצאות משרדיות" }), { "830": "טלפון נייד" });
});
test("сохраняет метаданные только валидных пользовательских кодов", () => {
  assert.deepEqual(normaliseCustomMappingMetadata({ codes: { "830": "טלפון" }, metadata: { "830": { createdAt: "2026-09-13T12:00:00.000Z" } } }, {}), { "830": { createdAt: "2026-09-13T12:00:00.000Z" } });
});
test("сохраняет связь 6111 только с существующим общим кодом", () => {
  assert.deepEqual(normaliseForm6111Mappings({ form6111Mappings: { "3030": "830", "x": "830", "3090": "999" } }, { "830": "טלפון" }), { "3030": "830" });
});
