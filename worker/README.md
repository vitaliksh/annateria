# Cloudflare Worker

The thin, stateless proxy between the browser and Gemini (see `../docs/WORK_PLAN.md`, phase 1). The API key and the
access-code hashes live only in Worker secrets; client data is never stored and request bodies are never logged.

**Current state (step 0.3):** only `GET /health` and CORS for `ALLOWED_ORIGINS`. The Telegram, R2, upload-session,
passkey and recognition routes of ocr are removed; the access code (1.1) and the model proxy (1.2) are not built yet,
and nothing here may call Gemini before they are.

```powershell
npm install
npm test
npm run check   # wrangler deploy --dry-run
```
