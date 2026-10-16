// Loads the data the reports need from a client folder: all declarations and the per-client report settings.
import { listDeclarations, loadDeclaration } from "./declaration-store.js";

const settingsFile = "report-settings.json";
export const DEFAULT_REPORT_SETTINGS = Object.freeze({ vatPeriod: "monthly", advancePercent: null });

export function normaliseReportSettings(value) {
  const percent = Number(value?.advancePercent);
  return {
    vatPeriod: value?.vatPeriod === "bimonthly" ? "bimonthly" : "monthly",
    advancePercent: value?.advancePercent !== null && value?.advancePercent !== "" && percent >= 0 && percent <= 100 ? percent : null,
  };
}

export async function readReportSettings(clientDirectory) {
  try {
    const file = await (await clientDirectory.getFileHandle(settingsFile)).getFile();
    return normaliseReportSettings(JSON.parse(await file.text()));
  } catch (error) {
    if (error.name === "NotFoundError") return { ...DEFAULT_REPORT_SETTINGS };
    throw error;
  }
}

export async function saveReportSettings(clientDirectory, settings) {
  const normalised = normaliseReportSettings(settings);
  const writable = await (await clientDirectory.getFileHandle(settingsFile, { create: true })).createWritable();
  try {
    await writable.write(JSON.stringify({ schemaVersion: 1, ...normalised }, null, 2));
  } finally {
    await writable.close();
  }
  return normalised;
}

// Every declaration of the client, archived ones included, as { month, status, rows } for reportEntries.
export async function loadReportDeclarations(clientDirectory) {
  const result = [];
  for (const { declaration } of await listDeclarations(clientDirectory)) {
    const { draft } = await loadDeclaration(clientDirectory, declaration.month);
    result.push({ month: declaration.month, status: declaration.status, rows: draft.rows });
  }
  return result.sort((a, b) => a.month.localeCompare(b.month));
}
