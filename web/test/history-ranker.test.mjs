import test from "node:test";
import assert from "node:assert/strict";
import { relevantHistory } from "../history-ranker.js";

const row = (supplier, supplierId, classification, purpose) => ({ values: ["2026-09-01", classification, purpose, supplier, supplierId, "", "", "", "", "", "100", "100"] });
test("ранжирует совпадающего поставщика выше классификации", () => {
  const result = relevantHistory(row("Apple", "123", "812", "Cloud service"), [row("Other", "999", "812", "Cloud service"), row("Apple", "123", "811", "Device")]);
  assert.equal(result.length, 2); assert.equal(result[0].supplier, "Apple");
});
test("никогда не передаёт изображения и исходные суммы в контекст", () => {
  const history = [{ ...row("Apple", "123", "812", "Cloud service"), imageFile: "private.jpg", rawNet: "100", rawVat: "18" }], result = relevantHistory(row("Apple", "123", "812", "Cloud service"), history);
  assert.deepEqual(Object.keys(result[0]).sort(), ["agentOpinion", "classification", "confidence", "declarationMonth", "purpose", "recognizedPercent", "supplier", "supplierVatId", "vatRecognizedPercent"].sort());
});
