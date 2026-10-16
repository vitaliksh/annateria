import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DATABASE_NAME, readSetting } from "../backup-handles.js";

const OCR_DATABASE_NAME = "rivhit-local-workspaces-v1";

test("the app opens its own IndexedDB database, not the one of the ocr app on the same origin", async () => {
  const opened = [];
  globalThis.indexedDB = {
    open(name, version) {
      opened.push({ name, version });
      const request = {};
      queueMicrotask(() => {
        request.result = {
          createObjectStore() {},
          close() {},
          transaction: () => ({ objectStore: () => ({ get: () => { const get = {}; queueMicrotask(() => get.onsuccess()); return get; } }) }),
        };
        request.onupgradeneeded();
        request.onsuccess();
      });
      return request;
    },
  };
  try {
    await readSetting("backup-key");
  } finally {
    delete globalThis.indexedDB;
  }
  assert.deepEqual(opened, [{ name: "annateria-workspaces-v1", version: 1 }]);
  assert.notEqual(DATABASE_NAME, OCR_DATABASE_NAME);
});

test("workspace.js takes the database name from backup-handles.js and keeps no literal of its own", () => {
  const source = readFileSync(new URL("../workspace.js", import.meta.url), "utf8");
  assert.match(source, /import \{ DATABASE_NAME \} from "\.\/backup-handles\.js"/);
  assert.doesNotMatch(source, /rivhit-local-workspaces|annateria-workspaces/);
});
