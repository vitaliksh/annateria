# Deployment record

Non-secret facts needed to identify, verify or redeploy the Cloudflare component. Safe to keep in Git.

## Production baseline

Not deployed yet. Step 1.4 of `docs/WORK_PLAN.md` deploys a **new** Worker (`annateria`) and records here its public
URL, the Cloudflare version ID, the source commit and a `cloudflare-production-YYYY-MM-DD` tag. The Worker of the ocr
project (`rivhit-telegram-transfer`) is a separate deployment owned by the ocr repository and is not touched from here.

## Secrets (Worker secrets only, values in a password manager, never in the repository)

To be listed when 1.1 and 1.2 define them (Gemini API key, access-code hashes, token signing key).
