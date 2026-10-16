# Cloudflare Worker

The thin, stateless proxy between the browser and Gemini (see `../docs/WORK_PLAN.md`, phase 1). The API key and the
access-code hashes live only in Worker secrets; client data is never stored and request bodies are never logged.

**Current state (step 1.2):** `GET /health`, CORS for `ALLOWED_ORIGINS`, `POST /v1/auth` and `POST /v1/model`. Nothing here may
call Gemini before `requireUser()` (in `src/index.js`) has accepted the caller's token.
The Telegram, R2, upload-session, passkey and recognition routes of ocr are gone.

## Access code (`POST /v1/auth`)

`{ "code": "K7M2QX" }` → `200 { token, user, expiresAt }`, `400` (format), `401` (wrong), `429` + `Retry-After` (locked
out), `503` (secrets missing or broken, or the guard unreachable: it fails closed).

- A code is 6 characters of `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (30 bits), one per user. The secret `ACCESS_CODES` holds a
  JSON object `{ "anna": "pbkdf2-sha256$<iterations>$<salt>$<hash>", ... }`; the iteration count is part of each entry.
- A token is `v1.<payload>.<HMAC-SHA256>` signed with the secret `TOKEN_SIGNING_KEY` (at least 32 random bytes,
  base64url), valid for 12 hours. It is stateless: there is no revocation; to cut everybody off, replace the signing key.
- Lock-out (`src/auth-guard.js`, a SQLite-backed Durable Object): 5 attempts per address per 15 minutes, then 15 minutes
  of lock-out; 20 attempts per hour for all addresses together. Attempts are counted when they start and given back on
  success. A wrong guess storm therefore also blocks the real users for up to an hour; this is deliberate. If it happens
  wait: the attempts leave the window one by one.

## Model proxy (`POST /v1/model`)

`Authorization: Bearer <token>` and a body `{ "model": "...", "stream": false, "request": { contents, systemInstruction?, generationConfig?, tools?, toolConfig? } }`.
The Worker forwards `request` to `models/<model>:generateContent` (or `:streamGenerateContent?alt=sse` when `stream` is true;
the event stream is passed through) with the Gemini key in the `x-goog-api-key` header. What it refuses (400, before Gemini is
called): a model outside `ALLOWED_MODELS`, any unknown field (cached content, labels, store, service tier, safety settings...),
file links (`fileData`), tools other than function declarations (no search, code execution or URL reading), inline data other
than JPEG, PNG, WEBP, HEIC, HEIF and PDF, `candidateCount` above 1, and `maxOutputTokens` above 32768 (default 8192 when missing).
Over 20 MiB: 413. Errors are short and generic (`busy` 429, `unavailable` 502, `rejected` 502): Gemini's own message is never
passed on, and nothing from the request or the answer is logged (only the status number of a failure). No retries here: the
caller decides. Rules and limits are in `src/model.js`; the sources are in `../docs/HANDOFF.md`.

### Create the secrets

Also set the Gemini key (a paid-tier key, see `AGENTS.md`): `npx wrangler secret put GEMINI_API_KEY`.

The access secrets are made on the owner's PC, with the output folder **outside** the repository (the script refuses otherwise):

```powershell
node scripts/access-codes.mjs C:\secrets\annateria anna vitalik
Get-Content C:\secrets\annateria\access-codes.json -Raw | npx wrangler secret put ACCESS_CODES
Get-Content C:\secrets\annateria\token-signing-key.txt -Raw | npx wrangler secret put TOKEN_SIGNING_KEY
Remove-Item C:\secrets\annateria -Recurse
```

The codes appear only in that terminal; give each person their own and store them nowhere else.

```powershell
npm install
npm test
npm run check   # wrangler deploy --dry-run
```
