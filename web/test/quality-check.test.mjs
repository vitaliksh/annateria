// The look at the photos before the agent reads them (the owner, 9 November 2026).
import test from "node:test";
import assert from "node:assert/strict";
import { BLURRED_BELOW, poorPages, poorPagesText, sharpness } from "../quality-check.js";

// A page of black text lines on white, then the same page smeared.
function page(width = 120, height = 80, smear = 0) {
  const gray = new Float32Array(width * height).fill(255);
  for (let y = 10; y < height; y += 8) for (let x = 10; x < width - 10; x += 1) if ((x >> 2) % 2 === 0) gray[y * width + x] = 0;
  if (!smear) return gray;
  let out = gray;
  for (let pass = 0; pass < smear; pass += 1) {
    const next = new Float32Array(out.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < height && xx >= 0 && xx < width) { sum += out[yy * width + xx]; count += 1; }
        }
        next[y * width + x] = sum / count;
      }
    }
    out = next;
  }
  return out;
}

test("a sharp page of text measures far above the line, the same page smeared far below it", () => {
  const sharp = sharpness(page(), 120, 80);
  const smeared = sharpness(page(120, 80, 12), 120, 80);
  assert.ok(sharp > BLURRED_BELOW * 10, `sharp ${sharp}`);
  assert.ok(smeared < BLURRED_BELOW, `smeared ${smeared}`);
  assert.equal(sharpness(new Float32Array(9).fill(128), 3, 3), 0, "a blank page has no edges");
});

test("only the blurred or tiny pages are named; a file that cannot be measured is not judged", async () => {
  const measure = async () => [{ page: 1, score: 900, small: false }, { page: 2, score: 12, small: false }, { page: 3, score: 300, small: false }];
  assert.deepEqual(await poorPages({}, "application/pdf", { measure }), [{ page: 2, reason: "blurred" }]);
  assert.deepEqual(await poorPages({}, "image/jpeg", { measure: async () => [{ page: null, score: 500, small: true }] }), [{ page: null, reason: "small" }]);
  assert.deepEqual(await poorPages({}, "image/heic", { measure }), [], "HEIC is left to the reading");
  assert.deepEqual(await poorPages({}, "image/jpeg", { measure: async () => { throw new Error("broken"); } }), []);
});

test("the question before the run names the files and their pages", () => {
  const text = poorPagesText([{ name: "sep.pdf", pages: [{ page: 15, reason: "blurred" }] }, { name: "IMG_1.jpg", pages: [{ page: null, reason: "blurred" }] }, { name: "oct.pdf", pages: [{ page: 2 }, { page: 5 }] }]);
  assert.equal(text, "צילום לא ברור – כדאי לצלם מחדש: «sep.pdf» (עמוד 15); «IMG_1.jpg»; «oct.pdf» (עמודים 2, 5). לקרוא בכל זאת?");
});
