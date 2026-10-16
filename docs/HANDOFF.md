# Hand-off notes

Facts a new developer or agent needs that the code does not say. Keep it true: update it in the commit that changes
the fact. The plan and its decision log are in `WORK_PLAN.md`; rules that must not be broken are in `../AGENTS.md`.

## Start here (state at the end of 16 October 2026)

**Done:** phases 0 and 1 (steps 0.1–1.4), all committed and pushed to `main`; the last commit before this note is `e57b5e4`; the
Worker tag is `cloudflare-production-2026-10-16`. The owner accepted the published page: months open and match ocr, the access code
works, "בדיקת חיבור ל‑AI" gets an answer from Gemini.

**Next:** phase 2 (intake without AI), first step **2.1 Inbox model** (`inbox/<client>/`, `inbox/_unsorted/`, `inbox/index.json` with
SHA-256, dedup, unit tests). Phase 3 (model bake-off, outside the repository) can run in parallel; it needs the owner's real documents and
an answer key. The owner decides the order; do not start the next step without his "yes" (`AGENTS.md`).

**Open items for the owner** (not blocking): set a monthly spend cap in AI Studio ("Set spend cap") and use a separate API key for this
project; give Anna her access code if not done; tell me the Cloudflare plan (Free or Paid) so it can be recorded.

**Rules of the house** are in `AGENTS.md` (Russian; answer the owner in Russian, "ты", Vitalik; code, comments and commits in English).
Commit messages end with the `Co-Authored-By` line given by the session. One step = one commit; tests, docs and the plan checkboxes in the
same commit. A push to `main` publishes GitHub Pages when `web/` changed, so push only what is tested.

### Working notes (things that cost time in this project)

- **Secrets never pass through the chat or the agent.** The owner sets Worker secrets in his own terminal (`worker/README.md`). Do not read
  `worker/.dev.vars`. `gh` is not installed; the owner creates GitHub repositories and Cloudflare things by hand; `npx wrangler deploy` works
  (logged in as the owner).
- **jsdom is not a browser.** It lets `pcnJournal = ...` (undeclared) pass, has no modal `<dialog>`, and `"use strict"` does not help there. The
  harness (`web/test/app-harness.mjs`) therefore fails on undeclared globals and sets `ANNATERIA_API = ""`. After a removal or refactor in
  `app.js`, open a month in a browser on the published page: 0.3 broke this once.
- **Editing big files:** the repository is checked out with CRLF (Git autocrlf warnings are normal). Scripts that replace text should
  normalise `
` first. Long here-documents with apostrophes or backticks sometimes break the shell tool; write such files with the file tool.
- **A check that finds nothing is not a proof**: when removing code, grep for every removed identifier and also for removed `let` / `const`.
- Cloudflare, Gemini, browser APIs and laws change: check the official docs and put source and date in this file (sections below).

## Deployed versions

| What | Where | Version / how to check |
| --- | --- | --- |
| Web app | <https://vitaliksh.github.io/annateria/> (GitHub Pages, workflow `deploy-web.yml`, every push to `main` touching `web/`) | Build marker at the bottom of the sidebar: `YYYY.MM.DD · <short commit>`. After a deploy press Ctrl+F5 and compare it with `git rev-parse --short HEAD` |
| Worker | `https://annateria.vitaliksh.workers.dev`, version `2026.10.16.2` (Cloudflare `8d2350b4`), record in `worker/DEPLOYMENT.md` | `GET /health` answers `BACKEND_VERSION` |
| Predecessor | ocr: `https://vitaliksh.github.io/ocr/` and the Worker `rivhit-telegram-transfer` | Not touched from this repository |

`web/config.js` sets `window.ANNATERIA_API` to the Worker URL; the sidebar shows the Worker version, and the login dialog opens on page load.

## How to run the checks

```powershell
cd web;    npm ci; npm test; npm run check   # node --test, 442 tests; check = node --check on every module
cd worker; npm ci; npm test; npm run check   # 54 tests; check = wrangler deploy --dry-run
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

## Changes to inherited code (phase 1)

Phase 1 is mostly new code: `web/access.js`, `web/access-ui.js`, `web/model-client.js`, `worker/src/*`. It touched inherited files as follows:
`web/app.js` (imports, the login on load, the model client, the settings button), `web/index.html` (`#access-dialog`, the check button),
`web/config.js` (the Worker URL), `web/package.json` (check list), and the test harness (`ANNATERIA_API` set to empty, the leaked-globals check).

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
- Prices on 16 October 2026 (<https://ai.google.dev/gemini-api/docs/pricing>, dated 15 Oct), paid tier, USD per 1M tokens, input / output:
  `gemini-3.5-flash-lite` 0.30 / 2.50; `gemini-3.6-flash` and `gemini-3.8-flash` 0.75 / 3.75 until 31 Dec 2026, then 1.50 / 7.50;
  `gemini-3.1-pro-preview` 2.00 / 12.00; `gemini-4-argon` 2.00 / 10.00 until 30 Nov 2026, then 4.00 / 20.00. Batch is half. Output includes thinking.
  A rough estimate (4k tokens in, 0.5k out) is 0.25 cent a document with Flash-Lite, 0.5 cent with Flash, about 1.3 cents with Pro or Argon, so price is
  not the deciding factor; accuracy is. Provisional view before phase 3 (not measured): documents and assistant on `gemini-3.8-flash`, a Pro/Argon
  model as the fallback for hard documents, Flash-Lite for small jobs.
- Not found in the docs I read: the exact limit of the request body on the Workers side (Cloudflare documents a body limit per plan; not checked) and
  the paid-tier data-use terms (that is step 1.3).

## Paid tier of Gemini (step 1.3)

- Date: 16 October 2026. Seen by the owner in Google AI Studio, page "Gemini API Spend": project **OCR project**
  (`gen-lang-client-0360506095`) shows the badge **Tier 1**. The key of this project is the one stored as `GEMINI_API_KEY`.
  The project "Default Gemini Project" is marked with a warning and "Work" is another work; neither is used.
- Why it matters: the Gemini API terms (<https://ai.google.dev/gemini-api/terms>, read 16 Oct 2026) say that for Unpaid Services Google
  uses prompts and answers to improve its products and "human reviewers may read, annotate, and process" them, and that for Paid Services it
  does not use them for that and only logs them for a limited time to detect abuse. Grounding with Google Search is stored for 30 days (not used here).
- The statement "Tier 1 means billing is enabled" is my reading of the badge, not a line quoted from Google. Open item: the owner sets a spend cap
  ("Set spend cap") and uses a separate key for this project, so that its cost is visible on its own.
- Prices on 16 Oct 2026 (<https://ai.google.dev/gemini-api/docs/pricing>, page dated 15 Oct): see the decision log of phase 3 when models are chosen.

## Not verified yet

- Anything beyond opening a month and comparing data with ocr (owner check of 16 October 2026). The rest of the UI
  (Excel import, reports PDF, backup, transfer) was not clicked through after the 0.3 removals.
- Streaming (`stream: true`) and the timeouts (120 s / 300 s) have never run against the real Gemini; only the non-streaming call was tried by the owner.
- The lock-out was tested in node only, not by typing wrong codes five times in a browser. The CPU time of PBKDF2 was not measured (the login simply worked).
- The Cloudflare plan of the account (Free or Paid) is not recorded.
- The `deploy-web.yml` test job passed once on GitHub (Node 24); no other CI exists.
