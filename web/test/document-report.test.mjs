import test from "node:test";
import assert from "node:assert/strict";
import { documentFieldValues, documentReportItems, readRowOriginal, renderDocumentReport } from "../document-report.js";
import { binaryDirectory, putFile } from "./memory-binary-directory.mjs";

const values = (overrides = {}) => {
  const base = ["20/10/26", "217", "Car licence", "Ministry", "500100200", "1804", "", "2076.00", "2076.00", "0.00", "0", "100"];
  for (const [index, value] of Object.entries(overrides)) base[index] = value;
  return base;
};

test("documents report: the active rows of the months of the period, month by month, with their number in the table", () => {
  const declarations = [
    { month: "2026-11", rows: [{ active: true, values: values({ 3: "Later" }) }] },
    { month: "2026-10", rows: [{ active: true, values: values({ 3: "A" }) }, { active: false, values: values({ 3: "Off" }) }, { active: true, values: values({ 3: "B" }) }] },
    { month: "2026-09", rows: [{ active: true, values: values({ 3: "Sep" }) }] },
  ];
  const items = documentReportItems(declarations, "2026-09", "2026-10");
  assert.deepEqual(items.map((item) => [item.month, item.position, item.row.values[3]]), [["2026-09", 1, "Sep"], ["2026-10", 1, "A"], ["2026-10", 3, "B"]]);
  assert.deepEqual(documentReportItems(declarations, "2026-12", "2026-12"), []);
});

test("documents report: the fields show the full reference, the name of the account and a dash for an empty value", () => {
  const fields = documentFieldValues({ values: values(), reference: "100200301804" }, { 217: { name: "Car" } });
  assert.deepEqual(fields.map(([label]) => label), [
    "תאריך", "ספק", "מס׳ מסמך", "כולל מע״מ", "מע״מ", "פרטים", "קוד מיון", "ע.מ./ת.ז", "מספר הקצאה", "ללא מע״מ", "% מוכר מע״מ", "% מוכר כהוצאה",
  ]);
  const byLabel = Object.fromEntries(fields);
  assert.equal(byLabel["מס׳ מסמך"], "100200301804");
  assert.equal(byLabel["קוד מיון"], "217 · Car");
  assert.equal(byLabel["מספר הקצאה"], "—");
  assert.equal(Object.fromEntries(documentFieldValues({ values: values() }))["מס׳ מסמך"], "1804");
});

test("documents report: the original of a row is read from the images of its month; none or a missing file is null", async () => {
  const client = binaryDirectory("client");
  await putFile(client, "declarations/2026-10/images/002.pdf", new TextEncoder().encode("%PDF-scan"));
  const original = await readRowOriginal(client, "2026-10", { imageFile: "002.pdf" });
  assert.equal(new TextDecoder().decode(await original.arrayBuffer()), "%PDF-scan");
  assert.equal(await readRowOriginal(client, "2026-10", { imageFile: "" }), null);
  assert.equal(await readRowOriginal(client, "2026-10", { imageFile: "009.jpg" }), null);
  assert.equal(await readRowOriginal(client, "2026-03", { imageFile: "001.jpg" }), null);
});

test("documents report: an empty period is refused before anything is drawn", async () => {
  await assert.rejects(renderDocumentReport({ clientName: "X", items: [], readOriginal: async () => null }), /אין מסמכים/);
});
