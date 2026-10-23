# Cloudflare Worker

The thin proxy between the browser and Gemini (see `../docs/WORK_PLAN.md`, phase 1), plus the baton "who works" of step 7.4.
The API key and the access-code hashes live only in Worker secrets; client data is never stored and request bodies are never
logged. The only stored state is the login lock-out and the baton record (device ids and names, times, a snapshot file name).

**Current state (step 7.4.1):** `GET /health`, CORS for `ALLOWED_ORIGINS`, `POST /v1/auth`, `POST /v1/model` and the baton
(`GET /v1/baton`, `POST /v1/baton/beat`, `POST /v1/baton/release`). Nothing here but `/health` and `/v1/auth` answers before
`requireUser()` (in `src/index.js`) has accepted the caller's token.
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

## Baton "who works" (`/v1/baton`, step 7.4)

The two PCs never work at the same time; one record (`src/baton.js`, a SQLite-backed Durable Object `BATON`, migration `v2`)
says which **device** works now. A device is a random id (`[a-z0-9-]{8,64}`) and a name such as `ANNA-PC` (one line, at most 40
characters), both kept by the browser; the user comes from the token, the time from the Worker (a body never sets it).

- `GET /v1/baton` → `{ now, live, holder, snapshot }`. `holder` = `{ device, deviceName, user, since, lastBeat, released }`;
  `live` is true while the holder has not released and beat less than 3 minutes ago. `snapshot` = the last snapshot a holder
  reported (`{ name, at, device, deviceName }`), so the next device knows which data to wait for in the shared Drive folder.
- `POST /v1/baton/beat` `{ device, deviceName, snapshot?, force? }` takes a free baton or keeps one's own (`took`, `since`
  changes only when it changes hands). While another device is live: `409 { code: "taken" }`, unless `force` ("start anyway"),
  which answers `forced` and the `previous` holder.
- `POST /v1/baton/release` `{ device, snapshot? }` frees it at once ("finish work"); another device gets `409 { code: "not-holder" }`.
- Errors: 401 without a valid token, 400 for a bad device, name or snapshot name, 413 over 1 KB, 503 when the record is missing or
  unreachable (the page then works with a warning).

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
