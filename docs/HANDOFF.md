# Hand-off notes

Facts a new developer or agent needs that the code does not say. Keep it true: update it in the commit that changes
the fact. The plan and its decision log are in `WORK_PLAN.md`; rules that must not be broken are in `../AGENTS.md`.

## Start here (state at the end of 16 October 2026)

**Done:** phases 0 and 1 (steps 0.1–1.4), all committed and pushed to `main`; the last commit before this note is `e57b5e4`; the
Worker tag is `cloudflare-production-2026-10-16`. The owner accepted the published page: months open and match ocr, the access code
works, "בדיקת חיבור ל‑AI" gets an answer from Gemini.

**Done since:** phase 2 is complete: **2.1 Inbox model**, **2.2 Drop zone and picker**, **2.3 Inbox view** (all accepted by the owner) and
**2.4 Phone guide** (`web/inbox-store.js`, `web/inbox-ui.js`, the help dialog in `index.html`). 2.4 still needs the owner's read-through on a real phone.

**Done:** step **4.1 Tool contract**: `docs/AGENT_TOOLS.md` is **approved** (16 October 2026, all ten recommendations of its section 10 taken). It is the
specification for 4.2 onwards; a change to it needs the owner's approval.

**Done:** steps 4.1 to **4.4** (the agent reads, checks, adds rows, files the originals, and its proposals can be applied); 4.5 (routing) is built with 4.4. **Next, for the
owner:** the same run as before, now with files: put a document of a client into "תיבת קלט" (best in the folder of that client), press "בדוק מסמכים חדשים" or "בדוק עם העוזר", and look at
the table: a row, its status, its original (the PDF button), and the cards. **Next step:** block 4.7 (all imports through the inbox; 4.7.1 and 4.7.2 are built, waiting for the owner's real run; next 4.7.3 `ledger_codes`), then 4.6 client memory (`remember_rule`, `rules.md`), then phase 5 (skills and eval). The
owner decides the order; do not start the next step without his "yes" (`AGENTS.md`).

**Open items for the owner** (the Cloudflare plan now matters: see "General check of 16 October"): set a monthly spend cap in AI Studio ("Set spend cap") and use a separate API key for this
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
cd web;    npm ci; npm test; npm run check   # node --test, 715 tests; check = node --check on every module
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
- **Intake rules as code:** `intake-facts.js`, `intake-index.js` (year, period, duplicates), `table-backup.js`
  (the copy of a table before the agent writes to it).
- **Agent (phase 4):** `web/agent/`: `run.js` (the loop, `createContext`), `registry.js` (closed list of tools, dispatch, result envelope), `schema.js` (argument check and
  the Gemini declaration from one schema), `handles.js`, `limits.js`, `run-log.js`, `gemini.js` (the model of the loop over `model-client.js`), `services.js` (the only way for
  a tool to reach data), `tools/` (nine so far: `list_inbox`, `read_document`, `extract_document`, `find_client`, `get_client_context`, `query_rows`, `facts_for`, `ask_user`, `propose_change`),
  `adapters/` (`documents.js`: inside of files; `extraction.js`: the vision call), `web/assistant-ui.js` (the dock), `web/assistant-flow.js` (runs the agent for the dock), `assistant.css`, `web/model-settings-ui.js` (the model selects of the settings), `fact-record.js`, `prompts.js`, `models.js`, `kinds.js`, `semaphore.js`; `rules-store.js` (reads `rules.md`). Specification: `docs/AGENT_TOOLS.md`. Not wired into `app.js` yet (4.3).
- **Rows of the agent (4.4):** `row-builder.js` (the row from a fact and a decision), `proposal-apply.js` (the apply button), `agent/facts.js`, `agent/answers.js`; the page side is
  `appendSnapshots`, `setRowImage`, `attachRowImages`, `openPdf`, `proposalOps` in `app.js`.
- **Inbox:** `inbox-store.js` (originals dropped by the user, `inbox/index.json`, SHA-256 dedup against the inbox and all declaration
  images; the Windows file-name rules and the accepted file types live here), `inbox-ui.js` + `inbox.css` (`#inbox-dialog`: drop target, picker,
  client choice, result lines; opened by `#open-inbox`). The backup already copies `inbox/` with the rest of the root.
- **Classification:** `rivhit-mapping.js` (Form 6111 map), `custom-rivhit-mapping.js`, `chart-of-accounts.js`,
  `ledger-*.js` (read the classification ledger, fix codes, reconcile with declarations).
- **Imports:** `excel-journal*.js`, `excel-import*.js` (Rivhit journal `.xlsx`), `income-report.js` (income-report PDF),
  `pdf-import.js` (PDF checks, pdf.js loader).
- **Reports:** `reports.js` (pure calculations), `report-data.js`, `reports-view.js`, `reports-pdf.js`,
  `report-viewer.js`, `reports-ui.js`.
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

## Changes to inherited code (phase 2)

- 2.1: `web/package.json` (check list) and `web/test/memory-binary-directory.mjs` (additive `removeEntry`). No production module changed.
- 4.4: `web/app.js` (`rowSnapshot` and `restoreRow` carry `agent`; an agent row has its own status and not "marks missing"; `appendSnapshots`, `setRowImage`, `attachRowImages`, `openPdf`, `isPdfRow`, `proposalOps`,
  the live table and `onDeclarationCreated` of the assistant flow), `web/workspace.js` (the dead call in `refreshFromUserAction` removed), `web/index.html` unchanged, `web/package.json`, `web/test/app-harness.mjs` (more exposed names).
- Model choice: `web/ui-settings.js` (`models`, the overrides), `web/index.html` (three selects in the settings dialog), `web/app.js` (`modelSettings`; the connection check and the flow use it), `web/package.json`.
- 4.3: `web/app.js` (two imports, `assistantFlow`, `runAssistant`, `setupAssistant` after the AI check), `web/index.html` (the `#assistant` section, `assistant.css`), `web/shell.css` (a fourth grid row), `web/package.json`.
- 4.2b: `web/intake-facts.js` (`intakeFacts` takes an optional `targetMonth`; no caller passes it yet except `facts_for`).
- 4.2: `web/intake-facts.js` (`nameTokens` is now exported, nothing else changed), `web/package.json` (check list). The rest is new files under `web/agent/`.
- 2.4: `web/index.html` (help dialog, guide button), `web/inbox-ui.js` (the button handler), `web/inbox.css`.
- 2.3: `web/sidebar-clients.js` (optional `inboxCounts`), `web/workspace.js` (optional `getInboxCounts`; returns `renderSidebar`), `web/app.js`
  (`inboxUi`, `inboxFileCounts`, `onCounts`, a refresh in `switchDataRoot`), `web/index.html` (list, count line, clear button, nav badge).
- 2.2: `web/app.js` (one import and one `setupInbox(...)` call next to `setupTransfer`), `web/index.html` (sidebar item `#open-inbox`, `#inbox-dialog`,
  `inbox.css` link), `web/package.json` (check list).

## Dead code removed (17 October 2026, a separate refactor commit)

The leftovers of step 0.3 are gone, as the owner approved in the contract (question 8): `bookkeeper-flow.js` (only `backupTable` lives on, in
`table-backup.js`), `applyBookkeeperPlan` / `applyBookkeeperRecheck` in `app.js`, the row `processing` flag (old drafts that still carry it
are read as before, the key is ignored), `renderPdfPages` in `pdf-import.js`, `pdf-report.js`, `createDraftExportDirectory` in
`declaration-store.js`, `history-ranker.js`, the `.retry`, `waiting-agent`, `bookkeeper-plate` and `data-processing` CSS, and the tests of
these. Behaviour is unchanged. The old bookkeeper prompt and schema stay in `ocr/cloudflare-worker/src/` as input for the phase 5 skills.

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

## Agent core (step 4.2, built 16 October 2026)

What exists: the loop, the closed registry with validation and the result envelope, run-local handles, limits, cancel, the run log
(`common/agent-runs/<id>.json` through `writeRunLog`; nothing calls it yet), the write guards of the context (`ensureCopy` once per run and declaration,
`requireOpen` refuses anything but an open declaration), the Gemini adapter and four tools. It has only run against a scripted model: **no real Gemini call was
made**, and no code in `app.js` starts it. Decisions on the way:

- `propose_change` takes `value` as text and parses it by the field (a number as `123.45`, a yes/no as `true`/`false`, a date as `2026-03-14` or in the journal
  format): a Gemini schema cannot say "any type", and a text field keeps one declaration for every field. The contract's "the value has the type of the field" holds after parsing.
- `find_client` ignores legal suffixes (`Ltd`, `בע״מ`) through `nameTokens`: "Levi Plumbing" is an exact match for "Levi Plumbing Ltd"; a name inside a longer one, or the
  other way round, is partial; one shared word is nothing.
- `list_inbox` cuts a page at about 15 KB so that the 20 KB result cap is never hit; `next` continues.
- The `exclusive` flag of a tool (`ask_user`) makes the calls of one model turn run one after the other; the other tools run together.
- The tests that keep the contract: `test/agent-boundary.test.mjs` (the tool list equals the headings of the document: built plus `PENDING_TOOLS`; no tool name starting with an
  action verb; `services` has five operations and none that closes, deletes or writes; tool files import only the error class and pure helpers; only `services.js` reaches
  the stores; no `fetch`, DOM or file API in the agent), `agent-run.test.mjs` (the loop), `agent-tools.test.mjs`, `agent-core.test.mjs`, `agent-gemini.test.mjs`.

### What 4.4 added (17 October 2026)

- **Flow of one document:** `extract_document` -> `find_client` (or the folder) -> `facts_for` -> `add_rows` -> `move_file_to_declaration`. Handles, not ids; every value of the row is copied by the code from the fact.
- **A row is told apart by month and number** (`position`, the # column), never by `documentId`: the groups of one invoice share one. `apply` checks that the row at that number still has the `documentId` of the proposal, and refuses otherwise.
- **Where the row goes:** the open table takes it through the page (`restoreRow`, then the page saves its draft as for any edit); another month is written into its `draft-table.json` with the same format. The table is copied first, once per run and month (`draft-table.before-agent-<time>.json`); for the open table it is saved before the copy.
- **Image of a row:** after `move_file_to_declaration` the rows made from that file (`agent.file` is the SHA-256) get `imageFile` and `imageIndex`; a PDF opens in the viewer of the browser at `agent.page` (`#page=N`, **not yet seen in a real Chrome**), a photo as before. The type of a stored original is taken from its name (`NNN.pdf`), because the file system hands out the type by extension anyway.
- **Filing is safe by order:** copy and read back, then the rows get the image, then the entry leaves the index, then the file is removed from the inbox. A failure before the last step leaves the original in the inbox. The same bytes can no longer be added again: they are now a duplicate of an image of the declaration.
- **Real data check, on a scratch copy outside the repository** (deleted after): see the decision log of 17 October. The scripts live in the session scratchpad, not in the repository; the row builder parity check (read only) compared percentages and amounts of 27 real rows and found no difference.
- **Contract deviations to approve:** `docs/AGENT_TOOLS.md` is unchanged; the code differs from it in four points (decision log, 17 October). `docs/AGENT_TOOLS.md` should be amended once the owner approves them.

### Block 4.7, unit 1 (17 October 2026): all imports through the inbox

The owner wants the menu "ייבוא ובדיקות" gone and its functions reached from the inbox, with the agent choosing the tool. Design: `docs/AGENT_TOOLS.md`
section 5.6 (`prepare_import`, read-only, one tool with `kind`; the user opens the existing wizard from a card; the page files the original into
`clients/<client>/imports/` after the wizard wrote). Steps: `WORK_PLAN.md` 4.7.1 to 4.7.6. **Built (4.7.1, no new tool):** `list_inbox` gives a spreadsheet the
neutral note "spreadsheet: not extracted; read it with read_document to see what it is" (before: "use the Excel import"), `extract_document` refuses a spreadsheet with a message
that points to `read_document`, and the orchestrator instruction (`AGENT_VERSION` `stand-in-2026-10-17d`) tells the agent to read each spreadsheet and each PDF that does not
look like an invoice with `read_document` and to say in the summary what each file appears to be and which wizard of the menu to use for now. A test compares the menu labels
quoted by the instruction with `index.html`. **Changed existing code (as `AGENTS.md` asks to list):** the three strings above and the instruction text; no behaviour of the loop,
the registry or the wizards. **Not verified:** a real run with a journal, a codes ledger, an operations ledger, an income report and an invoice in the inbox (does Gemini name each
file correctly and quote the right menu item?); what `read_document` returns for a real Rivhit workbook and a real ledger PDF (only synthetic fixtures were read in tests). The file
`prepared` by the agent will hold counts only; the sample that `read_document` returns for recognition goes to Gemini on the paid tier like an invoice does (section 7 of the contract).

**Built (4.7.2, 17 October 2026):** the tool `prepare_import` for `kind: journal` (`agent/tools/prepare-import.js`, `agent/adapters/imports.js`, the service `imports.prepare`); the card (`assistant-ui.js`
`importCard`; the command `import` with a `report` callback); `openImportWizard` in `app.js`; `excelImport.openWith` in `excel-import-ui.js`; `fileImportOriginal` and `copyToClientImports` in
`inbox-store.js` (an import original is stored in `clients/<client>/imports/`, never overwritten, and its hash counts for the duplicate check of the inbox). The model sees counts, check results and problems
only; the card also has the totals. **Changed existing code:** `excel-import-ui.js` (new `load`, `afterCommit`, `openWith`; the file input handler now calls `load`), `inbox-store.js` (`declarationImageHashes`
scans `imports/` too), `inbox-ui.js` (one text), `assistant-ui.js`, `app.js`, `agent/run.js` (`run.prepared`), `agent/errors.js` (`wrong_format`), `agent/services.js`, the test helper
`memory-binary-directory.mjs` (`getFile` returns a `name`). **Not verified:** everything in a real browser and with real Gemini (see the decision log of 17 October). The wizard works on the open client: the button first opens the
latest declaration of the card's client (which may ask "switch to another declaration?"); if the client has no declaration the card says so.

### General check of 16 October 2026 (before the first PDFs)

- **Tests:** web 626, Worker 54, `npm run check` green. No Telegram, passkey, WebAuthn or Rivhit-export code left (`git grep`); `web/README.md` was stale (said there was no AI) and is rewritten.
- **Checked in a real browser on synthetic files, nothing sent to Gemini:** pdf.js loads from the CDN and `read_document` gets the text layer of a two-page PDF and one page of it; a page out of range gives `page_out_of_range`; the extraction request for a PDF carries the text layer and `inlineData`; a 42.5 MiB PNG goes through `browserShrink` to a 6.3 MiB JPEG of 3000 px in about 2 s and the request stays at 8.4 MiB. **Not checked:** HEIC (no sample, Chrome on Windows may not decode it; then the photo goes as it is if it is under 14 MiB), a PDF over 14 MiB (refused, no page splitting yet), the vision call itself.
- **Measured on the Free plan (second real run):** a request with a 718 KB PDF (0.96 MB body) used 41 and 34 ms of CPU and still answered 200; ordinary requests 1 to 4 ms. About 40 ms per MB, so the estimate below is too low, and the Free limit of 10 ms is not enforced as a hard cut, at least not at this size. Larger files not tried yet. `wrangler tail annateria --format json` shows `cpuTime`, `wallTime`, `outcome` and redacts the authorization header; its events also carry the IP address and the city of the caller, so only a summary should be kept (a script that prints just time, outcome, path and size was used).
- **Risk, Worker CPU (the estimate made before the measurement):** `/v1/model` reads the whole body, parses it, validates it and sends it on. Measured in Node on the owner's PC: `JSON.parse` of a body with base64 inline data costs about 1 ms per MB (6 MB: 6.5 ms; 18 MB: 18.7 ms); the rest of the path is of the same order, so two to three ms per MB is my estimate. Cloudflare gives the **Free plan 10 ms of CPU per request** (docs read for step 1.1, see below; not re-read today); then a photo or PDF above about 3 MB base64 (2.3 MB file) can end with a Cloudflare error that the page sees as a network error ("אין חיבור לשרת"). The plan of the account is not recorded: **the owner should say whether it is Free or Paid** (Paid: 30 s by default). If it is Free, the choices are the Paid plan, a smaller image before sending (`browserShrink` could be applied from a lower limit; the owner said image quality matters), or a Worker that does not parse the body (it cannot then validate it).
- **Output limit:** the thinking of the model counts against `maxOutputTokens`; raised to 16,384 (assistant) and 32,768 (extraction, the most the Worker allows). Thinking is also most of the cost of a run; a lower thinking level for extraction would cut it, but the parameter was not verified, so it is not used.
- **Style:** about 320 lines of the new modules (agent, inbox, assistant) are longer than the ~120 characters of `AGENTS.md`, mostly comments, prompts and tool descriptions. A formatting-only commit would fix it; proposed to the owner, not done.
- **Run logs hold data:** `common/agent-runs/*.json` keep the arguments and a shortened result of every tool call (supplier names, amounts). They are local, in the backup, and must be treated like the rest of the data root; nothing deletes them.
- **PDF through the dock:** put the PDF in `תיבת קלט`, press "בדוק מסמכים חדשים". The old **דוח הכנסות (PDF)** import (menu "ייבוא ובדיקות") is another feature and does not use the agent.

### First real run (16 October 2026)

The owner asked the dock to check one real client for September. **What it proved:** the Worker, the access code, `/v1/model`, function calling on `gemini-3.8-flash` with our declarations (upper-case type names, no `additionalProperties`), `functionResponse` in a `user` content, parallel calls (`get_client_context` and `query_rows` in one turn), thought signatures kept verbatim, usage metadata in the run log (`common/agent-runs/`). The answer was in good Hebrew, in plain text.
**Cost seen:** six turns, 44,409 prompt tokens, about 870 answer and 5,500 thinking tokens; at 0.75 / 3.75 USD per million (the price of 16 October, until 31 December) that is about 6 cents, **my arithmetic, not a bill**. Every turn sends the whole conversation again, and the client context and the 32 rows made the third turn 8,400 tokens; Gemini context caching and shorter results are the levers if cost matters.
**What it found wrong in our code** (all fixed, with regression tests in `test/agent-context-tools.test.mjs`): row handles keyed by `documentId` collapse the rows that share one (the groups of one invoice; 2 pairs in that table), so the model quoted numbers that were not row numbers; the agent quoted the amount of the document while the table shows the recognised one; it promised an apply button that does not exist; an active row of zeros was not reported. Rows are now told apart by month and row number (`position`, the # column); a proposal carries it; the apply code of 4.4 must check `documentId` at that position before it changes anything and refuse when the table has changed.
**Still unverified:** the vision call (`extract_document`: JSON response schema with `nullable`, temperature 0, `inlineData`, HEIC, large files); the stop button during a real call.

### What 4.3 added

- **The dock** is the only UI of the agent. `setupAssistant({ root, onCommand })` draws and reports clicks; `app.js` decides what a click does. One run at a time; stop aborts through an `AbortController` (a question card that is open then closes without an answer). Every text of the agent is put in with `textContent`.
- **A run** = `buildMessage` (date, what the user has open, for a typed request the last answer) + `ORCHESTRATOR_PROMPT` + the nine tools. The run log is written to `common/agent-runs/<id>.json` after every run (a failure to write is a note in the dock, not an error). Quick buttons send fixed English requests (`QUICK_MESSAGES`); the model answers in Hebrew.
- **What a run needs:** the data root, and the access code (the model client asks for it; without it the run fails with the login message). Without `ANNATERIA_API` the dock says the AI is not configured.
- **Known limits:** no row is written (4.4); proposals cannot be applied from the card (4.4); no memory between runs beyond the last answer; the prompt is a stand-in (phase 5).

### What 4.2b added

- **Facts by reference.** `extract_document` validates the answer of the model against `RECORD_SCHEMA`, cleans it (`normalizeRecord`: dates through `dateKey`, ids to digits, amounts to cents, free text to one line of at most 120 characters, the issues `amounts_mismatch`, `bad_vat_id`, `no_date`, `foreign_currency` added by code) and freezes it; handles are `F1.1`. A record that does not validate is skipped and counted; if none validates the call fails. A second call returns the stored facts; `model: strong` once, only while no row was made from them (`run.factsUsed`, filled by `add_rows` in 4.4).
- **`facts_for` is the one place of the rules.** It builds the fact as a row of the draft-table format and calls `intakeFacts`, `pcnReview`, `isHomeUtility`; the duplicate search covers all declarations, the open table as on screen (`getLiveTable`) and `run.addedEntries` (rows made earlier in the run, filled by `add_rows` in 4.4). The model gives only a month when the user asked for one.
- **Where the browser comes in.** `adapters/documents.js` loads pdf.js (`loadPdfJs` of `pdf-import.js`) and SheetJS on demand; `adapters/extraction.js` builds one `generateContent` request (instruction `EXTRACTION_PROMPT`, JSON response schema, temperature 0, the file as `inlineData`, at most 14 MiB; a bigger photo is shrunk by canvas, a bigger PDF or HEIC is refused). Both take their libraries as arguments, so the tests run in Node. The workbook reader insists on a ZIP or OLE signature because SheetJS parses any bytes as text.
- **Wired in 4.3** (kept here as the recipe): `createServices({ getDataRoot, getClients, getLiveTable, builtInChart, reserved, extraction })` with `extraction = createExtractionAdapter({ client: modelClient, readText })`; the loop with `createGeminiModel({ client: modelClient, model: MODELS.orchestrator })`.

### Gemini function calling (read 16 October 2026)

- Thought signatures, <https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures> (read in full): for Gemini 3 and 4 the first `functionCall` part of every step of the
  current turn carries `thoughtSignature` and it **must** be returned in the exact part where it arrived, otherwise the API answers 400. In parallel calls only the first part has one.
  The order in the history must be `FC1 (+signature), FC2, FR1, FR2`; interleaving `FC1, FR1, FC2, FR2` is a 400. A `functionResponse` does not start a new turn. The loop keeps the
  parts of the model verbatim and answers all calls of a turn in one `user` content, in call order (tests: `agent-run.test.mjs`, `agent-gemini.test.mjs`).
- <https://ai.google.dev/gemini-api/docs/function-calling> now documents the **Interactions API** (steps `function_call` / `function_result`, `generation_config.tool_choice`), not
  `generateContent`. This project uses `generateContent` through the Worker; I did not check whether the Interactions API is meant to replace it (as noted for step 1.2).
- <https://ai.google.dev/api/caching> (read): `toolConfig.functionCallingConfig.mode` is `AUTO` (default), `ANY`, `NONE` or `VALIDATED`; `allowedFunctionNames` only with `ANY` or `VALIDATED`.
  The adapter sends `AUTO`.
- **Not verified, written from memory of the generateContent reference:** the type names of `functionDeclarations[].parameters` are upper case (`OBJECT`, `STRING`, …) and the schema has no
  `additionalProperties`; the `functionResponse` content has the role `user`; the `finishReason` values such as `MALFORMED_FUNCTION_CALL`, `SAFETY`, `MAX_TOKENS`; that a `functionResponse`
  `id` must echo the `id` of the call when there is one. The first real run (4.3, with the owner's key) is the check; if Gemini rejects a declaration, the one place to change is
  `toGeminiSchema` in `schema.js`. Temperature is left at the default of the model for the orchestrator.

## Phone guide facts (step 2.4, checked 16 October 2026)

The Hebrew guide (`#phone-guide-dialog`) rests on these. Phone menus change with OS versions: re-check before editing it.

- Apple, scan in Notes and in Files ("Scan Documents" under the attachment button / the More button): <https://support.apple.com/en-ie/108963>
  (official; read through a search summary, not opened in full).
- Google Drive scan on Android (camera button, or + then Scan, depending on the app version; save as PDF): <https://support.google.com/drive/answer/3145835>
  (official; search summary).
- Android over USB (notification "Use USB for", then "File transfer"; a data cable; the phone appears under This PC): <https://support.google.com/android/answer/9064445>
  (official; search summary).
- **Not from an official page:** WhatsApp "send as a document" (third-party guides only, e.g.
  <https://www.ghacks.net/2023/06/28/how-to-send-photos-as-document-in-whatsapp-android-iphone/>; the iPhone route "save to Files first, then Document" comes from
  those guides) and the iPhone setting "Transfer to Mac or PC" (Settings, Photos, bottom; Automatic converts to JPEG, Keep Originals keeps HEIC; Apple's HEIF/HEVC
  article as quoted in forums and by Macworld). I did not open Apple's own page for that setting.
- The Hebrew names of iOS and Android menus were **not** checked; the guide gives the English names in brackets.
- Nothing in the guide was followed step by step on a real phone.

## Not verified yet

- Anything beyond opening a month and comparing data with ocr (owner check of 16 October 2026). The rest of the UI
  (Excel import, reports PDF, backup, transfer) was not clicked through after the 0.3 removals.
- Streaming (`stream: true`) and the timeouts (120 s / 300 s) have never run against the real Gemini; only the non-streaming call was tried by the owner.
- The lock-out was tested in node only, not by typing wrong codes five times in a browser. The CPU time of PBKDF2 was not measured (the login simply worked).
- The Cloudflare plan of the account (Free or Paid) is not recorded.
- The `deploy-web.yml` test job passed once on GitHub (Node 24); no other CI exists.
