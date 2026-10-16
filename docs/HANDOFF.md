# Hand-off notes

Facts a new developer or agent needs that the code does not say. Keep it true: update it in the commit that changes
the fact. The plan and its decision log are in `WORK_PLAN.md`; rules that must not be broken are in `../AGENTS.md`.

## Deployed versions

| What | Where | Version / how to check |
| --- | --- | --- |
| Web app | <https://vitaliksh.github.io/annateria/> (GitHub Pages, workflow `deploy-web.yml`, every push to `main` touching `web/`) | Build marker at the bottom of the sidebar: `YYYY.MM.DD · <short commit>`. After a deploy press Ctrl+F5 and compare it with `git rev-parse --short HEAD` |
| Worker | **Not deployed.** `worker/wrangler.toml` names it `annateria`; step 1.4 deploys it and records version and URL in `worker/DEPLOYMENT.md` | `GET /health` once deployed |
| Predecessor | ocr: `https://vitaliksh.github.io/ocr/` and the Worker `rivhit-telegram-transfer` | Not touched from this repository |

`web/config.js` sets `window.ANNATERIA_API` (empty until step 1.4); the sidebar then shows the Worker version.

## How to run the checks

```powershell
cd web;    npm ci; npm test; npm run check   # node --test, 442 tests; check = node --check on every module
cd worker; npm ci; npm test; npm run check   # 51 tests; check = wrangler deploy --dry-run
```

`npm ci` warns that `esbuild` / `workerd` install scripts are blocked; tests and checks work anyway. The app tests load the
real `index.html` and a bundle of `app.js` into jsdom (`web/test/app-harness.mjs`). jsdom is more forgiving than a browser:
the harness therefore fails when `app.js` leaves an undeclared global, but a green run does not replace opening a month on
the published page (0.3 shipped a missing `let` that only a browser showed).

## Repository map

`web/` has no build step; `index.html` loads `app.js` as an ES module. Test files are `web/test/<module>.test.mjs`.

- **Shell and views:** `index.html`, `app.js` (wiring, journal table, row restore), `shell.js`, `clients-home.js`,
  `clients-view.js`, `sidebar.js`, `sidebar-clients.js`, `workspace.js` (File System Access: data root, clients,
  declarations), `workspace-core.js` (client config rules), `confirm-dialog.js`, `ui-polish.js`, `ui-settings.js`.
- **Journal table:** `table-column-model.js`, `journal-columns.js`, `journal-toolbar.js`, `journal-summary.js`,
  `row-calculations.js` (recognised amounts), `home-utilities.js` (25% rule), `month-format.js`.
- **Declarations:** `declaration-core.js` (lifecycle: open, locked, reopened), `declaration-store.js` (files),
  `document-package.js`, `month-distribution.js`, `rows-move-flow.js` / `rows-move-ui.js` (spread rows over months),
  `pcn-review.js` / `pcn-review-ui.js` (clients with a PCN duty).
- **Intake rules as code:** `intake-facts.js`, `intake-index.js` (year, period, duplicates), `bookkeeper-flow.js`
  (leftover of the ocr bookkeeper agent, no UI wired since 0.3).
- **Classification:** `rivhit-mapping.js` (Form 6111 map), `custom-rivhit-mapping.js`, `chart-of-accounts.js`,
  `ledger-*.js` (read the classification ledger, fix codes, reconcile with declarations).
- **Imports:** `excel-journal*.js`, `excel-import*.js` (Rivhit journal `.xlsx`), `income-report.js` (income-report PDF),
  `pdf-import.js` (PDF checks; page rendering has no caller now).
- **Reports:** `reports.js` (pure calculations), `report-data.js`, `reports-view.js`, `reports-pdf.js`,
  `report-viewer.js`, `reports-ui.js`, `pdf-report.js` (legacy invoice PDF, no caller now).
- **Backup and transfer:** `backup-store.js`, `backup-state.js`, `backup-handles.js` (IndexedDB), `backup-ui.js`,
  `transfer-store.js`, `transfer-ui.js` (`.annateria` file).
- **Style:** `tokens.css` (the only file with colours; `styles.test.mjs` enforces it), `base.css`, `shell.css`,
  `dialogs.css`, `journal.css`, `clients.css`, `reports.css`, `backup.css`, `sidebar.css`, `photo.css`, `fonts/`.
- `worker/`: `src/index.js` (`/health`, `/v1/auth`, `requireUser`, CORS by `ALLOWED_ORIGINS`, 404 for the rest), `src/access.js`
  (codes, hashes, tokens), `src/auth-guard.js` (lock-out Durable Object), `src/model.js` (what may be forwarded to Gemini), `scripts/access-codes.mjs` (creates codes and
  secret files outside the repository). Web side: `web/access.js` (token in memory), `web/access-ui.js` (login dialog), `web/model-client.js` (calls through the Worker; the settings button "בדיקת חיבור ל‑AI").
- `docs/`: `WORK_PLAN.md`, this file, `ARCHITECTURE.md`, and specs inherited from ocr (`REPORTS_SPEC.md`,
  `BACKUP_SPEC.md`, `EXCEL_IMPORT_SPEC.md`).

## Changes to inherited code (phase 0)

Listed because `AGENTS.md` asks for it; details in the decision log.

- 0.2: IndexedDB name moved to `DATABASE_NAME` in `backup-handles.js`, imported by `workspace.js`.
- 0.3: removed the Rivhit export and template picker (`rivhit-export.js`, parts of `app.js`, `workspace.js`,
  `workspace-core.js`, `index.html`), the passkey code, the Telegram / QR / upload-session code and every client call
  to the old Gemini routes; deleted `bookkeeper-ui.js`; renamed `window.TELEGRAM_TRANSFER_API` to `ANNATERIA_API`;
  rewrote the Worker down to `/health`.
- 0.4: build marker token in `index.html`; removed a duplicated `id="backend-version"`.
- 0.3 follow-up: restored `let pcnJournal` (see the decision log).

## Dead code kept on purpose (decide in phase 4)

`bookkeeper-flow.js` and `applyBookkeeperPlan` / `applyBookkeeperRecheck` in `app.js` (the row `processing` flag still
exists), `renderPdfPages` in `pdf-import.js`, `pdf-report.js`, `createDraftExportDirectory` in `declaration-store.js`,
`history-ranker.js`, the `.retry` CSS. The old bookkeeper prompt and schema stay in `ocr/cloudflare-worker/src/` as input
for the phase 5 skills.

## Cloudflare facts used by step 1.1 (checked 16 October 2026)

- Rate Limiting binding: "local to the Cloudflare location", "eventually consistent", "not … an accurate accounting
  system" (<https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/>), so it cannot be the lock-out.
- Durable Objects are available on the Free plan, SQLite backend only, 100,000 requests per day
  (<https://developers.cloudflare.com/durable-objects/platform/pricing/>).
- CPU time per request: Free 10 ms, Paid 30 s by default (<https://developers.cloudflare.com/workers/platform/limits/>).
- Web Crypto offers PBKDF2, HMAC and SHA-256 (<https://developers.cloudflare.com/workers/runtime-apis/web-crypto/>). The
  page names **no PBKDF2 iteration limit**; a cap of 100,000 is my recollection, not verified.

**Hypothesis to measure in step 1.4:** one PBKDF2 hash with 20,000 iterations per user fits into 10 ms of CPU on the Free
plan (a login hashes against every user, i.e. twice). If `/v1/auth` ends with Cloudflare error 1102 (CPU exceeded) lower the
iterations in a new `ACCESS_CODES` (the count is stored per entry, no code change) or use the Paid plan.

## Gemini API facts used by step 1.2 (checked 16 October 2026)

- Model ids (<https://ai.google.dev/gemini-api/docs/models>): `gemini-3.8-flash` (new, stable), `gemini-3.6-flash`, `gemini-3.5-flash-lite`,
  `gemini-3.1-flash-lite` (stable), `gemini-3.1-pro-preview`, `gemini-4-argon` (flagship, stable). The page recommends 3.5 Flash-Lite or 3.8 Flash for
  new projects. The ids in `ALLOWED_MODELS` are a starting set; phase 3 chooses the defaults.
- REST (<https://ai.google.dev/api/generate-content>): `v1beta/models/{model}:generateContent` and `:streamGenerateContent` (the examples add
  `alt=sse`). The examples put the key in a `key` query parameter; the Worker uses the `x-goog-api-key` header (used by ocr and shown on the
  text-generation page) so that the key cannot appear in a URL. The same docs now also describe an Interactions API; this project uses
  `generateContent` and I did not check whether it is meant to be replaced.
- Inline data limits **disagree between pages**: "20MB total request size" on the image-understanding page, "100 MB per request, 50 MB for PDFs" on
  the file-input page. The Worker uses the smaller one (20 MiB). A phone photo can be bigger: the page must shrink it first (phase 2/4).
- Images: PNG, JPEG, WEBP, HEIC, HEIF; up to 3,600 per request. PDF: up to 50 MB / 1,000 pages, 258 tokens a page.
- Not found in the docs I read: the exact limit of the request body on the Workers side (Cloudflare documents a body limit per plan; not checked) and
  the paid-tier data-use terms (that is step 1.3).

## Not verified yet

- Anything beyond opening a month and comparing data with ocr (owner check of 16 October 2026). The rest of the UI
  (Excel import, reports PDF, backup, transfer) was not clicked through after the 0.3 removals.
- **Step 1.2 "done when" is only half met:** the Worker is tested against a stubbed Gemini; the real call from the published page with the
  owner's key needs the deployed Worker (step 1.4) and `GEMINI_API_KEY`. Streaming and the timeouts (120 s / 300 s) were never run for real.
- The Worker has never been deployed from this repository: the login was tested against the Worker code in node
  (30 tests) and the dialog in jsdom, never against Cloudflare. Real CPU time of PBKDF2 and the Durable Object are unmeasured.
- The `deploy-web.yml` test job passed once on GitHub (Node 24); no other CI exists.
