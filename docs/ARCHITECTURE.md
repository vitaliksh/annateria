# Architecture

What exists today is marked **now**; everything else is planned in `WORK_PLAN.md` and not built.

## Components

| Component | Responsibility | Client data |
| --- | --- | --- |
| GitHub Pages, `web/` (**now**) | Hebrew UI, local files, journal, reports, backup, transfer. Skills (`skills/*/SKILL.md`) and prompts are served from here too | None stored |
| Cloudflare Worker, `worker/` (**now: `/health`, `/v1/auth`, `/v1/model`**) | Access code to a 12-hour token and lock-out (1.1); constrained Gemini proxy with model allow-list, size and output limits (1.2) | None; bodies are not logged |
| Data root on each PC (**now**) | Clients, declarations, images, history, reports, `rules.md` (planned) | Yes, local only |
| Google Drive shared folder (planned, phase 7) | Encrypted write-once store (packs, snapshots) and baton files | Encrypted only |

```text
GitHub Pages: web/            (Ctrl+F5 updates UI, skills and prompts)
 ├─ journal, clients, reports        (now, ported from ocr)
 ├─ intake: drop zone → inbox/       (now: dialog "תיבת קלט", no AI)
 ├─ assistant panel: orchestrator → tools (JS) → data root   (loop and 11 tools in web/agent/, the dock in assistant-ui.js, rows through row-builder.js)
 └─ skills/*/SKILL.md                (now: 3 skills, fetched at the start of every run; a missing one stops the run)
        │  6-character access code → short-lived token, kept in page memory only
Cloudflare Worker: worker/    stateless Gemini proxy
        │
Data root (local folder, never inside a synced folder)
 ├─ common/                    chart-of-accounts.json, custom-rivhit-mapping.json, classification-codes.json,
 │                             ui-settings.json, backup-state.json
 ├─ inbox/<client>/, inbox/_unsorted/   (2.1 inbox-store.js, 2.2-2.3 inbox-ui.js dialog) + inbox/index.json + inbox/_trash/
 │                             (SHA-256, original name, size, type, source date, added-at; written locally, never write-once)
 └─ clients/<client>/          workspace.json, history.jsonl, report-settings.json, reports/ (PDFs), rules.md (planned)
       declarations/YYYY-MM/   declaration.json, draft-table.json (+ draft-table.before-<action>-<time>.json copies), images/
        │  push after every save / pull on open, fast-forward only   (phase 7)
Google Drive shared folder: encrypted write-once store + baton
```

The folder layout and file formats are those of ocr: an existing data root opens unchanged. A change to a format is an
explicit, versioned migration with a test and a copy made before it (`AGENTS.md`).

## Boundaries (summary; the binding text is `AGENTS.md`)

- **AI decides, code computes and writes.** Amounts, VAT, duplicates, year, periods, the 25% utilities rule and the
  allocation ceiling come from `row-calculations.js`, `intake-facts.js`, `home-utilities.js`, `reports.js`. The agent
  changes data only through the tools of `docs/AGENT_TOOLS.md` (phase 4), never edits OCR facts, never closes a month.
  Closing is an app button with a confirmation.
- **Secrets only in the Worker** (Gemini key, access-code hashes, token signing key). The browser holds the access code
  and the token in memory only. Only the paid Gemini tier is used for client documents.
- **Import has no AI**: files go to `inbox/`, de-duplicated by SHA-256.
- **Google Drive** receives only AES-GCM encrypted write-once files; the app never overwrites or deletes them.
- **Removed on purpose, do not bring back:** Telegram bot and upload sessions, R2, QR codes, passkey / Windows Hello /
  `DeviceRegistry`, the Rivhit TXT export, the Python application.

## Access code (step 1.1)

The browser sends the 6-character code to `POST /v1/auth`; the Worker compares it with salted PBKDF2 hashes in the secret
`ACCESS_CODES` and answers with a token signed (HMAC) with the secret `TOKEN_SIGNING_KEY`. The token lives in page memory
only (`web/access.js`): a reload asks for the code again. Failed attempts are counted by one Durable Object
(`worker/src/auth-guard.js`) because Cloudflare's Rate Limiting binding is per location and eventually consistent by design.
The code protects the Worker (and so the Gemini key and budget), not the local data, which stays readable on the PC.
Any model route must start with `requireUser()`. Details and limits: `worker/README.md`.

## Model calls (step 1.2)

The page calls `POST /v1/model` with the token (`web/model-client.js`: `generate`, `stream`, one re-login on a 401). The Worker
validates the request against a short allow-list (`worker/src/model.js`) and forwards it to Gemini; prompts, skills and tools
come from the page, so they change with Ctrl+F5, not with a Worker deployment. The allow-list of models changes in code
(`ALLOWED_MODELS`), after phase 3 has chosen the defaults.

## Browser storage (decision of step 0.2)

The app lives on the origin `https://vitaliksh.github.io`, the same as ocr, so browser storage is shared by the two apps
unless names differ. This app uses its own IndexedDB `annateria-workspaces-v1` (`DATABASE_NAME` in
`web/backup-handles.js`; store `settings`: the data-root handle, the backup folder handles, the non-extractable backup
key). ocr keeps `rivhit-local-workspaces-v1`. Consequences: on first use the data root is picked again and the recovery
code typed once. `localStorage` keys `annateria-column-widths-v2` and `annateria-sidebar-v1` are identical in both apps
(UI preferences only). On-disk format names such as `annateria-backup` and the encryption AAD strings are unchanged.

## Not tax advice

The app supports bookkeeping decisions of a human; the reports follow `docs/REPORTS_SPEC.md`.
