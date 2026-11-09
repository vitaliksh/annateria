// "צילום חדש" on a row (the owner, 9 November 2026): retake-flow.js.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRecord } from "../agent/fact-record.js";
import { pickRecord, recordFacts, rowFacts, saveRetakeImage } from "../retake-flow.js";
import { rawRecord } from "./agent-fixtures.mjs";
import { binaryDirectory, listPaths, putFile } from "./memory-binary-directory.mjs";

const blankRow = { values: ["", "202", "x", "Paper Shop", "512345679", "2002", "", "", "", "", "100", "100"], rawNet: "", rawVat: "", reference: "INV-2002", unreadable: ["amounts", "date"] };

test("a new photo is read into the row's facts, with what it still cannot read left empty", () => {
  const read = recordFacts(normalizeRecord(rawRecord()));
  assert.deepEqual([read.date, read.supplier, read.reference, read.gross, read.vat, read.unreadable], ["20/02/26", "Paper Shop", "INV-2002", "236.00", "36.00", []]);
  const stillBad = recordFacts(normalizeRecord(rawRecord({ issues: ["amount_unclear"] })));
  assert.deepEqual([stillBad.gross, stillBad.vat, stillBad.unreadable], ["", "", ["amounts"]], "a new photo that is still unreadable gives no guess either");
  const poor = recordFacts(normalizeRecord(rawRecord({ confidence: 40 })));
  assert.deepEqual([poor.date, poor.gross, poor.unreadable], ["", "", ["amounts", "date"]], "a reading below the line fills nothing");
  assert.deepEqual([rowFacts(blankRow).gross, rowFacts(blankRow).date], ["", ""]);
});

test("of several documents in the new photo, the one with the row's number, else the nearest total, is taken", () => {
  const a = normalizeRecord(rawRecord({ document_number: "X-1", total: 50, net: 42.37, vat: 7.63 }));
  const b = normalizeRecord(rawRecord({ document_number: "INV-2002" }));
  assert.equal(pickRecord([a, b], rowFacts(blankRow)), b);
  assert.equal(pickRecord([a], { reference: "", gross: "50.00" }), a);
  assert.equal(pickRecord([], rowFacts(blankRow)), null);
});

test("the new photo is the next original of the month; the old one stays", async () => {
  const month = binaryDirectory("2026-09");
  await putFile(month, "images/001.jpg", "old photo");
  const saved = await saveRetakeImage(month, new File(["new photo"], "IMG_2.JPG", { type: "image/jpeg" }));
  assert.deepEqual(saved, { imageFile: "002.jpg", imageIndex: 2 });
  assert.deepEqual(await listPaths(month), ["images/001.jpg", "images/002.jpg"]);
});
