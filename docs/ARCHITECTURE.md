# Architecture

What exists today is marked **now**; everything else is planned in `WORK_PLAN.md` and not built.

## Components

| Component | Responsibility | Client data |
| --- | --- | --- |
| GitHub Pages, `web/` (**now**) | Hebrew UI, local files, journal, reports, backup, transfer. Skills and prompts will be served from here too | None stored |
| Cloudflare Worker, `worker/` (**now: `/health` only**) | Phase 1: access code to short-lived token, rate limit, model allow-list, size limits, Gemini proxy | None; bodies are not logged |
| Data root on each PC (**now**) | Clients, declarations, images, history, reports, `rules.md` (planned) | Yes, local only |
| Google Drive shared folder (planned, phase 7) | Encrypted write-once store (packs, snapshots) and baton files | Encrypted only |

```text
GitHub Pages: web/            (Ctrl+F5 updates UI, skills and prompts)
 ├─ journal, clients, reports        (now, ported from ocr)
 ├─ intake: drop zone → inbox/       (phase 2, no AI)
 ├─ assistant panel: orchestrator → tools (JS) → data root   (phase 4)
 └─ skills/*/SKILL.md                (phase 5)
        │  6-character access code → short-lived token, kept in page memory only
Cloudflare Worker: worker/    stateless Gemini proxy
        │
Data root (local folder, never inside a synced folder)
 ├─ common/                    chart-of-accounts.json, custom-rivhit-mapping.json, classification-codes.json,
 │                             ui-settings.json, backup-state.json
 ├─ inbox/<client>/, inbox/_unsorted/   (planned)
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

## Browser storage (decision of step 0.2)

The app lives on the origin `https://vitaliksh.github.io`, the same as ocr, so browser storage is shared by the two apps
unless names differ. This app uses its own IndexedDB `annateria-workspaces-v1` (`DATABASE_NAME` in
`web/backup-handles.js`; store `settings`: the data-root handle, the backup folder handles, the non-extractable backup
key). ocr keeps `rivhit-local-workspaces-v1`. Consequences: on first use the data root is picked again and the recovery
code typed once. `localStorage` keys `annateria-column-widths-v2` and `annateria-sidebar-v1` are identical in both apps
(UI preferences only). On-disk format names such as `annateria-backup` and the encryption AAD strings are unchanged.

## Not tax advice

The app supports bookkeeping decisions of a human; the reports follow `docs/REPORTS_SPEC.md`.
