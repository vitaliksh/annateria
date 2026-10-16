import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { UNSORTED, addToInbox, declarationImageHashes, ensureInbox, isInboxFolder, readInboxIndex, refusalReason, safeFileName, sha256Hex } from "../inbox-store.js";
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

test("images of any declaration count as already seen; the same size with other bytes does not", async () => {
  const root = binaryDirectory();
  await putFile(root, "clients/Levi/declarations/2026-08/images/photo-1.jpg", bytesOf("AAAA"));
  await putFile(root, "clients/Cohen/declarations/2026-09/images/photo-2.jpg", bytesOf("BBBB"));
  await putFile(root, "clients/Cohen/workspace.json", bytesOf("{}"));
  const result = await addToInbox(root, [fileOf("x.jpg", "AAAA"), fileOf("y.jpg", "CCCC"), fileOf("z.jpg", "BBBB")], { folder: "Cohen", now: NOW });
  assert.deepEqual(result.added.map((entry) => entry.name), ["y.jpg"]);
  assert.deepEqual(result.duplicates.map((item) => [item.name, item.reason, item.of]), [
    ["x.jpg", "declaration", { client: "Levi", month: "2026-08", file: "photo-1.jpg" }],
    ["z.jpg", "declaration", { client: "Cohen", month: "2026-09", file: "photo-2.jpg" }],
  ]);
});

test("declarationImageHashes reads only files whose size can match", async () => {
  const root = binaryDirectory();
  await putFile(root, "clients/Levi/declarations/2026-08/images/a.jpg", bytesOf("12345"));
  await putFile(root, "clients/Levi/declarations/2026-08/images/b.jpg", bytesOf("123456789"));
  const levi = await (await root.getDirectoryHandle("clients")).getDirectoryHandle("Levi");
  const images = await (await (await levi.getDirectoryHandle("declarations")).getDirectoryHandle("2026-08")).getDirectoryHandle("images");
  const entries = images.entries.bind(images), reads = [];
  images.entries = async function* () {
    for await (const [name, handle] of entries()) {
      const getFile = async () => {
        const file = await handle.getFile();
        return { ...file, arrayBuffer: async () => { reads.push(name); return file.arrayBuffer(); } };
      };
      yield [name, { ...handle, getFile }];
    }
  };
  assert.deepEqual([...(await declarationImageHashes(root, new Set([5]))).keys()], [sha("12345")]);
  assert.deepEqual(reads, ["a.jpg"]);
  assert.equal((await declarationImageHashes(root, new Set([77]))).size, 0);
  assert.equal((await declarationImageHashes(binaryDirectory(), new Set([5]))).size, 0);
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
