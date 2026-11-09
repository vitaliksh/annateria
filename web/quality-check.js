// A look at the photos of the inbox before the agent reads them (the owner, 9 November 2026): a page that is too blurred to read, or
// a photo far too small, is named before the run, and the user chooses to retake it or to read it as it is. Code only, no model.
// The measure is the variance of a Laplacian on the page drawn 600 points wide. Calibrated on client B's real scans (8 November
// 2026): every page of the two months, a slightly blurred till receipt included, gave 157 to 3,310; copies blurred until unreadable
// gave 1 to 27. So only a page below 60 is named: a false alarm on a good scan costs the user's trust more than a late one.
import { loadPdfJs } from "./pdf-import.js";

export const MEASURE_WIDTH = 600;
export const BLURRED_BELOW = 60;
export const SMALL_BELOW = 400; // the longer side of a photo, in pixels

// gray: luminance values row by row (0-255), width x height. Every second pixel of every second row, as in the calibration.
export function sharpness(gray, width, height) {
  let sum = 0;
  let squares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const at = y * width + x;
      const value = 4 * gray[at] - gray[at - 1] - gray[at + 1] - gray[at - width] - gray[at + width];
      sum += value;
      squares += value * value;
      count += 1;
    }
  }
  if (!count) return 0;
  const mean = sum / count;
  return squares / count - mean * mean;
}

const grayOf = (data) => {
  const gray = new Float32Array(data.length / 4);
  for (let index = 0; index < gray.length; index += 1) {
    gray[index] = 0.299 * data[index * 4] + 0.587 * data[index * 4 + 1] + 0.114 * data[index * 4 + 2];
  }
  return gray;
};

function measureCanvas(canvas) {
  const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  return sharpness(grayOf(data), canvas.width, canvas.height);
}

async function imageScores(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = MEASURE_WIDTH;
    canvas.height = Math.max(3, Math.round((bitmap.height * MEASURE_WIDTH) / bitmap.width));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return [{ page: null, score: measureCanvas(canvas), small: Math.max(bitmap.width, bitmap.height) < SMALL_BELOW }];
  } finally {
    bitmap.close?.();
  }
}

async function pdfScores(file) {
  const library = await loadPdfJs();
  const pdf = await library.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const scores = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: MEASURE_WIDTH / natural.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport, intent: "print" }).promise;
      scores.push({ page: number, score: measureCanvas(canvas), small: false });
      canvas.width = canvas.height = 0;
      page.cleanup?.();
    }
    return scores;
  } finally {
    await pdf.destroy?.();
  }
}

// The pages of one file that should be retaken: [{ page, reason: "blurred" | "small" }] (page null for a photo). A file that cannot be
// measured (HEIC, a broken file) is not judged: the reading decides.
export async function poorPages(file, type, { measure = type === "application/pdf" ? pdfScores : imageScores } = {}) {
  if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(type)) return [];
  let scores;
  try {
    scores = await measure(file);
  } catch {
    return [];
  }
  return scores.flatMap(({ page, score, small }) => (small ? [{ page, reason: "small" }] : score < BLURRED_BELOW ? [{ page, reason: "blurred" }] : []));
}

// The question before the run, for the files with poor pages: [{ name, pages: [{ page, reason }] }].
export function poorPagesText(found) {
  const lines = found.map(({ name, pages }) => {
    const numbers = pages.filter((item) => item.page).map((item) => item.page);
    const where = numbers.length === 1 ? ` (עמוד ${numbers[0]})` : numbers.length ? ` (עמודים ${numbers.join(", ")})` : "";
    return `«${name}»${where}`;
  });
  return `צילום לא ברור – כדאי לצלם מחדש: ${lines.join("; ")}. לקרוא בכל זאת?`;
}
