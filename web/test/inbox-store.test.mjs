import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  UNSORTED, addToInbox, copyToClientImports, copyToDeclarationImages, importedFiles, ensureInbox, fileImportOriginal, inboxCounts, isInboxFolder, moveOutOfInbox, moveToTrash, nextImageNumber, readInboxFile,
  readInboxIndex, reconcileInbox, refusalReason, safeFileName, sha256Hex, takeIntoMonth,
} from "../inbox-store.js";
import { binaryDirectory, listPaths, putFile, readFileBytes } from "./memory-binary-directory.mjs";

const bytesOf = (text) => new TextEncoder().encode(text);
const fileOf = (name, content, options = {}) => new File([typeof content === "string" ? bytesOf(content) : content], name, options);
const sha = (content) => createHash("sha256").update(typeof content === "string" ? bytesOf(content) : content).digest("hex");
const NOW = "2026-10-17T08:00:00.000Z";

test("sha256Hex matches node's SHA-256", async () => {
  assert.equal(await sha256Hex(bytesOf("abc")), sha("abc"));
});

test("safeFileName keeps the extension and removes what Windows refuses", () => {
  assert.equal(safeFileName("IMG_001.jpg"), "IMG_001.jpg");
  assert.equal(safeFileName("..\\..\\evil/inv:oice?.pdf"), "inv-oice-.pdf");
  assert.equal(safeFileName('a<b>c"d|e*f.png'), "a-b-c-d-e-f.png");
  assert.equal(safeFileName("חשבונית ספק.pdf"), "חשבונית ספק.pdf");
  assert.equal(safeFileName("  name. . "), "name");
  assert.equal(safeFileName("CON.pdf"), "_CON.pdf");
  assert.equal(safeFileName("lpt1"), "_lpt1");
  assert.equal(safeFileName(".pdf"), ".pdf");
  assert.equal(safeFileName(""), "file");
  assert.equal(safeFileName("...."), "file");
  const long = safeFileName("x".repeat(400) + ".xlsx");
  assert.ok(long.endsWith(".xlsx") && long.length === 125);
});

test("refusalReason lets photos, PDFs and spreadsheets in and names the reason for the rest", () => {
  for (const name of ["a.jpg", "A.JPEG", "b.png", "c.webp", "d.HEIC", "e.heif", "f.pdf", "g.xlsx", "h.xls", "i.csv"]) assert.equal(refusalReason(name), null, name);
  assert.equal(refusalReason("notes.docx"), "סוג קובץ שאינו נתמך (.docx)");
  assert.equal(refusalReason("archive.ZIP"), "סוג קובץ שאינו נתמך (.zip)");
  assert.equal(refusalReason("README"), "קובץ ללא סיומת");
  assert.equal(refusalReason(".pdf"), "קובץ ללא סיומת", "a dot file is a name, not an extension");
});

test("isInboxFolder accepts _unsorted and plain names, refuses paths and reserved names", () => {
  for (const name of [UNSORTED, "Levi Ltd", "לקוח א׳"]) assert.equal(isInboxFolder(name), true, name);
  for (const name of ["", " x", "x ", "a/b", "a\\b", "..", ".", "x.", "_trash", "_TRASH", "_Unsorted", null, 5]) {
    assert.equal(isInboxFolder(name), false, String(name));
  }
});

test("ensureInbox creates _unsorted and a folder per client, skips unusable names, and is repeatable", async () => {
  const root = binaryDirectory();
  const first = await ensureInbox(root, ["Levi", "_trash", "a/b", "Cohen"]);
  assert.deepEqual(first.skipped, ["_trash", "a/b"]);
  const inbox = await root.getDirectoryHandle("inbox");
  assert.deepEqual([...inbox.children.keys()].sort(), ["Cohen", "Levi", "_unsorted"]);
  await putFile(root, "inbox/Levi/keep.txt", bytesOf("kept"));
  await ensureInbox(root, ["Levi"]);
  assert.equal(new TextDecoder().decode(await readFileBytes(root, "inbox/Levi/keep.txt")), "kept");
});

test("a missing index reads as empty", async () => {
  assert.deepEqual(await readInboxIndex(binaryDirectory()), { schemaVersion: 1, files: [] });
});

test("addToInbox stores the bytes unchanged and records them in the index", async () => {
  const root = binaryDirectory();
  const content = new Uint8Array([0, 1, 2, 250, 251, 252, 255]);
  const result = await addToInbox(root, [fileOf("scan 1.heic", content, { lastModified: Date.UTC(2026, 8, 30, 12) })], { folder: "Levi", now: NOW });
  assert.equal(result.duplicates.length + result.failed.length, 0);
  assert.deepEqual(result.added, [{
    hash: sha(content), name: "scan 1.heic", storedName: "scan 1.heic", folder: "Levi", size: 7,
    type: "image/heic", sourceDate: "2026-09-30", addedAt: NOW,
  }]);
  assert.deepEqual(await readFileBytes(root, "inbox/Levi/scan 1.heic"), content);
  assert.deepEqual((await readInboxIndex(root)).files, result.added);
  assert.deepEqual(await listPaths(root), ["inbox/Levi/scan 1.heic", "inbox/index.json"]);
});

test("the default folder is _unsorted; the browser's type wins, a missing one comes from the extension", async () => {
  const root = binaryDirectory();
  const result = await addToInbox(root, [fileOf("a.pdf", "pdf-a", { type: "application/pdf" }), fileOf("b.xlsx", "x-b"), fileOf("c.bin", "raw-c", { lastModified: 0 })], { now: NOW });
  assert.deepEqual(result.added.map((entry) => [entry.folder, entry.type]), [
    ["_unsorted", "application/pdf"],
    ["_unsorted", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["_unsorted", "application/octet-stream"],
  ]);
  assert.equal(result.added[2].sourceDate, null);
});

test("the same bytes are skipped inside one batch, whatever the name", async () => {
  const root = binaryDirectory();
  const result = await addToInbox(root, [fileOf("one.jpg", "same"), fileOf("copy of one.jpg", "same"), fileOf("two.jpg", "other")], { now: NOW });
  assert.deepEqual(result.added.map((entry) => entry.name), ["one.jpg", "two.jpg"]);
  assert.deepEqual(result.duplicates.map((item) => [item.name, item.reason, item.of.name]), [["copy of one.jpg", "inbox", "one.jpg"]]);
  assert.deepEqual(await listPaths(root), ["inbox/_unsorted/one.jpg", "inbox/_unsorted/two.jpg", "inbox/index.json"]);
});

test("the same bytes are skipped across batches and across folders", async () => {
  const root = binaryDirectory();
  await addToInbox(root, [fileOf("a.jpg", "same")], { folder: "Levi", now: NOW });
  const again = await addToInbox(root, [fileOf("a.jpg", "same"), fileOf("b.jpg", "new")], { folder: "Cohen", now: NOW });
  assert.deepEqual(again.added.map((entry) => entry.name), ["b.jpg"]);
  assert.deepEqual(again.duplicates.map((item) => [item.reason, item.of.folder]), [["inbox", "Levi"]]);
  assert.equal((await readInboxIndex(root)).files.length, 2);
});

test("a name that is taken by other bytes gets a number; case is ignored", async () => {
  const root = binaryDirectory();
  await addToInbox(root, [fileOf("Doc.PDF", "1")], { now: NOW });
  const result = await addToInbox(root, [fileOf("doc.pdf", "2"), fileOf("DOC.pdf", "3")], { now: NOW });
  assert.deepEqual(result.added.map((entry) => [entry.name, entry.storedName]), [["doc.pdf", "doc (2).pdf"], ["DOC.pdf", "DOC (3).pdf"]]);
  assert.deepEqual(await listPaths(root), ["inbox/_unsorted/DOC (3).pdf", "inbox/_unsorted/Doc.PDF", "inbox/_unsorted/doc (2).pdf", "inbox/index.json"]);
});

test("a name that is taken by a file missing from the index is not overwritten", async () => {
  const root = binaryDirectory();
  await putFile(root, "inbox/_unsorted/orphan.jpg", bytesOf("left by a crash"));
  const result = await addToInbox(root, [fileOf("orphan.jpg", "different")], { now: NOW });
  assert.equal(result.added[0].storedName, "orphan (2).jpg");
  assert.equal(new TextDecoder().decode(await readFileBytes(root, "inbox/_unsorted/orphan.jpg")), "left by a crash");
});

test("a path in the file name cannot leave the folder", async () => {
  const root = binaryDirectory();
  const result = await addToInbox(root, [fileOf("..\\..\\clients\\x.pdf", "p")], { now: NOW });
  assert.equal(result.added[0].storedName, "x.pdf");
  assert.deepEqual(await listPaths(root), ["inbox/_unsorted/x.pdf", "inbox/index.json"]);
});

// The owner, 11 November 2026: one rule against a second import. A file is already in while a row of any month of any client comes from
// it (agent.file, sourceHash, importHash: the SHA-256 of the file), turned off or not, edited or not; a deleted month frees it.
const putTable = (root, client, month, rows) => putFile(root, `clients/${client}/declarations/${month}/draft-table.json`, bytesOf(JSON.stringify({ schemaVersion: 1, rows })));

test("a file is refused while a row of any month of any client comes from it, and the answer says where", async () => {
  const root = binaryDirectory();
  await putTable(root, "Levi", "2026-08", [{ imageFile: "001.pdf", active: false, agent: { run: "r1", file: sha("SCAN") } }]);
  await putTable(root, "Cohen", "2026-09", [{ imageFile: "", sourceHash: sha("JOURNAL") }, { imageFile: "", importHash: sha("INCOME") }]);
  await putFile(root, "clients/Cohen/workspace.json", bytesOf("{}"));
  const files = [fileOf("scan.pdf", "SCAN"), fileOf("new.jpg", "NEW"), fileOf("j.xlsx", "JOURNAL"), fileOf("report.pdf", "INCOME")];
  const result = await addToInbox(root, files, { folder: "Cohen", now: NOW });
  assert.deepEqual(result.added.map((entry) => entry.name), ["new.jpg"]);
  assert.deepEqual(result.duplicates.map((item) => [item.name, item.reason, item.of]), [
    ["scan.pdf", "declaration", { client: "Levi", month: "2026-08" }],
    ["j.xlsx", "declaration", { client: "Cohen", month: "2026-09" }],
    ["report.pdf", "declaration", { client: "Cohen", month: "2026-09" }],
  ]);
});

test("a file whose rows are gone comes in again: rows deleted, or the month deleted; its copy in the folders does not count", async () => {
  const root = binaryDirectory();
  await putFile(root, "clients/Levi/declarations/2026-10/images/001.pdf", bytesOf("OLD-SCAN"));
  await putFile(root, "clients/Levi/imports/report.pdf", bytesOf("OLD-REPORT"));
  await putTable(root, "Levi", "2026-10", [{ imageFile: "" }]);
  const first = await addToInbox(root, [fileOf("scan.pdf", "OLD-SCAN"), fileOf("report.pdf", "OLD-REPORT")], { folder: "Levi", now: NOW });
  assert.deepEqual([first.added.map((entry) => entry.name), first.duplicates], [["scan.pdf", "report.pdf"], []]);

  const other = binaryDirectory();
  await putTable(other, "Levi", "2026-09", [{ imageFile: "", importHash: sha("REPORT") }]);
  assert.equal((await addToInbox(other, [fileOf("report.pdf", "REPORT")], { folder: "Levi", now: NOW })).added.length, 0);
  await (await (await (await other.getDirectoryHandle("clients")).getDirectoryHandle("Levi")).getDirectoryHandle("declarations")).removeEntry("2026-09", { recursive: true });
  assert.deepEqual((await addToInbox(other, [fileOf("report.pdf", "REPORT")], { folder: "Levi", now: NOW })).added.map((entry) => entry.name), ["report.pdf"]);
});

test("the same name with other bytes is another file; a table that cannot be read is skipped", async () => {
  const root = binaryDirectory();
  await putTable(root, "Levi", "2026-08", [{ imageFile: "IMG_0001.jpg", agent: { file: sha("FIRST PHOTO") } }]);
  await putFile(root, "clients/Levi/declarations/2026-09/draft-table.json", bytesOf("{ broken"));
  const result = await addToInbox(root, [fileOf("IMG_0001.jpg", "SECOND PHOTO")], { folder: "Levi", now: NOW });
  assert.deepEqual(result.added.map((entry) => entry.name), ["IMG_0001.jpg"]);
  assert.deepEqual([...(await importedFiles(root)).keys()], [sha("FIRST PHOTO")]);
  assert.equal((await importedFiles(binaryDirectory())).size, 0);
});

test("an empty file and a file that cannot be written fail alone; the rest of the batch goes on", async () => {
  const root = binaryDirectory("root", { failures: [{ match: /^bad\.pdf$/, name: "NotAllowedError", times: 1 }] });
  const result = await addToInbox(root, [fileOf("empty.jpg", ""), fileOf("bad.pdf", "bad"), fileOf("good.pdf", "good")], { now: NOW });
  assert.deepEqual(result.added.map((entry) => entry.name), ["good.pdf"]);
  assert.deepEqual(result.failed.map((item) => item.name), ["empty.jpg", "bad.pdf"]);
  assert.deepEqual(await listPaths(root), ["inbox/_unsorted/good.pdf", "inbox/index.json"]);
  assert.equal((await readInboxIndex(root)).files.length, 1);
});

test("a file that is not written back identically is not recorded", async () => {
  const root = binaryDirectory();
  const directory = await root.getDirectoryHandle("inbox", { create: true }).then((inbox) => inbox.getDirectoryHandle("_unsorted", { create: true }));
  const handle = directory.getFileHandle.bind(directory);
  directory.getFileHandle = async (name, options) => {
    const opened = await handle(name, options);
    return { ...opened, createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
  };
  const result = await addToInbox(root, [fileOf("a.pdf", "content")], { now: NOW });
  assert.deepEqual(result.added, []);
  assert.equal(result.failed.length, 1);
  assert.deepEqual((await readInboxIndex(root)).files, []);
});

test("when the index cannot be written the stored file is taken back and the entry is not kept", async () => {
  const root = binaryDirectory("root", { failures: [{ match: /^index\.json$/, name: "NotAllowedError", times: 1 }] });
  const result = await addToInbox(root, [fileOf("a.pdf", "first"), fileOf("b.pdf", "second")], { now: NOW });
  assert.deepEqual(result.failed.map((item) => item.name), ["a.pdf"]);
  assert.deepEqual(result.added.map((entry) => entry.name), ["b.pdf"]);
  assert.deepEqual(await listPaths(root), ["inbox/_unsorted/b.pdf", "inbox/index.json"]);
  assert.deepEqual((await readInboxIndex(root)).files.map((entry) => entry.name), ["b.pdf"]);
});

test("a damaged or newer index stops the add and is left as it is", async () => {
  for (const [content, pattern] of [["{ not json", /אינו תקין/], [JSON.stringify({ schemaVersion: 2, files: [] }), /חדשה יותר/], [JSON.stringify({ schemaVersion: 1, files: [{ hash: "x" }] }), /אינו תקין/]]) {
    const root = binaryDirectory();
    await putFile(root, "inbox/index.json", content);
    await assert.rejects(() => addToInbox(root, [fileOf("a.pdf", "a")], { now: NOW }), pattern);
    assert.equal(new TextDecoder().decode(await readFileBytes(root, "inbox/index.json")), content);
    assert.deepEqual(await listPaths(root), ["inbox/index.json"]);
  }
});

test("an invalid folder name is refused before anything is written", async () => {
  const root = binaryDirectory();
  for (const folder of ["../x", "_trash", ""]) await assert.rejects(() => addToInbox(root, [fileOf("a.pdf", "a")], { folder }), /תיקייה/);
  assert.deepEqual(await listPaths(root), []);
});

test("a nameless file gets a usable name", async () => {
  const root = binaryDirectory();
  const result = await addToInbox(root, [fileOf("", "bytes")], { now: NOW });
  assert.equal(result.added[0].storedName, "file");
  assert.equal((await readInboxIndex(root)).files.length, 1);
});

async function filled() {
  const root = binaryDirectory();
  await addToInbox(root, [fileOf("a.pdf", "alpha"), fileOf("b.jpg", "bravo")], { folder: "Levi", now: NOW });
  await addToInbox(root, [fileOf("c.png", "charlie")], { now: NOW });
  return { root, files: (await readInboxIndex(root)).files };
}

test("inboxCounts counts files per folder and ignores the trash", async () => {
  const { root, files } = await filled();
  assert.deepEqual(inboxCounts(await readInboxIndex(root)), { total: 3, byFolder: { Levi: 2, _unsorted: 1 }, byMonth: {} });
  await moveToTrash(root, [files[0].hash]);
  assert.deepEqual(inboxCounts(await readInboxIndex(root)), { total: 2, byFolder: { Levi: 1, _unsorted: 1 }, byMonth: {} });
  assert.deepEqual(inboxCounts({ files: [] }), { total: 0, byFolder: {}, byMonth: {} });
});

test("readInboxFile returns the stored bytes", async () => {
  const { root, files } = await filled();
  const file = await readInboxFile(root, files[0]);
  assert.equal(new TextDecoder().decode(await file.arrayBuffer()), "alpha");
});

test("moveToTrash moves the bytes to _trash, keeps a record and leaves nothing behind", async () => {
  const { root, files } = await filled();
  const result = await moveToTrash(root, [files[0].hash, files[2].hash], { now: "2026-10-18T10:00:00.000Z" });
  assert.deepEqual(result.moved.map((entry) => entry.name), ["a.pdf", "c.png"]);
  assert.deepEqual([result.missing.length, result.failed.length], [0, 0]);
  assert.deepEqual(await listPaths(root), ["inbox/Levi/b.jpg", "inbox/_trash/a.pdf", "inbox/_trash/c.png", "inbox/index.json"]);
  assert.equal(new TextDecoder().decode(await readFileBytes(root, "inbox/_trash/a.pdf")), "alpha");
  const index = await readInboxIndex(root);
  assert.deepEqual(index.files.map((entry) => entry.name), ["b.jpg"]);
  assert.deepEqual(index.trashed.map((entry) => [entry.name, entry.trashedName, entry.trashedAt, entry.hash]), [
    ["a.pdf", "a.pdf", "2026-10-18T10:00:00.000Z", sha("alpha")],
    ["c.png", "c.png", "2026-10-18T10:00:00.000Z", sha("charlie")],
  ]);
});

test("after the trash the same bytes can be added again; the trash keeps both copies under different names", async () => {
  const { root, files } = await filled();
  await moveToTrash(root, [files[0].hash]);
  const again = await addToInbox(root, [fileOf("a.pdf", "alpha")], { folder: "Levi", now: NOW });
  assert.equal(again.added.length, 1);
  await moveToTrash(root, [again.added[0].hash]);
  assert.deepEqual((await listPaths(root)).filter((path) => path.startsWith("inbox/_trash/")), ["inbox/_trash/a (2).pdf", "inbox/_trash/a.pdf"]);
  assert.equal((await readInboxIndex(root)).trashed.length, 2);
});

test("a later add keeps the trash records in the index", async () => {
  const { root, files } = await filled();
  await moveToTrash(root, [files[0].hash]);
  await addToInbox(root, [fileOf("d.pdf", "delta")], { now: NOW });
  assert.equal((await readInboxIndex(root)).trashed.length, 1);
});

test("a file that is no longer on disk is only dropped from the index; unknown and repeated hashes are harmless", async () => {
  const { root, files } = await filled();
  const levi = await (await root.getDirectoryHandle("inbox")).getDirectoryHandle("Levi");
  await levi.removeEntry("a.pdf");
  const result = await moveToTrash(root, [files[0].hash, files[0].hash, sha("never stored")]);
  assert.deepEqual(result.missing.map((entry) => entry.name), ["a.pdf"]);
  assert.deepEqual([result.moved.length, result.failed.length], [0, 0]);
  const index = await readInboxIndex(root);
  assert.deepEqual(index.files.map((entry) => entry.name), ["b.jpg", "c.png"]);
  assert.equal(index.trashed, undefined);
});

test("when the index cannot be written the file stays where it is and the trash copy is taken back", async () => {
  const { root, files } = await filled();
  root.state.failures.push({ match: /^index\.json$/, name: "NotAllowedError", times: 1 });
  const result = await moveToTrash(root, files.map((entry) => entry.hash));
  assert.deepEqual(result.failed.map((item) => item.name), ["a.pdf"]);
  assert.deepEqual(result.moved.map((entry) => entry.name), ["b.jpg", "c.png"]);
  assert.deepEqual(await listPaths(root), ["inbox/Levi/a.pdf", "inbox/_trash/b.jpg", "inbox/_trash/c.png", "inbox/index.json"]);
  assert.deepEqual((await readInboxIndex(root)).files.map((entry) => entry.name), ["a.pdf"]);
});

test("when the original cannot be removed the failure is reported and the index stays consistent", async () => {
  const { root, files } = await filled();
  const levi = await (await root.getDirectoryHandle("inbox")).getDirectoryHandle("Levi");
  levi.removeEntry = async () => { throw Object.assign(new Error("locked"), { name: "InvalidModificationError" }); };
  const result = await moveToTrash(root, [files[0].hash]);
  assert.deepEqual([result.moved.length, result.failed.length], [0, 1]);
  assert.match(result.failed[0].error, /לא הוסר/);
  assert.deepEqual((await readInboxIndex(root)).files.map((entry) => entry.name), ["b.jpg", "c.png"]);
  assert.equal((await readInboxIndex(root)).trashed.length, 1);
  assert.equal((await listPaths(root)).includes("inbox/Levi/a.pdf"), true);
});

test("a damaged trash record stops the read", async () => {
  const root = binaryDirectory();
  await putFile(root, "inbox/index.json", JSON.stringify({ schemaVersion: 1, files: [], trashed: [{ name: "x" }] }));
  await assert.rejects(() => readInboxIndex(root), /אינו תקין/);
});

// --- filing an original into a declaration ---

async function filedWorld() {
  const root = binaryDirectory();
  await addToInbox(root, [fileOf("scan.JPG", "photo bytes", { type: "image/jpeg" }), fileOf("policy.pdf", "pdf bytes", { type: "application/pdf" })], { folder: "Levi", now: NOW });
  const index = await readInboxIndex(root);
  const levi = await (await root.getDirectoryHandle("clients", { create: true })).getDirectoryHandle("Levi", { create: true });
  const declaration = await (await levi.getDirectoryHandle("declarations", { create: true })).getDirectoryHandle("2026-02", { create: true });
  return { root, entries: index.files, declaration };
}

test("nextImageNumber is the highest number of the images plus one, whatever the extension, and ignores other names", async () => {
  const empty = binaryDirectory("images");
  assert.equal(await nextImageNumber(empty), 1);
  await putFile(empty, "001.jpg", bytesOf("a"));
  await putFile(empty, "007.pdf", bytesOf("b"));
  await putFile(empty, "source-2026-10-13T15-17-12-ab.pdf", bytesOf("c"));
  await putFile(empty, "notes.txt", bytesOf("d"));
  await putFile(empty, "12.jpg", bytesOf("e"));
  assert.equal(await nextImageNumber(empty), 8);
  await putFile(empty, "1234.png", bytesOf("f"));
  assert.equal(await nextImageNumber(empty), 1235, "more than three digits");
});

test("copyToDeclarationImages copies the original as NNN.<extension>, checks the copy, and leaves the original where it is", async () => {
  const { root, entries, declaration } = await filedWorld();
  const [scan, policy] = entries;
  assert.deepEqual(await copyToDeclarationImages(root, scan, declaration), { imageFile: "001.jpg", imageIndex: 1 });
  assert.deepEqual(await copyToDeclarationImages(root, policy, declaration), { imageFile: "002.pdf", imageIndex: 2 });
  assert.equal(new TextDecoder().decode(await readFileBytes(root, "clients/Levi/declarations/2026-02/images/001.jpg")), "photo bytes");
  assert.equal(new TextDecoder().decode(await readFileBytes(root, "inbox/Levi/scan.JPG")), "photo bytes", "the original is still in the inbox");
  assert.equal((await readInboxIndex(root)).files.length, 2);
});

test("copyToDeclarationImages refuses a file that is not what the index says; a failed write leaves no partial copy", async () => {
  const { root, entries, declaration } = await filedWorld();
  await putFile(root, "inbox/Levi/scan.JPG", bytesOf("other bytes!"));
  await assert.rejects(() => copyToDeclarationImages(root, entries[0], declaration), /שונה ממה שנרשם/);
  await putFile(root, "inbox/Levi/scan.JPG", bytesOf("photo bytes"));
  root.state.failures.push({ match: /^001\.jpg$/, name: "NotAllowedError", times: 1 });
  await assert.rejects(() => copyToDeclarationImages(root, entries[0], declaration), /simulated/);
  assert.deepEqual((await listPaths(root)).filter((path) => path.includes("/images/")), []);
});

test("an extension that is not plain letters or digits becomes .bin", async () => {
  const { root, entries, declaration } = await filedWorld();
  const odd = { ...entries[0], storedName: "scan.j p g!" };
  await putFile(root, "inbox/Levi/scan.j p g!", bytesOf("photo bytes"));
  assert.equal((await copyToDeclarationImages(root, odd, declaration)).imageFile, "001.bin");
});

test("moveOutOfInbox takes the entry out of the index and the file out of the folder; a second call does nothing; a file already gone is fine", async () => {
  const { root, entries } = await filedWorld();
  assert.equal(await moveOutOfInbox(root, entries[0]), true);
  assert.deepEqual((await readInboxIndex(root)).files.map((entry) => entry.name), ["policy.pdf"]);
  assert.deepEqual((await listPaths(root)).filter((path) => path.startsWith("inbox/Levi/")), ["inbox/Levi/policy.pdf"]);
  assert.equal(await moveOutOfInbox(root, entries[0]), false);
  const inbox = await (await root.getDirectoryHandle("inbox")).getDirectoryHandle("Levi");
  await inbox.removeEntry("policy.pdf");
  assert.equal(await moveOutOfInbox(root, entries[1]), true, "the entry leaves the index even if the file was removed by hand");
  assert.deepEqual((await readInboxIndex(root)).files, []);
});

test("after the original moved to a declaration with its rows the same file cannot be added to the inbox again", async () => {
  const { root, entries, declaration } = await filedWorld();
  await copyToDeclarationImages(root, entries[0], declaration);
  await putTable(root, "Levi", "2026-02", [{ imageFile: "001.jpg", agent: { run: "r1", file: entries[0].hash } }]);
  await moveOutOfInbox(root, entries[0]);
  const again = await addToInbox(root, [fileOf("scan again.jpg", "photo bytes")], { now: NOW });
  assert.deepEqual([again.added.length, again.duplicates.map((item) => [item.reason, item.of])], [0, [["declaration", { client: "Levi", month: "2026-02" }]]]);
});

test("calls made at the same time do not lose each other's changes: ten files leave the inbox together, two copies get two numbers", async () => {
  const root = binaryDirectory("data");
  const added = await addToInbox(root, Array.from({ length: 10 }, (_, n) => fileOf(`doc${n}.jpg`, `bytes ${n}`)), { now: NOW });
  const entries = added.added;
  const declaration = await (await root.getDirectoryHandle("clients", { create: true })).getDirectoryHandle("declaration", { create: true });
  const copies = await Promise.all(entries.slice(0, 2).map((entry) => copyToDeclarationImages(root, entry, declaration)));
  assert.deepEqual(copies.map((copy) => copy.imageFile).sort(), ["001.jpg", "002.jpg"]);
  await Promise.all(entries.map((entry) => moveOutOfInbox(root, entry)));
  assert.deepEqual((await readInboxIndex(root)).files, [], "no entry is left in the index");
  assert.deepEqual((await listPaths(root)).filter((path) => path.startsWith("inbox/_unsorted/")), [], "no file is left in the folder");
});

test("an index entry whose file is gone is dropped by reconcileInbox, and its bytes can be added again", async () => {
  const { root, entries } = await filedWorld();
  assert.deepEqual(await reconcileInbox(root), [], "nothing is missing: nothing is dropped");
  const folder = await (await root.getDirectoryHandle("inbox")).getDirectoryHandle("Levi");
  await folder.removeEntry(entries[0].storedName);
  assert.equal((await readInboxIndex(root)).files.length, 2, "the entry is still in the index");
  assert.deepEqual((await reconcileInbox(root)).map((entry) => entry.name), [entries[0].name]);
  assert.deepEqual((await readInboxIndex(root)).files.map((entry) => entry.name), [entries[1].name]);
  assert.deepEqual(await reconcileInbox(root), [], "a second call has nothing to do");
});

test("addToInbox does not call the same bytes a duplicate of a file that is no longer there", async () => {
  const { root, entries } = await filedWorld();
  const folder = await (await root.getDirectoryHandle("inbox")).getDirectoryHandle("Levi");
  await folder.removeEntry(entries[0].storedName);
  const again = await addToInbox(root, [fileOf("scan again.jpg", "photo bytes")], { folder: "Levi", now: NOW });
  assert.deepEqual([again.added.length, again.duplicates.length], [1, 0]);
  assert.equal((await readInboxIndex(root)).files.filter((entry) => entry.hash === entries[0].hash).length, 1, "one entry for those bytes");
});

// The original of an import that a wizard wrote (step 4.7.2): copied to clients/<client>/imports/, checked, then out of the inbox.
async function importWorld() {
  const root = binaryDirectory();
  await addToInbox(root, [fileOf("journal.xlsx", "journal bytes")], { folder: "Levi", now: NOW });
  const [entry] = (await readInboxIndex(root)).files;
  const levi = await (await root.getDirectoryHandle("clients", { create: true })).getDirectoryHandle("Levi", { create: true });
  return { root, entry, levi };
}

test("fileImportOriginal copies the original into imports/, reads it back, and only then takes it out of the inbox", async () => {
  const { root, entry, levi } = await importWorld();
  assert.deepEqual(await fileImportOriginal(root, entry, levi), { importFile: "journal.xlsx" });
  assert.equal(new TextDecoder().decode(await readFileBytes(root, "clients/Levi/imports/journal.xlsx")), "journal bytes");
  assert.equal((await readInboxIndex(root)).files.length, 0);
  assert.equal((await listPaths(root)).includes("inbox/Levi/journal.xlsx"), false);
});

test("copyToClientImports never overwrites: a taken name gets a number; the original stays until moveOutOfInbox", async () => {
  const { root, entry, levi } = await importWorld();
  await putFile(root, "clients/Levi/imports/journal.xlsx", bytesOf("an older journal"));
  assert.deepEqual(await copyToClientImports(root, entry, levi), { importFile: "journal (2).xlsx" });
  assert.equal(new TextDecoder().decode(await readFileBytes(root, "clients/Levi/imports/journal.xlsx")), "an older journal");
  assert.equal((await readInboxIndex(root)).files.length, 1, "the inbox still holds it");
});

test("fileImportOriginal refuses a file that is not what the index says and leaves everything where it was", async () => {
  const { root, entry, levi } = await importWorld();
  await putFile(root, "inbox/Levi/journal.xlsx", bytesOf("changed bytes!"));
  await assert.rejects(() => fileImportOriginal(root, entry, levi), /שונה ממה שנרשם/);
  assert.equal((await readInboxIndex(root)).files.length, 1);
  assert.equal((await listPaths(root)).some((path) => path.startsWith("clients/Levi/imports/")), false);
});

test("step 9.4: a file added for a month records it; the counts tell each month; a month needs a client folder", async () => {
  const root = binaryDirectory("root");
  const added = await addToInbox(root, [fileOf("a.pdf", "aaa")], { folder: "Client", month: "2026-10", now: NOW });
  assert.equal(added.added[0].month, "2026-10");
  await addToInbox(root, [fileOf("b.pdf", "bbb")], { folder: "Client", now: NOW });
  await addToInbox(root, [fileOf("c.jpg", "ccc")], { now: NOW });
  const index = await readInboxIndex(root);
  assert.deepEqual(index.files.map((entry) => entry.month ?? null), ["2026-10", null, null]);
  assert.deepEqual(inboxCounts(index), { total: 3, byFolder: { Client: 2, [UNSORTED]: 1 }, byMonth: { "Client|2026-10": 1 } });
  await assert.rejects(addToInbox(root, [fileOf("d.pdf", "ddd")], { month: "2026-10" }), /חודש/);
  await assert.rejects(addToInbox(root, [fileOf("d.pdf", "ddd")], { folder: "Client", month: "2026-13" }), /חודש/);
  const again = await addToInbox(root, [fileOf("a again.pdf", "aaa")], { folder: "Client", month: "2026-11", now: NOW });
  assert.equal(again.duplicates[0].reason, "inbox", "the same bytes are still a duplicate, whatever the month");
});

test("step 9.4: takeIntoMonth moves a file without a month into the month of a client, and refuses one that has a month", async () => {
  const root = binaryDirectory("root");
  await addToInbox(root, [fileOf("scan.jpg", "scan")], { now: NOW });
  await addToInbox(root, [fileOf("own.pdf", "own")], { folder: "Client", now: NOW });
  await putFile(root, "inbox/Client/scan.jpg", "an older file of the same name");
  const moved = await takeIntoMonth(root, sha("scan"), { folder: "Client", month: "2026-10" });
  assert.deepEqual([moved.folder, moved.storedName, moved.month], ["Client", "scan (2).jpg", "2026-10"]);
  assert.equal(new TextDecoder().decode(await readFileBytes(root, "inbox/Client/scan (2).jpg")), "scan");
  assert.equal((await listPaths(root)).includes("inbox/_unsorted/scan.jpg"), false, "the original left _unsorted");
  const kept = await takeIntoMonth(root, sha("own"), { folder: "Client", month: "2026-10" });
  assert.deepEqual([kept.folder, kept.storedName, kept.month], ["Client", "own.pdf", "2026-10"]);
  const index = await readInboxIndex(root);
  assert.deepEqual(index.files.map((entry) => `${entry.folder}/${entry.storedName} ${entry.month}`), ["Client/scan (2).jpg 2026-10", "Client/own.pdf 2026-10"]);
  await assert.rejects(takeIntoMonth(root, sha("own"), { folder: "Client", month: "2026-11" }), /כבר יש חודש/);
  await assert.rejects(takeIntoMonth(root, sha("nothing"), { folder: "Client", month: "2026-11" }), /אינו בתיבת הקלט/);
  await assert.rejects(takeIntoMonth(root, sha("own"), { folder: UNSORTED, month: "2026-11" }), /חודש לא חוקי/);
});
