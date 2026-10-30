// The viewer shows a HEIC original as a JPEG made in memory; any other original is shown as it is.
import assert from "node:assert/strict";
import test from "node:test";
import { isHeic, viewableImage } from "../heic-view.js";

test("a HEIC original is known by its name or its type, in any case", () => {
  assert.equal(isHeic("001.heic"), true);
  assert.equal(isHeic("IMG_8410.HEIC"), true);
  assert.equal(isHeic("002.heif"), true);
  assert.equal(isHeic("", new Blob([], { type: "image/heic" })), true);
  for (const name of ["001.jpg", "002.pdf", "heic.png", ""]) assert.equal(isHeic(name), false, name);
});

test("only a HEIC original is converted, to a JPEG, and the decoder is loaded only for it", async () => {
  const calls = [];
  const loadLibrary = async () => ({
    heicTo: async (args) => {
      calls.push(args);
      return new Blob(["jpeg"], { type: "image/jpeg" });
    },
  });
  const photo = new Blob(["jpg"], { type: "image/jpeg" });
  assert.equal(await viewableImage(photo, "001.jpg", { loadLibrary: () => assert.fail("loaded for a JPEG") }), photo);
  const heic = new Blob(["heic"], { type: "" });
  const shown = await viewableImage(heic, "003.heic", { loadLibrary });
  assert.equal(shown.type, "image/jpeg");
  assert.deepEqual(calls.map(({ blob, type }) => [blob, type]), [[heic, "image/jpeg"]]);
});

test("a decoder that fails is reported to the caller, not hidden", async () => {
  const loadLibrary = async () => ({ heicTo: async () => { throw new Error("bad file"); } });
  await assert.rejects(() => viewableImage(new Blob(["x"]), "001.heic", { loadLibrary }), /bad file/);
});
