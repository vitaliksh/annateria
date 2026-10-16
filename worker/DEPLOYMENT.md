# Deployment record

Non-secret facts needed to identify, verify or redeploy the Cloudflare component. Safe to keep in Git.

## Production baseline

| Item | Value |
| --- | --- |
| Worker name | `annateria` (account of vitalish@gmail.com) |
| Public URL | `https://annateria.vitaliksh.workers.dev` |
| Cloudflare version ID | `8d2350b4-132d-4636-b840-437c8293cc78` (16 Oct 2026, backend `2026.10.16.2`); first deployment of the same day: `b9867b6c-a383-4248-b5c0-c27910555d5b` (`2026.10.16.1`) |
| Source commit | `215cdab` |
| Git tag | `cloudflare-production-2026-10-16` |
| Durable Objects | `AUTH_GUARD` / `AuthGuard` (SQLite, migration `v1`) |
| Routes | `GET /health`, `POST /v1/auth`, `POST /v1/model` |

The Worker of the ocr project (`rivhit-telegram-transfer`) is a separate deployment owned by the ocr repository and is
not touched from here.

## Secrets (Worker secrets only, values in a password manager, never in the repository)

- `ACCESS_CODES`, `TOKEN_SIGNING_KEY`: made by `scripts/access-codes.mjs` (see `README.md`). Replacing `TOKEN_SIGNING_KEY`
  logs everybody out; replacing `ACCESS_CODES` changes the codes.
- `GEMINI_API_KEY`: a key of the Google project **OCR project** (`gen-lang-client-0360506095`), Tier 1 (billing enabled);
  see the paid-tier record in `docs/HANDOFF.md`.

`wrangler.toml` holds only non-secret values: `ALLOWED_ORIGINS` and `BACKEND_VERSION` (raise it with every deployment).
The GitHub Pages page learns the Worker URL from `web/config.js`.

## Verify, deploy, restore

```powershell
cd worker
npm ci
npm test
npm run check          # wrangler deploy --dry-run
npx wrangler deployments list
npx wrangler deploy    # after raising BACKEND_VERSION
```

`curl https://annateria.vitaliksh.workers.dev/health` must answer the new `BACKEND_VERSION`. After a deployment record its
Cloudflare version ID and source commit here, create an annotated tag `cloudflare-production-YYYY-MM-DD` and push it.

To inspect the recorded production source: `git switch --detach cloudflare-production-2026-10-16` (do not deploy from a
detached checkout; return to `main`).

## Acceptance test of 16 October 2026

By the owner on the published page: the login dialog accepted the access code, and the button "בדיקת חיבור ל‑AI" in the
settings reached Gemini through `/v1/model`. A wrong code, the lock-out in a browser and streaming were not tried by hand.
