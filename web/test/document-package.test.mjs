import test from "node:test";
import assert from "node:assert/strict";
import { jpegPagesToPdf, makePackageManifest, makeSourceText, packageDateParts } from "../document-package.js";
import { buildPdfReport } from "../pdf-report.js";

test("имя месяца и пакета основано на локальной дате", () => {
  assert.deepEqual(packageDateParts(new Date(2026, 8, 9)), { monthName: "2026-09", dayName: "2026-09-09" });
});

test("манифест хранит данные клиента, маркеры и путь к изображению", () => {
  const highlights = [{ field: "total_amount", box_2d: [10, 20, 30, 40] }], result = makePackageManifest({ client: { clientId: "a", clientName: "Клиент", businessActivity: "спорт", businessKind: "home" }, createdAt: new Date("2026-09-09T10:00:00Z"), rows: [{ imageFile: "001.jpg", imageType: "image/jpeg", values: [], highlights }] });
  assert.equal(result.schemaVersion, 1); assert.equal(result.rows[0].image.file, "images/001.jpg"); assert.equal(result.client.clientName, "Клиент"); assert.deepEqual(result.rows[0].highlights, highlights);
});

test("текстовый экспорт экранирует табуляции и переводы строк", () => {
  assert.match(makeSourceText([{ values: ["строка\tс табом", "две\nстроки"] }]), /строка с табом\tдве строки/);
});

test("PDF содержит заголовок, объекты страниц и xref", () => {
  const result = jpegPagesToPdf([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 100, 100), text = new TextDecoder().decode(result);
  assert.match(text, /^%PDF-1\.4/); assert.match(text, /\/Subtype \/Image/); assert.match(text, /xref/); assert.match(text, /%%EOF$/);
});

test("PDF может хранить изображение с большей плотностью, чем размер страницы", () => {
  const text = new TextDecoder().decode(jpegPagesToPdf([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 200, 300, 100, 150));
  assert.match(text, /\/Width 200 \/Height 300/); assert.match(text, /\/MediaBox \[0 0 100 150\]/);
});

test("PDF-отчёт рисует зелёные и жёлтые полупрозрачные маркеры без рамки", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../pdf-report.js", import.meta.url), "utf8"));
  const highlightFunction = source.slice(source.indexOf("function drawHighlights"), source.indexOf("// Each selected record"));
  assert.match(highlightFunction, /rgba\(64, 185, 90, 0\.42\)/); assert.match(highlightFunction, /rgba\(255, 232, 77, 0\.48\)/); assert.doesNotMatch(highlightFunction, /stroke|ellipse/);
  assert.equal(typeof buildPdfReport, "function");
});
