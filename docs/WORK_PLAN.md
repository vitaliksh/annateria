# ANNATERIA — work plan

Status: **plan agreed 16 October 2026; phases 0, 1 and 2 done (steps 0.1–2.4); phase 4 started (4.1, 4.2, 4.2b, 4.3 done); phase 3 in the backlog.** This file is the single source of truth for what is
done and what is next. Update the checkboxes and the decision log in the same commit as the work.

## How to use this plan (every session)

1. Read `AGENTS.md`, then this file.
2. Take the **first unchecked step** of the first phase that is not done. One step = one session = one commit,
   unless the step says otherwise.
3. Before writing code, say what the step will change and how it will be checked (the step's "Done when").
4. When finished: tick the box, add a line to the decision log if anything was decided, note what was not
   verified. Do not start the next step in the same session without the owner's go-ahead.

## Product in one paragraph

A local-first web app for one bookkeeper (Anna) and the owner (Vitalik). Anna drops invoice photos, PDFs and Excel
files into the app; they land in `inbox/` without AI. She presses **"עבד חדשים"** (process new); an AI agent built
into the app (Gemini through our Worker) reads the documents, adds draft rows to the monthly journal and asks her
short questions as cards with buttons. She reviews and edits the table, then the app's own code produces the
reports, and she closes the month with an app button. Data stay in a local folder; an encrypted copy in a shared
Google Drive folder serves as the backup and as the hand-over channel between Anna's PC and Vitalik's PC.

## Anna's day (the acceptance scenario for the whole project)

1. Opens the bookmark, types her **6-character code**.
2. The app pulls Vitalik's changes from Drive if any ("data up to date" / "pulling…" / "waiting for Google Drive"),
   and takes the **baton** ("you are working, ANNA-PC"; or "Vitalik worked until 22:40 — take over?").
3. Drags files from WhatsApp Desktop, Gmail or Explorer (phone over USB) onto the drop zone. "Inbox: 23 files
   (2 duplicates skipped)".
4. Presses **"עבד חדשים"**. Rows appear in the table live (✓ sure, ⚠ to look at); question cards appear in the
   assistant panel; she answers with buttons; "remember for this client?" goes to the client's `rules.md`.
5. Free requests in the panel's text field ("show Levi's invoices without an allocation number", "this one is for
   September", "why 2/3?").
6. Reviews the ⚠ rows, edits in place. Every save pushes an encrypted snapshot to Drive by itself (☁ ✓ 10:58).
7. "VAT report" — computed by code. **Close month** — an app button with a summary and a confirmation; the agent
   can only say "ready to close".
8. **"Finish work"** — last push, baton released. Weekly reminder: "plug in the USB drive for a backup".

## Target architecture

```text
GitHub Pages: web/          (Ctrl+F5 updates the UI, the skills and the prompts)
 ├─ journal, clients, reports      (ported from ocr/telegram-web)
 ├─ intake: drop zone → inbox/     (no AI)
 ├─ assistant panel: orchestrator → tools (JS) → data root
 └─ skills/*/SKILL.md              (Agent Skills format, versioned with the app)
        │  access code → short-lived token (page memory)
Cloudflare Worker: worker/  — thin, stateless Gemini proxy: auth, rate limit, model allow-list, size limits
        │
Data root on each PC (local folder, never inside a synced folder)
 ├─ inbox/<client>/ and inbox/_unsorted/
 ├─ clients/<client>/rules.md      (agent memory of this client, written only from Anna's answers)
 └─ clients/<client>/declarations/YYYY-MM/…   (same layout as ocr)
        │  push after every save / pull on open (fast-forward only)
Google Drive shared folder: encrypted write-once store (packs + snapshots) + baton files
```

Reused from `D:\projects\ocr` (repository `vitaliksh/ocr`): `telegram-web/` modules for workspace, clients,
declarations, journal, reports, Excel journal import, backup store, `intake-facts.js` (year, period, duplicates),
`row-calculations.js`, `home-utilities.js`, PCN review; the prompts in `agent-prompts/` and Anna's rules recorded
in `ocr/docs/HANDOFF.md` ("Two-agent redesign", "PCN clients", "Anna's first notes").

Removed on purpose (do not port): Telegram bot and upload sessions, R2, QR codes, passkey / Windows Hello and
`DeviceRegistry`, the Rivhit TXT export (deprecated in ocr), the Python application.

---

## Phase 0 — Repository and baseline

Goal: a working copy of the ocr web app in this repository, published, with the removed parts gone.

- [x] **0.1 Bootstrap.** `git init`, layout `web/`, `worker/`, `docs/`, `.github/workflows/`. Copy
  `ocr/telegram-web` → `web/` and `ocr/cloudflare-worker` → `worker/` (without `node_modules`, `.dev.vars`,
  real data). Copy `.gitignore` and adapt paths. Copy the specs that stay valid (`REPORTS_SPEC.md`,
  `BACKUP_SPEC.md`, `EXCEL_IMPORT_SPEC.md`) into `docs/` with a "inherited from ocr" note.
  *Done when:* `npm test` and `npm run check` are green in `web/` and `worker/` exactly as in ocr (same test count).
- [x] **0.2 Decide origin and storage names.** GitHub Pages of `vitaliksh/annateria` is served from the same
  origin `vitaliksh.github.io` as ocr, so IndexedDB, localStorage and folder-permission handles are **shared**
  between the two apps. Decide: new database names (clean separation) or deliberate sharing (the recovery key
  and the data-root handle carry over). Record in the decision log.
  *Done when:* the decision is recorded and applied in `workspace.js` / `backup-handles.js` with a test.
- [x] **0.3 Remove Telegram, QR, passkey and Rivhit export** from `web/` and `worker/`, in separate commits per
  area. Keep every module the journal and reports depend on.
  *Done when:* tests green (new count recorded), no reference to Telegram, `X-Upload-Token`, WebAuthn or
  `rivhit-export` left (`git grep` shows nothing), journal opens an existing ocr data root unchanged.
- [x] **0.4 Publish.** GitHub repository, Pages workflow for `web/`, version marker in the page.
  *Done when:* the owner opens the published page, picks a **copy** of a real ocr data root, sees the clients,
  a month and a report identical to ocr.
- [x] **0.5 Docs.** `README.md`, `docs/ARCHITECTURE.md` (from the "Target architecture" above),
  `docs/HANDOFF.md` started (repository map, how to run checks, deployed versions).

## Phase 1 — Worker: access code and model proxy

Goal: the browser can call Gemini through the Worker after Anna types her code; the key never leaves the Worker.

- [x] **1.1 Access code.** `POST /v1/auth` with a 6-character code → short-lived token (e.g. 12 hours, signed,
  kept in page memory only). One code per user (Anna, Vitalik), stored as salted hashes in Worker secrets.
  **Rate limit:** lock-out after a few wrong attempts per IP and a global ceiling (check current Cloudflare
  options: Rate Limiting binding, Durable Object or KV). Login screen in `web/` (Hebrew).
  *Done when:* Worker tests cover right code, wrong code, lock-out, expired and forged token; a reload of the page
  asks for the code again.
- [x] **1.2 Constrained Gemini proxy.** `POST /v1/model` forwards a `generateContent` request: model from an
  allow-list, size limit, token limit, streaming for long answers, no logging of bodies, no storage. Prompts and
  skills come from the browser (so they update with Ctrl+F5, not with `wrangler deploy`).
  *Done when:* Worker tests with a stubbed Gemini; one real call from the published page with the owner's key;
  limits verified against the current Cloudflare and Gemini documentation (sources in `HANDOFF.md`).
- [x] **1.3 Paid tier check.** Confirm the production key's project has billing enabled (the unpaid tier may use
  data to improve Google products). Record the date and the source in `HANDOFF.md`.
- [x] **1.4 Deploy** a new Worker, record version in `worker/DEPLOYMENT.md`, `config.js` points to it.

## Phase 2 — Intake (no AI)

Goal: every kind of file Anna gets lands in `inbox/` with one gesture.

- [x] **2.1 Inbox model.** `inbox/<client>/` (folders created from the client list) and `inbox/_unsorted/`;
  `inbox/index.json` with SHA-256, original name, size, type, source date, added-at. A file already seen
  (in the inbox or in any declaration's images) is skipped and counted.
  *Done when:* unit tests for dedup, naming collisions and the index.
- [x] **2.2 Drop zone and picker.** A large drop target ("גרור לכאן") plus "בחר קבצים"; optional client choice;
  accepted: JPG, PNG, WebP, HEIC/HEIF, PDF, XLSX/XLS/CSV; anything else refused with a reason. Shows
  "N files, M duplicates skipped".
  *Done when:* manual check in Chrome: drag from Explorer, from WhatsApp Desktop and from Gmail (web) works; a
  HEIC from an iPhone and a PDF arrive intact (hash equal to the source file).
- [x] **2.3 Inbox view.** Count per client in the sidebar, a list with thumbnails, delete a wrong file
  (moved to `inbox/_trash/`, never hard-deleted by the app).
- [x] **2.4 Phone guide for Anna** (Hebrew, one page in the app's help): send to yourself in WhatsApp **as a
  document**; built-in document scanner (iPhone Notes/Files, Android Drive or camera); USB + Explorer; iPhone
  setting "Transfer to Mac or PC: Automatic" if photos are copied by cable.

## Phase 3 — Model bake-off (spike, outside the repository) — BACKLOG (owner, 2026-10-16: not scheduled)

Goal: choose the default models with numbers, not impressions. **In the backlog:** until it is run, the default models stay the provisional ones of `HANDOFF.md` (documents and assistant on `gemini-3.8-flash`, a Pro/Argon model as the fallback) and are constants that one line changes; phase 5.3 (eval) will give first numbers on synthetic data.

- [ ] **3.1 Ground truth.** From `ocr/examples`, `ocr/new examples`, `ocr/pdf examples` and the confirmed rows
  of real months, build a local answer key (date, supplier ID, document number, gross, VAT, allocation number,
  document type). Stays outside the repository (`AGENTS.md`, privacy).
- [ ] **3.2 Run** the extraction prompt on Gemini Flash-Lite, Flash and Pro (current model ids from the official
  docs), optionally Claude for comparison, twice each. Measure per-field accuracy, repeatability, cost per
  document, latency; HEIC and multi-page PDF handled natively or not.
  *Done when:* a summary table (no client names or amounts) in `HANDOFF.md` and the chosen defaults
  (extraction model, orchestrator model, fallback for hard documents) in the decision log.

## Phase 4 — Agent core in the app

Goal: "עבד חדשים" turns the inbox into reviewed-ready rows, with questions as cards.

- [x] **4.1 Tool contract** *(`docs/AGENT_TOOLS.md`, approved by the owner 2026-10-16)* (document first, in `docs/AGENT_TOOLS.md`): `list_inbox`, `read_document`
  (image/PDF pages/Excel as text), `extract_document` (one document per model call, returns facts),
  `find_client`, `facts_for` (year, period, duplicates from `intake-facts.js`), `add_rows`, `propose_change`,
  `move_file_to_declaration`, `ask_anna` (question + options), `remember_rule`, `run_report`, `ready_to_close`.
  For each: inputs, outputs, validation, what it may never do. No tool deletes, closes a month or edits OCR facts.
  *Done when:* the owner approves the document.
- [x] **4.2 Orchestrator loop** (`web/agent/`): model ↔ tools through the Worker, step limit, cancel button,
  a copy of the table before a run (`draft-table.before-agent-<time>.json`), errors leave rows editable.
  *Done when:* unit tests with a scripted fake model: happy path, a tool error, a refused tool call, cancel.
- [x] **4.2b Remaining tools** (added 2026-10-16, see the decision log): `read_document`, `extract_document`, `facts_for`,
  `get_client_context`, `query_rows` of `docs/AGENT_TOOLS.md`, tested with a stub model and the real stores. `add_rows` and
  `move_file_to_declaration` belong to 4.4, `remember_rule` to 4.6, `run_report` and `ready_to_close` to phase 6.
  *Done when:* each has its contract tests; `PENDING_TOOLS` in `test/agent-boundary.test.mjs` lists only the later ones.
- [x] **4.3 Assistant panel** in the reserved dock of the shell: progress line, question cards with buttons and
  "other…", text field, quick buttons ("עבד חדשים", "מה נשאר?", "דוח"). Hebrew, RTL.
- [ ] **4.4 Live rows.** `add_rows` goes through the existing row path (`applyRecord`), rows marked ✓ / ⚠ with the
  agent's reason; click opens the original next to the table.
- [ ] **4.5 Client routing.** Files in `_unsorted` are assigned by the buyer's VAT number on the document; unsure
  → `ask_anna`.
- [ ] **4.6 Client memory.** `remember_rule` appends to `clients/<client>/rules.md` only after Anna confirms;
  the file is read into every run for that client; Anna can view and edit it from the client card.
  *Done when (phase):* on the published page, a synthetic month of ~20 documents goes from inbox to rows with
  questions answered by buttons; a second run of a similar month asks fewer questions.

## Phase 5 — Skills content and evaluation

Goal: Anna's rules live in skills, are tested, and update with Ctrl+F5.

- [ ] **5.1 Skill layout** `web/skills/<name>/SKILL.md` (Agent Skills format, so the owner can also run them in
  Claude Code or Codex for debugging). Initial skills: `invoice-extraction`, `classification` (Form 6111, the
  client's chart first), `periods-and-duplicates`, `pcn-allocation`, `month-closing-checklist`. A skill version
  is stored in each row the agent writes.
- [ ] **5.2 Port the rules** from `ocr/agent-prompts/*.md` and `ocr/docs/HANDOFF.md`; keep in code what code
  already does (duplicates, year, periods, utilities 25%, allocation ceiling) — the skill tells the agent to use
  the tool, not to compute.
- [ ] **5.3 Eval set.** Synthetic fixtures with expected decisions, a runner (`npm run eval`, real model, owner's
  test key, not in CI). Every rule change runs the eval first.
- [ ] **5.4 Questions for Anna** still open in ocr (tax-authority and National Insurance payments, licence fees,
  period length of three months, PCN details): ask her through the app or in person, record answers as rules.

## Phase 6 — Reports and closing through the assistant

- [ ] **6.1** `run_report` opens the existing reports (VAT, advances, profit and loss, ledger) for a client and
  period; the numbers come only from `reports.js`.
- [ ] **6.2** `ready_to_close` produces a checklist (rows with ⚠, PCN rows without approval, inbox files left for
  this month, duplicates); the **close** stays the existing button with its confirmation.
  *Done when:* the agent cannot close a month even if asked (test), and the checklist matches the lock refusals.

## Phase 7 — Sync between the two PCs and backup

Goal: Anna and Vitalik hand over the data without any export/import step. Note: in ocr a shared Drive folder for
transfer files was tried and dropped as impractical, and overwriting files in Drive failed — so spike first.

- [ ] **7.1 Spike** with two Google accounts and a shared folder ("add shortcut to Drive" on the second PC):
  propagation delay, write-once files only, behaviour while the other PC is off, partial sync. Result and
  go/no-go in the decision log. If no-go: fall back to the ocr transfer file with a one-click "hand over".
- [ ] **7.2 Snapshots include images** for synced roots (written once, uploaded once).
- [ ] **7.3 Push** a snapshot after every save (debounced) to the shared store; status icon ☁.
- [ ] **7.4 Pull on open**: compare the local base snapshot (`common/sync-state.json`, **local only, never inside
  snapshots**) with the newest in the store; fast-forward when there are no local unpushed changes; verify all
  blobs by hash before applying, otherwise "waiting for Google Drive"; both sides changed → stop and ask.
- [ ] **7.5 Baton** as write-once files (`baton/<stamp>-<user>-<take|release>.json`, newest wins); header shows
  who works; "take over" with a warning; "Finish work" button.
- [ ] **7.6 USB copy** stays as the second copy with the weekly reminder.
  *Done when (phase):* Anna's PC → Vitalik's PC → Anna's PC round trip of a real-size month with images, no manual
  step besides opening the app; a forced "both changed" case stops safely (test).

## Phase 8 — Rollout on Anna's PC

- [ ] **8.1** Set-up checklist (Drive for desktop, shared folder, local data root, recovery code on paper,
  access code, Chrome "allow on every visit"), written in `docs/ROLLOUT.md`, done with Anna.
- [ ] **8.2** Move her existing ocr data root (verify it opens, reports equal to ocr).
- [ ] **8.3** First real month in parallel with her usual way; compare row by row; collect her notes in
  `HANDOFF.md`.
- [ ] **8.4** Restore drill from Drive and from USB into an empty folder.

## Later (not planned yet)

Gmail fetch through OAuth; PCN874 file; tax ID on report PDFs; clean-up of old snapshots; Claude as an alternative
model behind the same proxy.

---

## Decision log

| Date | Decision |
| --- | --- |
| 2026-10-16 | Intake without AI: drop zone → `inbox/`. No phone apps, no QR, no Telegram. |
| 2026-10-16 | The agent lives inside the web app; Gemini by default through the Worker; provider behind an interface. |
| 2026-10-16 | AI decides, code computes and writes; closing a month is an app button only. |
| 2026-10-16 | Access: 6-character code per user each time the app opens; token in page memory; Worker rate-limits. |
| 2026-10-16 | Skills in Agent Skills format inside `web/skills/`, shipped with the app; client memory in `rules.md`. |
| 2026-10-16 | Sync: local data root per PC; encrypted write-once store in a shared Drive folder; fast-forward only; baton. |
| 2026-10-16 | Only the paid Gemini tier for client documents. |
| 2026-10-16 | 0.1: copied only git-tracked files of `ocr/telegram-web` → `web/` and `ocr/cloudflare-worker` → `worker/` (ocr commit `457491e`); baseline in ocr and here: web 455 tests, worker 41. `.gitignore` rewritten (ocr ignored every `*.json`); packages keep their ocr names until 0.3. `npm ci` blocks esbuild/workerd postinstall scripts (npm warns) — tests and checks pass anyway. |
| 2026-10-16 | 0.2: **separate storage from ocr.** IndexedDB is now `annateria-workspaces-v1` (was `rivhit-local-workspaces-v1`), defined once as `DATABASE_NAME` in `backup-handles.js` and imported by `workspace.js` (changed existing code: that one constant and an import). Consequences: after the first open, Anna/Vitalik pick the data root again (no auto-open of the ocr folder, so the two apps never write one folder by accident) and enter the recovery code again (the backup key is derived from the paper code, so nothing is lost). The on-disk format names `annateria-backup`, `annateria-key/index/snapshot/transfer` are untouched (ocr compatibility). localStorage keys `annateria-column-widths-v2` and `annateria-sidebar-v1` are the same in ocr and here, so these two UI preferences are shared; harmless, revisit if layouts diverge. The passkey localStorage key goes away in 0.3. Test: `web/test/storage-names.test.mjs` (web now 457 tests). |
| 2026-10-16 | 0.3: removed in three commits (Rivhit export; passkey / DeviceRegistry; Telegram, QR, upload sessions, R2 and all client calls to Gemini). Owner chose "remove everything": the Worker answers `/health` only until 1.1/1.2 (every old Gemini route was gated by a session or passkey, so without the gate it would have been an open key proxy; a test asserts those routes are 404), and the app has **no AI and no photo intake** until phases 2–4. Web 441 → 423 tests, Worker 41 → 5. Changed existing code: `app.js`, `workspace.js`, `workspace-core.js`, `index.html`, `shell.css`, `dialogs.css`, `config.js` (global renamed `ANNATERIA_API`, empty until 1.4), `bookkeeper-ui.js` and its test deleted. Worker renamed `annateria` (new deployment in 1.4; the ocr Worker is untouched). |
| 2026-10-16 | 0.3 left on purpose for later phases: `bookkeeper-flow.js` (+tests), `applyBookkeeperPlan` / `applyBookkeeperRecheck`, `addPendingRecord`, `applyRecord`, `restoreRow` (rows still carry the `processing` flag); `pdf-import.js` (`renderPdfPages`), `pdf-report.js` and `createDraftExportDirectory` (now unused: legacy PDF export); `.retry` CSS. Decide in phase 4 which are reused and delete the rest then. The old bookkeeper prompt and schema (ocr `cloudflare-worker/src/bookkeeper.js`, `index.js`) stay in the ocr repository as input for the phase 5 skills. |
| 2026-10-16 | 0.4: Pages workflow `.github/workflows/deploy-web.yml` runs `npm test` and `npm run check` in `web/` (Node 24), then publishes `web/`. The version marker in `index.html` is the token `BUILD_ID`, replaced at deploy by `YYYY.MM.DD · <short SHA>` (a local file shows the raw token). Fixed while there: `index.html` had the element `id="backend-version"` twice (inherited from ocr). The repository must be public for Pages on a free plan; it holds no client data (`.gitignore` blocks documents). |
| 2026-10-16 | 0.3 regression found on the published page: opening a month failed with "pcnJournal is not defined". Cause: while cutting the bookkeeper block I also deleted `let pcnJournal = null;`; in a browser module the undeclared assignment throws, while jsdom silently creates a global, so the tests stayed green. Fix: the declaration is back, and `test/app-harness.mjs` now fails `loadApp` if app.js leaves any undeclared global on `window` (verified: 33 app tests fail without the fix). Also removed the now unused `tableRows`. Lesson: a green jsdom run does not replace opening a month in the browser. |
| 2026-10-16 | 0.4 confirmed by the owner on the published page https://vitaliksh.github.io/annateria/ with a copy of a real ocr data root: months open, data equal to ocr. Deploys run through `deploy-web.yml` on every push to `main` that touches `web/`. |
| 2026-10-16 | 0.5: `README.md`, `docs/ARCHITECTURE.md` and `docs/HANDOFF.md` written. Phase 0 is complete. |
| 2026-10-16 | 1.1: `POST /v1/auth` built. Code = 6 characters of a 32-letter alphabet (30 bits), hashes PBKDF2-SHA256 (20,000 iterations, stored per entry) in the secret `ACCESS_CODES`; token = HMAC-signed, 12 h, stateless, in page memory only. Lock-out in one SQLite Durable Object (the Rate Limiting binding is eventually consistent per location, checked against the docs): 5 attempts / 15 min per address then 15 min lock, 20 attempts / hour for all; attempts counted at start, refunded on success; fails closed (503). A guessing storm can lock the real users for up to an hour: accepted. The login dialog (`#access-dialog`) opens on page load when `ANNATERIA_API` is set and can be closed: the journal works without it. `requireUser()` is the gate every 1.2 route must call first. Codes are made by `worker/scripts/access-codes.mjs` (output outside the repository). Tests: web 423 → 432, Worker 5 → 30. Not verified: a real deployment (see HANDOFF). |
| 2026-10-16 | 1.2: `POST /v1/model` built on `requireUser()`. Body `{ model, stream?, request }`; strict allow-list in `worker/src/model.js` (models, fields, part types, function tools only, inline MIME types, output tokens default 8192 / max 32768, 20 MiB), snake_case accepted and rewritten to camelCase, duplicate spellings refused. Streaming = pass-through of the `alt=sse` body. Generic error messages, only the status is logged, no retries in the Worker. Page side: `web/model-client.js` and a settings button for a one-call check. Gemini ids and limits re-checked in the docs (sources in HANDOFF; the docs contradict themselves on the inline limit, 20 MB used). Tests: web 432 → 442, Worker 30 → 51. Open: the real call (needs 1.4), `ALLOWED_MODELS` is a starting set until phase 3. |
| 2026-10-16 | 1.4: Worker `annateria` deployed to `https://annateria.vitaliksh.workers.dev` (version `8d2350b4`, backend `2026.10.16.2`, source `215cdab`, tag `cloudflare-production-2026-10-16`), `config.js` points to it. Found while preparing the secrets: PowerShell appends a line break to piped values, which made a signing key invalid; secrets are now trimmed (tests added) and the Worker was redeployed before the owner set them. 1.2 and 1.3 closed by the owner's acceptance test on the published page (login with the real code, "בדיקת חיבור ל‑AI" answered by Gemini). 1.3: Google project "OCR project", Tier 1, seen by the owner in AI Studio on 16 Oct 2026 (see HANDOFF). The PBKDF2 hypothesis of 1.1 held in practice: login with 20,000 iterations and two hashes worked on the owner's account (plan not recorded; no CPU figure was measured). |
| 2026-10-16 | 2.1: `web/inbox-store.js` (no UI yet). Layout `<data root>/inbox/<client folder>/` (the client's directory name in `clients/`) and `inbox/_unsorted/`; `_unsorted` and `_trash` (2.3) are reserved and cannot be client folders. `inbox/index.json` (`schemaVersion` 1) lists `{ hash, name, storedName, folder, size, type, sourceDate, addedAt }`; it is rewritten whole after every file, a damaged or newer index stops the add and is never replaced (it would lose the hashes). Dedup is by SHA-256 over the whole inbox and over the images of every declaration of every client; declaration images are hashed only when their size equals the size of an incoming file (equal bytes imply equal size), so no hash cache is kept. Stored names are made Windows-safe (no path, forbidden characters, device names, length); a taken name (case ignored) gets ` (2)`, so nothing is overwritten, including a file left without an index entry. Each file is read back and compared before it is recorded; a failure (empty file, write error, index write error) is reported for that file only and the partial file is removed. Not decided here: type filtering (2.2), what the index keeps after a delete to `_trash` (2.3). Consequence to remember: the existing backup copies the whole data root, so `inbox/` is now part of it (phase 7.2). Tests: web 442 → 462 (`inbox-store.test.mjs`; `memory-binary-directory.mjs` got `removeEntry`). Not verified: real folders on disk with a real `File` from a drop (needs 2.2). |
| 2026-10-16 | 2.2: `web/inbox-ui.js` + `inbox.css` + `#inbox-dialog` in `index.html`, opened by the sidebar item "תיבת קלט" (`#open-inbox`), wired in `app.js` like the transfer dialog. A dialog, not a view: 2.3 decides whether the inbox list becomes a view. Drop target (the whole dialog takes the drop, so a missed file is not opened by the browser), "בחר קבצים" picker, client select (only clients inside the data root; default "unassigned" = `_unsorted`). Accepted extensions: jpg, jpeg, png, webp, heic, heif, pdf, xlsx, xls, csv (`refusalReason` in `inbox-store.js`, checked by extension because Windows often gives HEIC an empty MIME type); everything else is listed with its reason, dropped folders too (`webkitGetAsEntry`). The result line says "added / duplicates skipped / not taken" and a list gives the reason per file, duplicates say where the same bytes already are. Tests: web 462 → 475 (`inbox-ui.test.mjs`, real store on an in-memory directory). Verified in a browser: the page loads locally and the dialog opens (disabled without a data root). **Not verified** (needs the owner's PC): drag from Explorer, WhatsApp Desktop and Gmail web, and the HEIC / PDF hash check. Hypothesis: a drag from Gmail web (a download-URL drag) may deliver no file to a page; the picker is the fallback. |
| 2026-10-16 | 2.2 accepted by the owner on the published page ("working good"); the Gmail question stays open as a hypothesis (the owner did not report it). |
| 2026-10-16 | 2.3 (with a "clear all" button the owner asked for): the inbox view is part of `#inbox-dialog` (still a dialog, not a view): a list grouped by folder (unassigned first, then clients in sidebar order), thumbnail (a 96 px canvas for JPEG/PNG/WebP only, made one by one in the background; HEIC, PDF and Excel keep a label with the extension), name, size, date, "הסר" per file, "נקה תיבה" for everything after a confirmation. The sidebar shows the number of waiting files next to each client and a badge on "תיבת קלט". **Nothing is deleted for good:** `moveToTrash` copies the file to `inbox/_trash/` (unique name), reads it back, writes the index, and only then removes the original. The entry **leaves `files`** (so the same bytes can be added again, owner's choice) and is kept in `index.trashed` with `trashedName` and `trashedAt` (optional field, `schemaVersion` stays 1). A file already gone from disk is only dropped from the index; a failed step leaves the file where it was. The trash is never emptied by the app. Changed existing code: `sidebar-clients.js` (optional `inboxCounts`), `workspace.js` (optional `getInboxCounts`, returns `renderSidebar`), `app.js` (two variables, `onCounts`, a refresh on data-root switch). Tests: web 475 → 494. Verified in Chrome (OPFS, real `File` objects): add, duplicate, `CON.jpg` renamed, read back, trash, re-add, counts. **Not verified:** the dialog with a real list (look, thumbnails of real photos, scrolling) and the sidebar badges on the published page. |
| 2026-10-16 | 2.4: the phone guide is a help dialog `#phone-guide-dialog` (static Hebrew in `index.html`, style in `inbox.css`) opened by the button "איך מעבירים מהטלפון?" in the inbox dialog: (1) WhatsApp to yourself **as a document**, (2) the scanners of iPhone (Notes / Files) and Android (Google Drive), (3) USB cable with the iPhone setting "Transfer to Mac or PC: Automatic" as the plan asked. The text uses infinitives and impersonal forms because the reader's gender is not known. Sources and what is not confirmed: see HANDOFF "Phone guide facts". Phase 2 is complete; **owner to read the guide on a real phone and PC** (menu names change with OS versions). Tests: web 494 → 495. |
| 2026-10-16 | 4.1 drafted: `docs/AGENT_TOOLS.md`. Design choices to be approved (its section 10): the model sees run-local handles, not ids; facts exist only as extraction output and `add_rows` takes a fact handle, so the agent cannot alter OCR facts or invent amounts; the code, not the model, decides month, status "ready", exclusion and recognition; existing rows change only by a user click on a `propose_change` card; `remember_rule` takes only the id of a confirmed question; the tool registry is closed and tools reach data only through a `services` object (tests prove no close, reopen or delete exists); two tools added to the plan (`get_client_context`, `query_rows`), `ask_anna` renamed `ask_user`. Not verified: Gemini 3 multi-turn function-calling rules (thought signatures); to be checked against the official docs in 4.2. Waiting for the owner. |
| 2026-10-16 | 4.1 approved by the owner: `docs/AGENT_TOOLS.md` with all ten recommendations of its section 10 (spreadsheets stay with the Excel import; a missing open month is created by the code; existing rows change only by a click on a proposal; 14 tools; no highlight boxes in v1; limits 60/400/200/15/30 min; "ready" only by code with confidence 80 or more; dead code of 0.3 deleted in 4.4; local run log; PDFs stored as originals). Next: 4.2.
| 2026-10-16 | Phase 3 (model bake-off) moved to the backlog by the owner; defaults stay provisional (see the phase). Dates of the entries of 2.1 to 4.1 were written as 17 and 18 October by mistake and are corrected to 16 October. |
| 2026-10-16 | 4.2: `web/agent/` built against `docs/AGENT_TOOLS.md`: loop (`run.js`), closed registry with argument validation and result envelope, run-local handles, limits (60 turns, 400 calls, 30 min), cancel, run log, Gemini adapter, `services` (five operations, none that closes, deletes or writes), write guards (`ensureCopy`, `requireOpen`), and four tools: `list_inbox`, `find_client`, `ask_user`, `propose_change`. Tested with a scripted model only (happy path, tool error, refused call, cancel, limits, retries, refusals, copy before write, locked month): web 495 → 551 tests. **No real Gemini call yet**; the first one is part of 4.3. Plan change, for the owner to see: the contract lists 14 tools but no step of the plan built the read and extraction tools, so **4.2b** was added (`read_document`, `extract_document`, `facts_for`, `get_client_context`, `query_rows`); `add_rows` and `move_file_to_declaration` stay with 4.4, `remember_rule` with 4.6, `run_report` and `ready_to_close` with phase 6. Gemini rules checked in the docs (HANDOFF, "Gemini function calling"); what is unverified is listed there. |
| 2026-10-16 | 4.2b: five tools built against `docs/AGENT_TOOLS.md`: `get_client_context`, `query_rows`, `read_document`, `facts_for`, `extract_document`; registry now has nine of the fourteen (`PENDING_TOOLS` lists `add_rows`, `move_file_to_declaration`, `remember_rule`, `run_report`, `ready_to_close`). `services` grew to eleven operations (none that writes, closes or deletes) and the agent folder got `adapters/` (the only place that touches pdf.js, SheetJS, canvas and the vision call), `fact-record.js` (one schema for the answer of the model and for its validation, plus the cleaning), `kinds.js`, `models.js` (provisional ids: orchestrator and extraction `gemini-3.8-flash`, strong `gemini-4-argon`), `prompts.js` (the Pass 1 prompt cut down to facts only, a stand-in for the skill of 5.1). Web 551 → 596 tests. **Deviations from the approved contract, all small:** (1) a PDF or HEIC over 14 MiB is refused with `invalid_argument` instead of being split by pages (a photo is shrunk; splitting needs pdf.js in the browser and has no real case yet); (2) `query_rows` also returns `total`, and `position` is 1-based like the column # of the table; (3) `get_client_context.chart_source` is `client` for the own chart and `built-in` for everything else, the shared chart of the root included; (4) `facts_for` reasons are a fixed list of codes (the model issues, `previous_year`, `duplicate`, `possible_duplicate`, `future_year`, `no_date`, `deduction_check`, `deduction_late`, `buyer_mismatch`, `pcn_over`, `pcn_allocation_missing`, `month_locked`, `low_confidence`, `kind_<kind>`). Changed existing code: `intakeFacts` takes an optional `targetMonth` (forces the month; `monthReason` becomes `override`). **Not verified:** no real Gemini call, so the response schema with `nullable` fields, temperature 0 for extraction on Gemini 3 (the Gemini 3 advice to keep the default temperature is from memory), HEIC and large PDFs, pdf.js text layer, image shrinking and the canvas size of a photo all wait for the first real run (4.3, owner key). |
| 2026-10-16 | 4.3: the assistant dock is a new row of the shell grid between the workspace and the status bar (`#assistant`, `web/assistant-ui.js`, `assistant.css`; the shell has four rows now). A bar that is always there: the title (opens the body), the progress line ("קורא מסמך (2)", "חושב…"), stop, and the quick buttons "עבד חדשים", "מה נשאר?", "דוח"; a body with the conversation, question cards (buttons, "אחר…", "דלג", the "remember for this client" box with the exact rule), proposal cards and a text field. `web/assistant-flow.js` puts services, registry, Gemini model and run log together (`createAssistantFlow`), builds the message of a run (`buildMessage`) and the line for the end of a run (`resultNote`); `app.js` only glues them (`runAssistant`). The loop got an optional `onProgress`. `ORCHESTRATOR_PROMPT` in `agent/prompts.js` is a stand-in for the base prompt and skills of phase 5: it says plainly that rows cannot be written yet. **What the dock can do today:** read the inbox, extract documents, check them with the rules of the software, suggest accounts from the client chart, ask questions, answer questions about the tables; it cannot write rows (4.4). **Deviations from the plan, small:** (1) the "דוח" button opens the existing reports of the open client (`reports.open()`), it does not start the agent (`run_report` is phase 6); (2) proposal cards show the changes but have no apply button yet (the apply path through the cell edit code is 4.4); (3) a typed request gets the last answer of the assistant as context, nothing more: there is no longer conversation memory. Web 596 → 613 tests. **Not verified:** a real run (needs the owner access code and files): the Gemini request formats listed as unverified in HANDOFF, the look of the dock at desktop width (the browser pane here is 280 px wide: RTL, cards and wrapping looked right), and the stop button during a real call. |
| 2026-10-16 | **First real run of the dock (owner, one real client, month 09/2026, "check the client for month 9"): the loop works end to end on Gemini** (`gemini-3.8-flash`: six turns, six tool calls, function declarations with upper-case types, `functionResponse` in a `user` content and the thought signatures were accepted; about 44,000 prompt tokens and 6,400 output and thinking tokens in all, roughly 6 US cents at the price of 16 October, to be confirmed from the bill; the whole conversation is sent again on every turn). Checked against the real table, the findings were right (code 820 is not in the client chart; duplicates, tax and National Insurance payments, the error row, a probable double entry of one receipt) but **four defects of ours** showed: (1) row handles were keyed by `documentId`, and two pairs of rows of that table share one (the groups of one invoice), so two rows got one handle and the numbering the model quoted (R30, R8…) was off by one or two from the rows of the table; handles are now keyed by month and row number and the agent is told to name rows by their number, never by a handle; (2) the model quoted the amount of the document (989.57) while the table shows what is recognised (25% of a home client, 247.39): `query_rows` now gives `recognized_total` next to `total` and the instruction asks for both when they differ; (3) it told the user to click apply on the card, which does not exist before 4.4: the instruction and the tool description now say so, and the card shows row numbers ("שורה 32 (09/2026) · …"); (4) an active row with zero amounts (marked ready) was not reported: new flag `zero_amount` and an instruction to report rows that look wrong. Checked with the same code on the real data root (read only): handles equal row numbers, row 5 is flagged, rows 9, 18, 20 and 27 are the duplicates. Web 617 tests. Still unverified: the vision call (`extract_document`) was not part of this run. |
| 2026-10-16 | **Model choice in the settings** (owner: there was none): three selects in the settings dialog (`#model-orchestrator`, `#model-extraction`, `#model-strong`; `model-settings-ui.js`), the offered models are the allow-list of the Worker (a test compares the two lists), the choice is kept in `common/ui-settings.json` as an **override of the default** (choosing the default again removes it, so a default that changes later reaches whoever never chose); the assistant flow reads the models before every run, the connection check uses the chosen assistant model. **General check before the owner tries PDFs** (all in HANDOFF): the stale `web/README.md` (it still said no AI and no intake) is rewritten; the limit of output tokens was too tight for the thinking of the model (4,269 of 8,192 in the first real run) and is now 16,384 for the assistant and 32,768 for extraction; in a real browser, on synthetic files, pdf.js loads from its CDN, the text layer of a PDF is read, a page out of range is refused, and a 42.5 MiB photo is shrunk to a 6.3 MiB JPEG of 3000 px in about 2 seconds (request 8.4 MiB of the 20 MiB the Worker takes); **a risk found, not yet settled:** the Worker parses the whole body, about 1 ms per MB on a PC and two or three times that in all, against a CPU limit of 10 ms per request on the Free plan of Cloudflare: files above 2 to 3 MB may fail there (the plan of the account is not recorded, see the open items); **a finding against our own rules:** the new modules have about 320 lines longer than the 120 characters of `AGENTS.md` (most are comments and the prompts); a formatting-only commit is proposed, not done. Web 626 tests; the Worker 54. |
