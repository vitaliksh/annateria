// The original of an imported row: found in the client's imports/ by its SHA-256 and drawn as a plain table.
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { sha256Hex } from "../inbox-store.js";
import { findImportFile, renderNote, renderSheets, sheetTexts } from "../source-view.js";
import { binaryDirectory, putFile } from "./memory-binary-directory.mjs";

const bytes = (text) => new TextEncoder().encode(text);

test("the original is found by its hash, also under another name; a missing folder or file gives null", async () => {
  const client = binaryDirectory("Client");
  assert.equal(await findImportFile(client, "0".repeat(64)), null, "no imports folder yet");
  await putFile(client, "imports/8.xlsx", bytes("first"));
  await putFile(client, "imports/8 (2).xlsx", bytes("second"));
  const found = await findImportFile(client, await sha256Hex(bytes("second")));
  assert.equal(found.name, "8 (2).xlsx");
  assert.equal(await findImportFile(client, await sha256Hex(bytes("other"))), null);
});

test("the sheets are read as the texts Excel shows; empty sheets and empty rows are left out", async () => {
  const sheets = { "גיליון2": { "!ref": "A1:B3" }, "גיליון1": {} };
  const XLSX = {
    read: () => ({ SheetNames: ["גיליון2", "גיליון1"], Sheets: sheets }),
    utils: { sheet_to_json: () => [["תאריך", "סכום"], ["", ""], ["09/07/26", 28931.18]] },
  };
  const read = await sheetTexts({ arrayBuffer: async () => new ArrayBuffer(1) }, { loadLibrary: async () => XLSX });
  assert.deepEqual(read, [{ name: "גיליון2", rows: [["תאריך", "סכום"], ["09/07/26", "28931.18"]] }]);
});

test("the table is drawn right to left as text only, every row as wide as the widest", () => {
  const { document } = new JSDOM("<!doctype html><body></body>").window;
  renderSheets(document, "מקור Excel: 8.xlsx", [{ name: "גיליון2", rows: [["<b>x</b>", "1"], ["2"]] }]);
  assert.equal(document.documentElement.dir, "rtl");
  assert.equal(document.querySelector("h1").textContent, "מקור Excel: 8.xlsx");
  const cells = [...document.querySelectorAll("tr")].map((tr) => [...tr.children].map((td) => td.textContent));
  assert.deepEqual(cells, [["<b>x</b>", "1"], ["2", ""]]);
  assert.equal(document.querySelector("b"), null, "the text of a cell is never HTML");
  renderNote(document, "מקור Excel", "לא נמצא");
  assert.equal(document.body.textContent, "לא נמצא");
});
