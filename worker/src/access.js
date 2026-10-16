// Access codes and tokens (step 1.1). Pure functions over Web Crypto, so they run in the Worker and in node tests.
//
// A code has 6 characters of a 32-letter alphabet without look-alikes (30 bits), one per user. The Worker secret
// ACCESS_CODES holds, per user, `pbkdf2-sha256$<iterations>$<salt>$<hash>`; a token is `v1.<payload>.<hmac>` signed
// with the secret TOKEN_SIGNING_KEY. Nothing here is stored: a token is checked by its signature and its expiry.

export const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const CODE_LENGTH = 6;
export const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
export const DEFAULT_ITERATIONS = 20000;
const MIN_ITERATIONS = 1000;
const MAX_ITERATIONS = 100000;
const HASH_BYTES = 32;
const SALT_BYTES = 16;
const MIN_KEY_BYTES = 32;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function fromBase64url(text) {
  const value = String(text);
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

// Upper case, spaces and dashes dropped; null unless it is exactly 6 characters of the alphabet.
export function normalizeCode(text) {
  const code = String(text ?? "").toUpperCase().replace(/[\s-]/g, "");
  return code.length === CODE_LENGTH && [...code].every((character) => CODE_ALPHABET.includes(character)) ? code : null;
}

export function generateCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  // 256 is a multiple of 32, so the modulo adds no bias.
  return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

async function derive(code, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(code), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, HASH_BYTES * 8);
  return new Uint8Array(bits);
}

export async function hashCode(
  code,
  { iterations = DEFAULT_ITERATIONS, salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES)) } = {},
) {
  const hash = await derive(code, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${base64url(salt)}$${base64url(hash)}`;
}

export class AccessConfigError extends Error {}

// ACCESS_CODES is a JSON object {user: entry}. A malformed secret is a deployment error, not a wrong guess.
export function parseAccessCodes(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AccessConfigError("ACCESS_CODES is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Object.keys(parsed).length)
    throw new AccessConfigError("ACCESS_CODES is empty.");
  return Object.entries(parsed).map(([user, entry]) => {
    const [scheme, iterations, salt, hash] = String(entry).split("$");
    const count = Number(iterations);
    if (scheme !== "pbkdf2-sha256" || !Number.isInteger(count) || count < MIN_ITERATIONS || count > MAX_ITERATIONS || !salt || !hash)
      throw new AccessConfigError(`ACCESS_CODES entry of ${user} is malformed.`);
    return { user, iterations: count, salt: fromBase64url(salt), hash: fromBase64url(hash) };
  });
}

// Every entry is hashed and compared, so the time does not tell which user (or none) matched.
export async function checkCode(code, entries) {
  let matched = null;
  for (const entry of entries) {
    const candidate = await derive(code, entry.salt, entry.iterations);
    if (constantTimeEqual(candidate, entry.hash) && matched === null) matched = entry.user;
  }
  return matched;
}

async function hmacKey(secret, usages) {
  const raw = fromBase64url(secret ?? "");
  if (raw.length < MIN_KEY_BYTES) throw new AccessConfigError("TOKEN_SIGNING_KEY must hold at least 32 random bytes.");
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, usages);
}

export async function signToken(user, secret, now = Date.now(), ttl = TOKEN_TTL_MS) {
  const payload = base64url(encoder.encode(JSON.stringify({ u: user, iat: now, exp: now + ttl })));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, ["sign"]), encoder.encode(`v1.${payload}`));
  return { token: `v1.${payload}.${base64url(signature)}`, expiresAt: now + ttl };
}

// Returns {user, expiresAt} for a genuine, unexpired token and null for anything else (forged, altered, expired).
export async function verifyToken(token, secret, now = Date.now()) {
  const [version, payload, signature, extra] = String(token ?? "").split(".");
  if (version !== "v1" || !payload || !signature || extra !== undefined) return null;
  const key = await hmacKey(secret, ["verify"]);
  try {
    const valid = await crypto.subtle.verify("HMAC", key, fromBase64url(signature), encoder.encode(`v1.${payload}`));
    if (!valid) return null;
    const { u, exp } = JSON.parse(decoder.decode(fromBase64url(payload)));
    return typeof u === "string" && Number.isFinite(exp) && now < exp ? { user: u, expiresAt: exp } : null;
  } catch {
    return null;
  }
}
