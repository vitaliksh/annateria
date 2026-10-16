import assert from "node:assert/strict";
import test from "node:test";
import {
  AccessConfigError,
  CODE_ALPHABET,
  TOKEN_TTL_MS,
  base64url,
  checkCode,
  generateCode,
  hashCode,
  normalizeCode,
  parseAccessCodes,
  signToken,
  verifyToken,
} from "../src/access.js";

const KEY = base64url(crypto.getRandomValues(new Uint8Array(32)));
const OTHER_KEY = base64url(crypto.getRandomValues(new Uint8Array(32)));
const NOW = Date.UTC(2026, 9, 16, 9, 0, 0);

test("generated codes have 6 characters of the alphabet and are different each time", () => {
  const codes = new Set(Array.from({ length: 200 }, generateCode));
  assert.ok(codes.size > 190);
  for (const code of codes) {
    assert.equal(code.length, 6);
    assert.ok([...code].every((character) => CODE_ALPHABET.includes(character)));
  }
});

test("a typed code is normalised: case, spaces and dashes do not matter; anything else is refused", () => {
  assert.equal(normalizeCode(" k7m-2qx "), "K7M2QX");
  for (const bad of ["", "K7M2Q", "K7M2QXX", "K7M2Q0", "K7M2QI", "K7M2QO", "K7M2Q!", null, undefined, 123456, {}])
    assert.equal(normalizeCode(bad), null, String(bad));
});

test("an entry is salted: the same code gives two different entries and neither contains the code", async () => {
  const first = await hashCode("K7M2QX", { iterations: 1000 });
  const second = await hashCode("K7M2QX", { iterations: 1000 });
  assert.notEqual(first, second);
  assert.match(first, /^pbkdf2-sha256\$1000\$[\w-]+\$[\w-]+$/);
  assert.ok(!first.includes("K7M2QX"));
});

test("checkCode finds the right user and nobody for a wrong code", async () => {
  const entries = parseAccessCodes(
    JSON.stringify({ anna: await hashCode("ANNA22", { iterations: 1000 }), vitalik: await hashCode("VKT777", { iterations: 1000 }) }),
  );
  assert.equal(await checkCode("ANNA22", entries), "anna");
  assert.equal(await checkCode("VKT777", entries), "vitalik");
  assert.equal(await checkCode("ANNA23", entries), null);
});

test("a malformed ACCESS_CODES secret is a configuration error, not a wrong guess", () => {
  for (const bad of ["", "not json", "[]", "{}", '{"a":"plain-text"}', '{"a":"pbkdf2-sha256$5$c2FsdA$aGFzaA"}', '{"a":"pbkdf2-sha256$1000$$"}'])
    assert.throws(() => parseAccessCodes(bad), AccessConfigError, bad);
});

test("a token carries the user and expires after 12 hours", async () => {
  const { token, expiresAt } = await signToken("anna", KEY, NOW);
  assert.equal(expiresAt, NOW + TOKEN_TTL_MS);
  assert.equal(TOKEN_TTL_MS, 12 * 60 * 60 * 1000);
  assert.deepEqual(await verifyToken(token, KEY, NOW + 1000), { user: "anna", expiresAt });
  assert.deepEqual(await verifyToken(token, KEY, expiresAt - 1), { user: "anna", expiresAt });
  assert.equal(await verifyToken(token, KEY, expiresAt), null);
  assert.equal(await verifyToken(token, KEY, expiresAt + 3600_000), null);
});

test("a forged token is refused: other key, altered payload, altered signature, wrong shape", async () => {
  const { token } = await signToken("anna", KEY, NOW);
  const [version, payload, signature] = token.split(".");
  const forgedPayload = base64url(new TextEncoder().encode(JSON.stringify({ u: "vitalik", iat: NOW, exp: NOW + 10 * TOKEN_TTL_MS })));
  const flipped = `${signature.slice(0, -2)}${signature.endsWith("AA") ? "BB" : "AA"}`;
  const forged = [
    (await signToken("anna", OTHER_KEY, NOW)).token,
    `${version}.${forgedPayload}.${signature}`,
    `${version}.${payload}.${flipped}`,
    `v2.${payload}.${signature}`,
    `${version}.${payload}`,
    `${token}.extra`,
    "",
    "garbage",
    null,
    undefined,
  ];
  for (const candidate of forged) assert.equal(await verifyToken(candidate, KEY, NOW + 1000), null, String(candidate));
});

test("secrets piped in with a line break at the end still work", async () => {
  const { token } = await signToken("anna", `${KEY}
`, NOW);
  assert.deepEqual(await verifyToken(token, `${KEY}
`, NOW + 1000), { user: "anna", expiresAt: NOW + TOKEN_TTL_MS });
  const entries = parseAccessCodes(`${JSON.stringify({ anna: await hashCode("ANNA22", { iterations: 1000 }) })}
`);
  assert.equal(await checkCode("ANNA22", entries), "anna");
});

test("a signing key that is not base64url is a configuration error", async () => {
  await assert.rejects(signToken("anna", "not base64 !!!", NOW), AccessConfigError);
});

test("a signing key shorter than 32 bytes is a configuration error", async () => {
  await assert.rejects(signToken("anna", base64url(new Uint8Array(8)), NOW), AccessConfigError);
  await assert.rejects(verifyToken("v1.a.b", "", NOW), AccessConfigError);
});
