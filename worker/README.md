# Cloudflare Worker

This is the deployable cloud component of Rivhit document intake. It bridges
Telegram to the browser through short-lived sessions and sends an in-memory
image to Gemini for pass-1 extraction. It never keeps completed client
workspaces, PDFs, TXT exports or history.

## One-time setup

1. Create a private Telegram bot with BotFather and note its username.
2. In Cloudflare, create an R2 bucket named `rivhit-temporary-photos` (or change `wrangler.toml`).
3. In this directory, run `npm install`, then `npx wrangler login` and `npx wrangler deploy`.
4. Set the three Worker secrets. Do not place their values in a source file:

   ```powershell
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
   ```

   Before enabling Gemini processing, also set these Worker secrets:

   ```powershell
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler secret put ALLOWED_TELEGRAM_USER_ID
   ```

   Send `/whoami` to `@Vitalikshbot` to receive your Telegram numeric user ID. The second secret restricts Gemini processing to that account, so a visitor to the public page cannot consume the Gemini quota.

5. Replace `BOT_USERNAME` and `ALLOWED_ORIGINS` in `wrangler.toml`, deploy again, then set the Telegram webhook:

   ```powershell
   $workerUrl = "https://YOUR-WORKER.workers.dev"
   $secret = Read-Host "Telegram webhook secret"
   Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook" -Body @{url="$workerUrl/telegram/webhook";secret_token=$secret}
   ```

The public Worker URL is not a secret. Copy it to `telegram-web/config.js`, set
the GitHub Pages origin in `ALLOWED_ORIGINS`, and publish the `telegram-web`
directory as GitHub Pages.

## Manual test

Open the hosted page, select a local workspace and the canonical template,
start upload, scan the QR code, send two photos through Telegram, and confirm
that both rows appear. Press **Finish**, then send one more photo: the bot must
reject it.
