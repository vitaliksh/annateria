// Step 9.3, "one lock" (owner, 1 November 2026): every month is closed unless the user has just opened it. One sweep goes through
// every client folder of the data root and closes every open month but the one the user is in (`keep`, its declarationId); the
// page runs it at start, when the user leaves a month, after a run of the agent and after a wizard wrote. Closing is the lock of
// the button (finalizeDeclaration): the active rows of the saved table go into the history. The checks of the button
// (lock-check.js) never stop it; the page shows them on the closed month.
//
// The first sweep of a data root is the migration of step 9.3 (version 1): until one has gone through without a failure, each
// month is copied before it is closed (its declaration.json, and once its client's history.jsonl), and then
// common/month-lock.json records it.
import { NO_EXPORT_MARKER } from "./declaration-core.js";
import { finalizeDeclaration, listDeclarations, loadDeclaration } from "./declaration-store.js";

export const MONTH_LOCK_FILE = "month-lock.json";
export const MONTH_LOCK_VERSION = 1;
export const DECLARATION_COPY = "declaration.before-month-lock.json";
export const HISTORY_COPY = "history.before-month-lock.jsonl";

const missing = (error) => error?.name === "NotFoundError";

async function readMarker(root) {
  try {
    const common = await root.getDirectoryHandle("common");
    return JSON.parse(await (await (await common.getFileHandle(MONTH_LOCK_FILE)).getFile()).text());
  } catch (error) {
    if (missing(error) || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeFile(directory, name, data) {
  const writable = await (await directory.getFileHandle(name, { create: true })).createWritable();
  try {
    await writable.write(data);
  } finally {
    await writable.close();
  }
}

// Copies `from` to `to` inside one folder, unless there is nothing to copy or the copy is already there (never overwritten).
async function copyOnce(directory, from, to) {
  try {
    await directory.getFileHandle(to);
    return;
  } catch (error) {
    if (!missing(error)) throw error;
  }
  let bytes;
  try {
    bytes = await (await (await directory.getFileHandle(from)).getFile()).arrayBuffer();
  } catch (error) {
    if (missing(error)) return;
    throw error;
  }
  await writeFile(directory, to, new Uint8Array(bytes));
}

async function clientFolders(root) {
  let clients;
  try {
    clients = await root.getDirectoryHandle("clients");
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
  const folders = [];
  for await (const [, handle] of clients.entries()) if (handle.kind === "directory") folders.push(handle);
  return folders;
}

// keep: the declarationId of the month the user is in, or null. A month that cannot be closed is reported and the sweep goes on.
// Resolves with { closed: [{ client, month, declaration }], failed: [{ client, month, error }] }; client is the folder name.
export async function closeOpenMonths({ root, keep = null, now = new Date().toISOString() }) {
  const migrating = (await readMarker(root))?.version !== MONTH_LOCK_VERSION;
  const closed = [], failed = [];
  for (const directory of await clientFolders(root)) {
    for (const { declaration } of await listDeclarations(directory)) {
      if (declaration.status !== "open" || declaration.declarationId === keep) continue;
      const where = { client: directory.name, month: declaration.month };
      try {
        const loaded = await loadDeclaration(directory, declaration.month);
        if (migrating) {
          await copyOnce(loaded.directory, "declaration.json", DECLARATION_COPY);
          await copyOnce(directory, "history.jsonl", HISTORY_COPY);
        }
        const result = await finalizeDeclaration({
          clientDirectory: directory, declarationDirectory: loaded.directory, declaration: loaded.declaration,
          finalExport: NO_EXPORT_MARKER, rows: loaded.draft.rows, now,
        });
        closed.push({ ...where, declaration: result });
      } catch (error) {
        failed.push({ ...where, error });
      }
    }
  }
  if (migrating && !failed.length) {
    const common = await root.getDirectoryHandle("common", { create: true });
    await writeFile(common, MONTH_LOCK_FILE, JSON.stringify({ version: MONTH_LOCK_VERSION, migratedAt: now }, null, 2));
  }
  return { closed, failed };
}
