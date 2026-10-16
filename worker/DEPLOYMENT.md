# Production recovery checklist

This document records non-secret information needed to identify, verify or
redeploy the Cloudflare component. It is safe to keep in Git.

## Known production baseline

| Item | Value |
| --- | --- |
| Worker name | `rivhit-telegram-transfer` |
| Public URL | `https://rivhit-telegram-transfer.vitaliksh.workers.dev` |
| Cloudflare version ID | `ddcbff1d-f809-43e4-996f-221a85fbd21d` (13 Oct 2026, backend `2026.10.13.1 · 18:00 IDT`; images sent to the bot as a file (JPG, PNG) are received as originals; before it `af952b07-bd8d-47dd-b65b-7c4cca19d2a5`, 11 Oct 2026, backend `2026.10.11.1 · 18:35 IDT`; the route `POST /v1/sessions/{id}/bookkeeper` authorised by the Telegram session; previous: `b1bd722a-2021-400a-b503-7ea2f33e3104`, usable for a rollback) |
| Source commit | `f11541c` (image files, 13 Oct 2026; the version marker bump is the commit after it); before it `4a4475d` (session route of 11 Oct 2026); before it `223a5e1` (`Add the button 'עיבוד חשבונאי'…`; the bookkeeper agent route `POST /v1/bookkeeper/process` on top of the OCR agent release) |
| Git tag | `cloudflare-production-2026-10-13` (annotated; `cloudflare-production-2026-10-11` is the session-route release before it; `cloudflare-production-2026-10-10` is the bookkeeper agent release before it; `cloudflare-production-2026-10-09` is the OCR agent release before it) |
| Durable Objects | `UPLOAD_SESSION` / `UploadSession`; `DEVICE_REGISTRY` / `DeviceRegistry` |
| R2 bucket | `rivhit-temporary-photos` |

The listed source commit identifies this known production baseline. The current
`main` branch can be newer and must not be deployed merely to make a backup.

## Required Cloudflare secrets

Set these names as Worker secrets in Cloudflare. Their values must live in an
approved password manager, not in this repository or a workspace.

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `GEMINI_API_KEY`
- `ALLOWED_TELEGRAM_USER_ID`

`wrangler.toml` contains non-secret values: `BOT_USERNAME` and
`ALLOWED_ORIGINS`. Confirm both before deploying. The GitHub Actions repository
variable `TELEGRAM_TRANSFER_API` must equal the public Worker URL.

## Verify or restore

```powershell
Set-Location D:\projects\ocr\cloudflare-worker
npm install
npm run check
node node_modules\wrangler\bin\wrangler.js deployments list
```

To inspect the exact recorded production source locally, use:

```powershell
git switch --detach 223a5e1
```

Do not deploy from that detached checkout. Return to `main`, review the
intended release, run the checks above, then deploy deliberately:

```powershell
node node_modules\wrangler\bin\wrangler.js deploy
```

After a deployment, record its Cloudflare version ID and source commit here,
create a new annotated `cloudflare-production-YYYY-MM-DD` tag, and push the
tag to GitHub. Test: create a browser upload session, connect Telegram, send a
photo, confirm it reaches the journal, then Finish and confirm the bot rejects
a later photo.
