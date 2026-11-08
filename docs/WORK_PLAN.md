# ANNATERIA: work plan

**Goal: Anna gets a WORKING product.** Replaces the earlier plan on 7 November 2026; the old one is
`docs/archive/WORK_PLAN-to-2026-11-07.md`. Work autonomously from milestone to milestone (`AGENTS.md`). A milestone counts only when its
"Done when" was shown by real use in the app.

Why the change: 142 commits and 981 tests, yet the show-stoppers reached the owner and Anna; the tests and the eval never ran a real day, and the trade knowledge was 101
lines. The app itself is kept: sync, reports equal to Rivhit samples and the PCN file equal to samples are real assets. **No rewrite.**

**No new features until M2 passes.** The rest of phase 9 is checked through the exams.

## M0. The lab (done 7 November 2026)

Make `D:\ANNATERIA-LAB` as in the skill's `references/lab.md`, and one committed command that starts the page and the local Worker. Replace the dead entries of `.claude/launch.json`.
Set the default model of the agent in `web/agent/models.js` to `gemini-3.6-flash`, for the orchestrator and extraction. Find out how the Windows dialogs can be driven.

*Done when:* you, with no help, opened the lab folder, logged in with the test code, opened a month of client B, ran the agent with the real model on one document, and saw the row.

Needs the owner: `GEMINI_API_KEY` in `worker/.dev.vars`. Everything except the real-model run can start without it.

## M1. The skill, deeper

Start from `.claude/skills/bookkeeper/`. Read the texts of the law for each **OPEN** and **WEB** rule in `references/trade-rules.md`: the VAT Law and Regulations, income-tax rules on home and vehicle costs, the book-keeping
directives, the allocation-number directive, Rivhit's manuals. Learn how the month of an Israeli bookkeeper really goes. Go through `docs/archive/` for the owner's and Anna's rules that were missed.
Write the worked examples the skill still lacks.

*Done when:* no **OPEN** rule is left unexplained (each has a source or is on the question list for Anna), and a fresh agent with only the skill can say what to do with 20 sample situations you wrote down in advance. Continues in the background after that: every exam feeds it.

## M2. Books exam (done 7 November 2026)

The deterministic half. For clients A and B: restore the lab, create the client from nothing, load codes, import every journal by the buttons, check against the ledger, make all reports, close, back up, restore. Compare with Rivhit's ledger, VAT, advances and profit and loss.

*Done when:* A and B give all report figures equal to Rivhit from a clean start, with every difference explained, and a person who does not know the code could follow each step on screen.

## M3. The gate (done 7 November 2026)

Turn what you did in M2 into a repeatable run of "Anna's day" in a real browser, on synthetic data committed to the repository, with a scripted model behind a fake Worker. It runs before every push with changes in `web/`. Add a check for undeclared names to `npm run check` (`tsc --checkJs` found the whole class once).

*Done when:* the gate fails on each of the three bugs of 6 November 2026 when you put them back (`view is not defined`; a month opened by click refused by the agent; a big PDF refused), and passes on the fix.

## M4. Documents exam, with the real agent (done 8 November 2026)

The hard half. Client B's real scan waiting in the inbox first, then B's September and October, C's photographed ledger, D's months, the photos of `examples`, and `pdf examples`. Read each document yourself before looking at the agent's rows. Use the scorecard of the skill.

*Done when:* you have a baseline scorecard per client, and the lost documents and false "ready" are at 0 on a clean repeat. Targets for wrong account and hand corrections are set here from the baseline.

## M5. Teach the app's agent

Move what made you better into `web/skills/`, with short rules, sources and examples. Reduce `BASE_PROMPT` in `web/agent/prompts.js` to mechanics: the flow and the rules go to skills, loaded when needed. Repeat M4's exams after each change and keep it only if the scores improve. Make the eval honest: real PDFs in a case, closed months, stale lists, from the page down.

*Done when:* M4's scores are better than baseline, and a Hebrew rule sheet exists for Anna to read through once.

## M6. Everything else Anna needs

The harder days in `references/month-cycle.md`, and the items below. Fix or cut each one. A second, independent agent repeats two exams from the skill alone.

- Backup, restore, sync and baton: full round trip in the lab; then a dedicated test folder on the real Drive, with the owner's word.
  Backup to the Drive test folder and restore into an empty folder: equal file by file (8 November 2026). Baton between two PCs: open.
- ~~PCN874 of a real month (old 6.4.4)~~: cut, the only sample with a PCN874 keeps double-entry books, which Anna does not keep.
  Old 9.8 VAT month on both reports: done in the lab, a sale and a purchase of a monthly client moved to the next month (8 November 2026).
- ~~Vehicle at 66.67% for real charts of accounts~~: done, 66% by account code or name (8 November 2026).
- Client rules (old 4.6.1): done, a rule saved by the button changed the agent's account; an edit keeps a copy (8 November 2026).
  Ledger check (old 4.7.4): done in M2, twice; it found exactly the operations the journals miss. Foreign currency: done, a real Zoom invoice in USD goes to review with the
  reason, converted by Anna at the rate of the day of payment (8 November 2026).
- ~~Dead code named in the archive~~: removed on 8 November 2026 (the client chooser's hints, list and buyer box, `agent/aliases.js`,
  `lockProblem`, `offerDistribution` and the move dialog's reason lines); the names are guarded by `removed-code.test.mjs`.
- Text on screen that was never checked: new Hebrew strings of 9.x, for Anna's list. The list is `docs/anna/new-texts-he.md`
  (37 texts, 8 November 2026); waiting for Anna's marks.
- **Physically needs people:** phone scanning on Anna's Android (old 2.5.2).

*Done when:* the independent agent passes both exams, and the list above is done, or cut with a line saying why.

## M7. Hand-over to Anna

Three unseen months in a row (from what you kept back) with 0 lost, 0 false ready, reports equal to Rivhit, and the hand-correction target met. Then, with the owner: walk through `docs/ROLLOUT.md`, new access codes for all, Anna's real data folder moved safely with a copy first, restore drill from Drive and flash, the first real month in parallel with Anna's usual way. A one-page Hebrew guide.

*Done when:* **Anna closes a real month in ANNATERIA without help, and it equals the same month in Rivhit.**

## Decisions

One line each, newest first.

| Date | Decision |
| --- | --- |
| 2026-11-08 | Anna (through the owner): foreign currency is always converted at the rate of the day of payment; the app marks, Anna converts. |
| 2026-11-08 | Owner: Anna will not keep double-entry books, so journal entry vouchers are not imported and PCN874 of such a client is not tested. |
| 2026-11-08 | Owner: the lab may write to `G:\My Drive\ANNATERIA-TEST` (encryption optional there); nothing else of the real Drive. |
| 2026-11-08 | Anna: two thirds of VAT is 66%, as in her Rivhit; rows saved at 66.67% keep it. A two-monthly client's first month in the second is not "before the month". |
| 2026-11-07 | The gate: `tools/gate/anna-day.mjs` (headless Chrome, fake Worker, scripted model, a 21 MiB scan, the folder picker replaced by a folder of the browser's private file system). `tools/gate/prove.mjs` shows it fails on each bug of 6 November. `npm run check` now fails on undeclared names. |
| 2026-11-07 | Journal wizard: a missing month is created without a second question; leaving a month asks nothing (it is saved and closed anyway). Found as friction in the M2 exam. |
| 2026-11-07 | The lab runs in a separate real Chrome, not in the desktop app's embedded browser, which aborts the folder picker. Windows dialogs and Chrome's prompts are answered by real controls (`tools/windows-dialog.ps1`), so folder permission bugs stay visible. |
| 2026-11-07 | Owner: the agent works as a real bookkeeper in the real app; all materials may be used for development and testing. Autonomy between milestones. |
| 2026-11-07 | Owner: the app's agent runs on `gemini-3.6-flash`. Checked that day: no shutdown date on the Gemini API; Google Cloud lists retirement on 19 November 2026 for its own platform; same price as 3.8 Flash until 31 December 2026. Re-check before M7. |
| 2026-11-07 | Owner may let the agent use the real access code; declined by the agent, its safety rules forbid typing a real code. A test code on a local Worker does the same job. |
