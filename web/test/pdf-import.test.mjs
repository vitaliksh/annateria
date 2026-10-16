import test from "node:test";
import assert from "node:assert/strict";
import { validatePdfFile } from "../pdf-import.js";

test("принимает непустой PDF", () => {
  assert.doesNotThrow(() => validatePdfFile({ name: "invoices.pdf", type: "application/pdf", size: 10 }));
});

test("отклоняет пустой, слишком большой и не-PDF файл", () => {
  assert.throws(() => validatePdfFile({ name: "empty.pdf", type: "application/pdf", size: 0 }), /ריק/);
  assert.throws(() => validatePdfFile({ name: "big.pdf", type: "application/pdf", size: 51 * 1024 * 1024 }), /50MB/);
  assert.throws(() => validatePdfFile({ name: "invoice.jpg", type: "image/jpeg", size: 10 }), /PDF/);
});
