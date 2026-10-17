// clients/<client>/aliases.json (step 4.6.2): the buyers printed on documents that the user confirmed as this client, by ticking the box
// of the question "which client?" and choosing the client. The agent only reads it (services.clients.aliases) and the code accepts a match
// as routing proof (add_rows, routed_by alias). Only the page writes it: an alias is added at the user's click, and the user removes one
// from the client card (marked `removedAt`, kept in the file). A damaged or newer file gives no aliases and is never overwritten.
import { aliasDigits, sameBuyer } from "./client-alias.js";

const ALIASES_FILE = "aliases.json";
const SCHEMA_VERSION = 1;

async function readFile(clientDirectory) {
  let text;
  try {
    text = await (await (await clientDirectory.getFileHandle(ALIASES_FILE)).getFile()).text();
  } catch (error) {
    if (error.name === "NotFoundError") return { schemaVersion: SCHEMA_VERSION, aliases: [] };
    throw error;
  }
  try {
    const value = JSON.parse(text);
    if (value?.schemaVersion === SCHEMA_VERSION && Array.isArray(value.aliases)) return value;
  } catch {
    // damaged: below
  }
  return null;
}

async function writeFile(clientDirectory, value) {
  const writable = await (await clientDirectory.getFileHandle(ALIASES_FILE, { create: true })).createWritable();
  try {
    await writable.write(`${JSON.stringify(value, null, 2)}\n`);
  } finally {
    await writable.close();
  }
}

// { aliases: [{ index, vatId, name, addedAt }] } of the aliases in force (index: the place in the file, for removing), and `damaged`
// when the file cannot be read (then there are no aliases).
export async function readAliases(clientDirectory) {
  const file = await readFile(clientDirectory);
  if (!file) return { aliases: [], damaged: true };
  const aliases = file.aliases
    .map((alias, index) => ({ index, vatId: aliasDigits(alias?.vatId), name: typeof alias?.name === "string" ? alias.name : "", addedAt: alias?.addedAt ?? "", removedAt: alias?.removedAt }))
    .filter((alias) => !alias.removedAt && (alias.vatId || alias.name))
    .map(({ removedAt, ...alias }) => alias);
  return { aliases, damaged: false };
}

// Adds { vatId, name } unless the same buyer is already in force. Resolves with { added }.
export async function addAlias(clientDirectory, buyer, { now = new Date().toISOString() } = {}) {
  const vatId = aliasDigits(buyer?.vatId);
  const name = String(buyer?.name ?? "").trim();
  if (!vatId && !name) throw new Error("אין מספר או שם לזכור.");
  const file = await readFile(clientDirectory);
  if (!file) throw new Error("הקובץ aliases.json של הלקוח פגום; הוא לא שונה.");
  if (file.aliases.some((alias) => !alias?.removedAt && sameBuyer(alias, { vatId, name }))) return { added: false };
  await writeFile(clientDirectory, { ...file, aliases: [...file.aliases, { vatId, name, addedAt: now }] });
  return { added: true };
}

// The user's removal from the client card: the alias stays in the file with `removedAt` and no longer counts.
export async function removeAlias(clientDirectory, index, { now = new Date().toISOString() } = {}) {
  const file = await readFile(clientDirectory);
  if (!file) throw new Error("הקובץ aliases.json של הלקוח פגום; הוא לא שונה.");
  const alias = file.aliases[index];
  if (!alias || alias.removedAt) return { removed: false };
  const aliases = file.aliases.map((item, position) => (position === index ? { ...item, removedAt: now } : item));
  await writeFile(clientDirectory, { ...file, aliases });
  return { removed: true };
}
