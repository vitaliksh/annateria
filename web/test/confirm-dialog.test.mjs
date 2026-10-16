import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const html = `<dialog id="confirm-dialog"><h2 id="confirm-dialog-title"></h2><p id="confirm-dialog-message"></p>
  <button id="confirm-dialog-accept" type="button"></button><button id="cancel" value="cancel"></button></dialog>`;

// confirm-dialog.js reads the global document and window, so bind them before importing it.
function setup({ withDialog = true, nativeAnswer = false, closeEvent = true } = {}) {
  const { window } = new JSDOM(`<!doctype html><body>${withDialog ? html : ""}</body>`);
  Object.assign(globalThis, { document: window.document, window });
  window.confirm = () => nativeAnswer;
  const dialog = window.document.querySelector("#confirm-dialog");
  if (dialog) {
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; if (closeEvent) dialog.dispatchEvent(new window.Event("close")); };
  }
  return { window, dialog };
}
const { confirmDialog } = await import("../confirm-dialog.js");

test("диалог подтверждения: текст, заголовок и подпись кнопки, согласие даёт true", async () => {
  const { dialog } = setup();
  const answer = confirmDialog("למחוק?", { title: "מחיקה", confirmLabel: "מחיקה" });
  assert.equal(dialog.open, true);
  assert.deepEqual(
    ["#confirm-dialog-title", "#confirm-dialog-message", "#confirm-dialog-accept"].map((id) => dialog.querySelector(id).textContent),
    ["מחיקה", "למחוק?", "מחיקה"],
  );
  dialog.querySelector("#confirm-dialog-accept").click();
  assert.equal(await answer, true);
});

test("диалог подтверждения: закрытие без согласия (отмена, Esc) даёт false, повторный вызов не помнит прошлый ответ", async () => {
  const { dialog } = setup();
  const first = confirmDialog("a");
  dialog.close();
  assert.equal(await first, false);
  const second = confirmDialog("b");
  dialog.close();
  assert.equal(await second, false);
  const third = confirmDialog("c");
  dialog.querySelector("#confirm-dialog-accept").click();
  assert.equal(await third, true);
});

test("диалог подтверждения: без диалога на странице используется window.confirm", async () => {
  setup({ withDialog: false, nativeAnswer: true });
  assert.equal(await confirmDialog("x"), true);
  setup({ withDialog: false, nativeAnswer: false });
  assert.equal(await confirmDialog("x"), false);
});

test("диалог подтверждения: результат не зависит от события close (во встроенных браузерах оно не приходит)", async () => {
  const { dialog } = setup({ closeEvent: false });
  const accepted = confirmDialog("a");
  dialog.querySelector("#confirm-dialog-accept").click();
  assert.equal(await accepted, true);
  const cancelled = confirmDialog("b");
  dialog.querySelector("#cancel").click();
  assert.equal(await cancelled, false);
});

test("dialogResult: неверное значение оставляет диалог открытым, верное закрывает и возвращает значение", async () => {
  const { dialog, window } = setup();
  const { dialogResult } = await import("../confirm-dialog.js");
  let attempt = 0;
  const errors = [];
  const result = dialogResult(dialog, {
    accept: dialog.querySelector("#confirm-dialog-accept"),
    getValue: () => { if ((attempt += 1) === 1) throw new Error("bad"); return "good"; },
    onInvalid: (error) => errors.push(error.message),
  });
  dialog.querySelector("#confirm-dialog-accept").click();
  assert.deepEqual([dialog.open, errors], [true, ["bad"]]);
  dialog.querySelector("#confirm-dialog-accept").click();
  assert.equal(await result, "good");
  assert.equal(dialog.open, false);
  assert.ok(window);
});
