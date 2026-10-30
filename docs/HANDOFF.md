# Hand-off notes

Facts a new developer or agent needs that the code does not say. Keep it true: update it in the commit that changes
the fact. The plan and its decision log are in `WORK_PLAN.md`; rules that must not be broken are in `../AGENTS.md`.

## Start here (state on 27 October 2026)

**State (27 October).** `main` carries everything; the last code commit f991558 is published (the page shows
`2026.10.26 · f991558`), `AGENT_VERSION` `base-2026-10-30a`. Web 902 tests (884 on 24 October; then 887 inbox lock, 892 documents
report, 897 "nothing is lost", 898 own documents, 899 freed originals, 902 tax calculator button, 903 ledger lines, 906 HEIC view, 911 booked amounts, 912 HEIC loading note, 917 Excel source, 918 income credit VAT; on the redesign branch: 923 card states, 924 one-click import), Worker 69 (`2026.10.23.2`,
Cloudflare `dd57e455`, untouched since), `npm run check` green in both. On 27 October the sidebar got the button
"מחשבון מס" that opens the owner's tax calculator in its own window (decision log of that day).
Accepted by the owner: phases 0, 1, 2; 4.1 to 4.5; 4.6.2; 4.7.1 to 4.7.3, 4.7.5, 4.7.6; phase 5 (5.1 to 5.4); 6.2; **6.3**; **phase 7**
(7.1 to 7.4, 7.6; 7.5 merged into 7.4). 6.1 (`run_report`) and phase 3 are in the backlog.

**Where the next session starts (27 October).** Anna's first real day (25 October) brought five fixes, all published (below, newest
first). The owner and Anna are now checking them on real data; nothing is half done. Open:
- **UI redesign "nothing waits unseen"** (30 October, owner approved all of `docs/UI_REDESIGN_PROPOSAL.md`; branch
  `claude/wizardly-snyder-83391f`, not on `main` yet: the owner tries it first). One commit per change:
  - **C1, the import card says how its wizard ended.** New `import-card-flow.js` (`watchWizard`): the page listens for the
    `close` of the Excel, codes and ledger-check dialogs it opened from a card; closed before writing, the card turns amber with
    "לא יובא: האשף נסגר לפני הסוף. הקובץ נשאר בתיבת הקלט." (the income report: "לא נוסף: ההוספה בוטלה. …"). The card has
    `data-state` waiting / opened / unfinished / answered. Changed existing code: `openImportWizard` (`app.js`), the card's
    `report` (`assistant-ui.js`, a new `state` field), `assistant.css`. Checked in the local page on synthetic data with a
    scripted model behind a faked Worker (the real agent loop made the real card): closed half-way → amber line; finished →
    green, button off, inbox 3 → 2. **Browser pane note:** while the pane is hidden Chrome holds back the dialog's `close` event
    until the page draws again (a screenshot lets it through); a real window is not affected. **Not verified:** the codes and
    ledger-check dialogs and the income report in a browser (unit tests only), the published page.
  - **C2, a clean Excel journal from a card imports with one click.** `openWith` (`excel-import-ui.js`, changed existing
    code) opens on the month step when there is nothing to decide (no error, no new code name, no type the file suggested,
    target month missing or empty); the summary line and the warnings are repeated there (`#excel-import-quick`,
    `#excel-import-quick-warnings` in `index.html`). Anything to decide keeps the check step. Checked in the local page: card →
    month step with summary and the "טיוטא" warning → "ייבוא" → done, card green. **Not verified:** the published page.
- **A credit note of income keeps its negative VAT** (30 October, owner). The Excel import flipped VAT to positive for every
  row that was not an expense credit, so Anna's credit invoice 140 of 8/2026 (net -403.63, VAT -72.65) came in with VAT
  +72.65 and output VAT 145.30 too high. VAT now takes the sign of net for every row (`excel-import.js`). Only that one row
  in the owner's data had it (scanned all clients); it must be imported again or fixed by hand.
- **The column "מקור" opens the source, also of an Excel row** (30 October, owner). The column and its buttons say "מקור" (photo
  "מקור #N", PDF "מקור PDF #N"). A row written by the Excel wizard from a card keeps `sourceHash` (SHA-256 of the file); its
  button "מקור Excel" finds the file in `clients/<client>/imports/` by that hash (a renamed copy too) and draws its sheets as a
  text-only table, right to left (`source-view.js`, SheetJS as the wizard). Rows imported before have no hash and show "—";
  the inbox refuses the same file again (its hash is in imports/), so linking them means deleting the import copy and the rows
  first. Checked in the built-in browser with the real August journal (local only). **Not verified:** the app's window with a
  data folder, the published page; the ledger check does not pass a hash yet.
- **Booked amounts are never cut again** (30 October, owner). Anna books property tax and electricity of a home client at
  25% already (her journal and the old ledger: "ארנונה 25%" 845 is the sum of the booked lines), but the page applied the
  25% rule to every row on every opening of a month, so imported rows (meant to be 100/100) and percentages typed by hand fell
  back to 25%. Now: rows of an Excel journal, of the ledger check and ledger lines read by the agent (record `booked`,
  `invoice-extraction` 3) are saved with `booked: true` and the rule skips them; opening a month keeps the saved percentages;
  a client edit re-applies the rule only when the kind of business changed. **Rows saved before the fix keep what they have:**
  earlier Excel imports of home clients may hold 25% on such accounts; fix by hand (it now stays) or import again.
- **HEIC originals are shown** (30 October, owner). Chrome and Edge show no HEIC, so the picture window of an iPhone photo was
  empty. `heic-view.js` turns the original into a JPEG in memory when it is opened (heic-to 1.6.5 from jsdelivr, libheif 1.23.5,
  the build without unsafe-eval, about 3 MB, loaded only then); the file in the declaration is unchanged. Checked in the built-in
  browser on one real HEIC page (raw HEIC not shown, JPEG 4284x5712 shown, about 7 s with the download). While it loads the
  window shows "טוען את התמונה, רק רגע…" in its middle (owner: the black window looked broken), and an error there. **Not verified:** the
  popup of the app itself (needs a data folder) and the published page; "PDF מסכם" still embeds HEIC as it is.
- **A photographed ledger of another program is read line by line** (30 October, owner; skills `invoice-extraction` 2 and
  `classification` 4, code unchanged). A new client's "כרטסת סעיפים" (three phone photos, not Rivhit) became three useless rows in
  10/2026: the reading took each page for one yearly report and placed it by the report's period. Now every listed line is a
  record (dated by its line, no period, reference as number; the business of the heading is the buyer, or the supplier in an
  income section; tax and National Insurance payments are payment_confirmation), so each line lands in the month of its date and
  missing months are created as for invoices. The owner checks the result once by hand against Anna's profit-and-loss sheet (no
  code check, owner's decision). **Fixed the same day:** the ledger's property tax and electricity of a home client were cut to
  25% a second time (see "Booked amounts" above). **Known, not fixed:** a dense page may exceed the 20,000-byte tool result; a PDF ledger of another program
  still goes to `ledger_check` (Rivhit only). **Not verified:** the eval (needs the owner's code; it stubs extraction anyway) and
  the real reading of the photos.
- **Which table is right.** During this debugging the owner's PC (`D:\ANNATERIA`) is the master (owner, 26 October): he deleted his
  earlier rows and re-ran both scans there. The last run (26 October, about 3 minutes, no question, nothing added by the app) gave
  the client 26 rows with their originals: 4 in 09/2026, 22 in 10/2026, her 8 own receipts as income 160; three rows inactive for
  Anna (a possible duplicate of 200.91, tickets of 50 in another person's name, a road-6 detail page without date and amount).
  Anna's PC still holds her own first run of 25 October for this client: settle with the owner which side wins before the two PCs
  meet through Drive. The test client the owner used by mistake had its 10/2026 declaration deleted (its originals went with it).
- **The eval was not run** for `base-2026-10-25a`, `base-2026-10-26a` and `base-2026-10-30a` (it needs the owner's access code: `npm run eval` with
  `ANNATERIA_CODE`; it costs money).
- **Speed and cost: postponed by the owner (27 October).** He sets Flash 3.6 for all three roles in his settings and finds it an
  acceptable trade-off; he fears that optimisation brings regressions. Measured on the last run: extraction of the 17-page PDF 82 s
  (the 8-page one 28 s in parallel), one turn deciding all 26 rows 47 s (6,700 thought tokens), 12 other turns about 45 s, the
  orchestrator 284k prompt tokens of which 186k cached; the tokens of extraction are not logged. Proposed, in this order, if he asks:
  log the usage of extraction; read a big PDF in chunks of 4 to 5 pages in parallel (overlap a page, join by document number);
  facts_for for many facts in one call; no query_rows before the summary; a lower thinking level (a hypothesis: check the Gemini
  docs first, then the eval); not Flash-Lite.
- **Where the originals are** (answered 27 October, from the code): a filed original is copied to
  `clients/<client>/declarations/<month>/images/NNN.<ext>` (to every month that holds a row of it) and leaves the inbox only after the
  copy is read back and the rows have it; import originals in `clients/<client>/imports/`; a file removed from the inbox in
  `inbox/_trash/` with its record in `index.trashed`; deleting a row never removes its original; the agent cannot delete anything.
  Every Drive snapshot holds the whole data root with the images (`sync-store.js`, images always in) and is never overwritten, so an
  older snapshot keeps what was later deleted. Exceptions: deleting a declaration removes its images from the PC; the USB backup
  leaves the images out unless its "with images" box is ticked.
- **Not verified:** "PDF מסכם" on real data (only synthetic originals), a HEIC original in it, the inbox lock during a real run with
  the dialog open.

**2.5 Phone scans into the inbox (Anna's show-stopper, 24 October; 2.5.1 done: published 9f72add, checked by the owner with his iPhone).** Anna scans with the Google Drive
app's widget into `phone/` of the shared folder (`G:\My Drive\ANNATERIA\phone` on the owner's PC); `web/phone-intake.js` takes the
files whose size did not change in 3 s into `inbox/_unsorted/` (the ordinary `addToInbox`) and deletes them from `phone/`;
`web/phone-ui.js` runs it every 30 s while the plate is green (always when no Worker is configured) and from the button
"בדוק סריקות מהטלפון" in the inbox dialog. The owner lifted the encryption rule for these scans only (`AGENTS.md`). The timer starts
only once a shared folder is chosen: an interval started for nothing kept `app.test.mjs` from ever ending. **The app never
creates `phone/`** and reads every folder named `phone` or `phone (N)`: on the owner's first try the folder the app had made and
the one the phone made were two Drive folders of one name, the phone's showed up on the PC as `phone (1)`, and the scan sat there
unseen. Web 884 tests.
**Checked:** iPhone (Drive app scan, PDF 3.6 MB) → PC in about 15 s → inbox, and the scan gone from `phone (1)`. **Not verified:**
an Android and the widget picking a folder that Anna's Drive holds as a shortcut (2.5.2, with Anna); deletion going to Drive's trash.

**Anna's first real check, 25 October: 24 rows without their original (fixed, published a8764e4).** She scanned two piles (8
and 17 pages) on the office copier and took the two PDFs into the inbox. While the run waited for her answer to "which client?",
both files were moved to `inbox/_trash` by the remove button of the inbox dialog (two clicks, 16:14:52 and 16:14:55 UTC; why is
not known). The agent then made the 24 rows from the facts it had already read, `move_file_to_declaration` failed on the missing
files and its message said they "stay in the inbox", which the summary repeated. Fix: the remove and clear buttons of the inbox
dialog are disabled (and refuse) while an assistant run is going, with a note on the count line; the tool answers `not_found`
("no longer in the inbox") when the original is gone. The owner chose that Anna imports the PDFs again for today's rows (she has
them); no code gives old rows their original. Found in the browser: `isBusy` read `let assistantRun` before its declaration
(the harness bundle turns top-level `let` into `var`, so the tests did not see it); the declaration moved up and a test checks
the order. Web 887 tests.

**A deleted row frees its original (26 October).** The inbox refuses bytes that are already an image of a declaration. Deleting rows
leaves their original in `images/` (nothing in a declaration is deleted), so a scan whose rows were deleted could never come in
again. Now an image counts as seen only while a row of its declaration's table uses it (a table that cannot be read counts all
its images). The owner's own case was a different one: he dropped the 17-page scan, whose rows are still in the client's table,
instead of the 8-page one (the names differ by `_0001`). Web 899 tests.

**The client's own documents (26 October).** In the owner's re-run every page of both scans became a row with its original (18 + 8),
but the 8 receipts the client issued herself (her VAT number as the supplier, a patient as the buyer) were asked about, and a wrong
pick from the list filed them under another client. `vat_id` now proves the client by the supplier's VAT number as well, and such a
document has no buyer mismatch (`AGENT_VERSION` `base-2026-10-26a`). The run took about 3.5 minutes (extraction of the 17-page PDF
75 s; one turn of 9,600 thought tokens, 64 s, deciding 18 rows; 19 turns re-sending a prompt that grew to 44k tokens, 521k in all,
388k cached); the owner first found 1.48 ₪ and 3 to 4 minutes per such run too much, then postponed any optimisation (above).
Web 898 tests. The next run (with this fix) booked her 8 receipts as income 160 without a question.

**Nothing that came in is lost (Anna's rule, 25 October).** The owner's re-run of the two scans left 11
documents of the 17-page file out of the table: `add_rows` rejected them (no buyer VAT number, or a mistyped one), the agent asked
"which client?" only about the other file and never added them again, then filed the file anyway; its summary said all was done.
Now the code guarantees it (`AGENTS.md`): `move_file_to_declaration` adds every document of the file still without a row as an
inactive row to look at, the end of a run files every file with rows that the model did not file, and `same_file` routing lets the
agent route the rest of a file. The instruction's "if a row was rejected, do not move the file" is gone (`AGENT_VERSION`
`base-2026-10-25a`). **The eval was not run** (it needs the owner's access code: `npm run eval` with `ANNATERIA_CODE`). Also seen in
that run: the client's own income receipts (she is the supplier) were booked as expense 212; gone since the fix of 26 October
(her own documents). Web 897 tests.

**The documents report is back (25 October).** The PDF of ocr with the original of every row above its
recognised fields ("PDF מסכם") had been removed on 17 October as dead code; Anna relies on it. It is now a kind of the
reports page (`web/document-report.js`, `docs/REPORTS_SPEC.md`), not a button. Checked in a local Chrome on synthetic
originals (a 3-page PDF and a photo): the right PDF page per row, a photo, and a row without an original. Web 892 tests. Renamed by the owner to "PDF מסכם".

**Anna's two requests of 24 October (both built and published the same day; the owner said the rollout tasks of phase 8 will be done
during the real work):**
- **6.3 The VAT report as Rivhit's** (done, owner: "looks excellent"): the address on the client card, Rivhit's top line on every
  report (name, dealer number, address), the VAT page drawn as the periodic VAT slip (`vatSlip` in `reports-pdf.js`). Steps 6.3.1
  and 6.3.2 below.
- **6.4 The PCN874 file** ("very important"): 6.4.1 exempt sales get their own box on the slip; 6.4.2 `web/pcn874.js` builds the file
  (spec, sources and mapping in `PCN874_SPEC.md`); 6.4.3 the reports page offers "קובץ PCN874" for a client with the PCN duty and
  saves it into the client's `reports/`. The file equals both of Anna's Rivhit samples (rows rebuilt by hand). **Not ticked yet:**
  6.4.1 (the owner's check on the page is postponed to the real work), 6.4.3 (the owner has not looked at it on the page), 6.4.4 (a
  real month of a PCN client in ANNATERIA, compared with Rivhit's file, checked in the Tax Authority's simulator; Anna uploads it).
- **Decisions of the owner on 24 October to keep:** the slip is drawn by the app, never Rivhit's picture (their PDF says the picture
  is theirs and this repository is public); our footer; nothing under the slip; the lock rule that counts sales rows over the
  allocation ceiling stays as in ocr (Rivhit's `S` line has no allocation number: ask Anna if it ever matters).
- **Anna's samples are real data** in the owner's `D:\Downloads` (`מעמ 9.26*.pdf`, `פקודה.xlsx`, `8 (1).xlsx`, `9.xlsx`,
  `PCN874_*.txt`): read them only when the owner asks, never copy them into the repository, record structure only. Throw-away
  scripts that read them lived in the session scratchpad (gone with it): splitting a PCN file by the widths of `PCN874_SPEC.md` takes
  a few lines.

**Phase 7 in one paragraph** (details: the decision log of 22 to 24 October and the sections below). Each PC keeps its own local data
folder. A shared Google Drive folder (`ANNATERIA`, with the app's own `annateria-sync/annateria-backup/` inside) holds encrypted
write-once snapshots with images (`web/sync-store.js`); a copy goes 10 seconds after a save, every 5 minutes and when the tab closes
(`web/sync-ui.js`, the ☁ icon). One PC works at a time: the Worker keeps the baton "who works" (`worker/src/baton.js`, a Durable
Object; device, user, last beat, last snapshot and its store id) and the page shows it as a plate in the top bar (`web/baton-ui.js`:
green here, red another device (table read only), blue taking the other device's copy, yellow paused after 10 idle minutes, grey not
checked). A PC that gets the baton first takes the other device's last copy (`pullSnapshot`: whole or not at all, every replaced file
copied to `common/sync-before-<time>/`, an empty copy never taken). The flash drive stays as the second copy with a weekly line in the
status bar. What each click does is in the reply of 24 October, summed up in `web/baton-ui.js` and `web/sync-ui.js` comments.

**Phase 8 (rollout on Anna's PC), where it stands.** First set-up on 23 October (evening): all clients arrived from Vitalik's PC. Two
problems of that night are fixed in the app (an empty copy is never taken; a shared folder one level too deep or too high is refused)
and in `docs/ROLLOUT.md`, which was rewritten from them. On 24 October the shared folder was cleaned (a stray store deleted, the folder
renamed from `annateria-sync` to `ANNATERIA`, store in use id `0db1…`), both PCs chose it again and the owner reported: "Works correct".
**Next, with Anna (8.1 is not ticked yet):** the flash copy (ROLLOUT step 9), the phone (step 10), her own access code (the script
replaces both codes), going through the one-page Hebrew guide (a claude.ai artifact, private until the owner shares it). **Then** 8.2
(her old ocr data, if any, and the reports), 8.3 (the first real month in parallel with her usual way), 8.4 (restore drills).

**Lessons of 22 to 24 October (follow them):**
- After every push to `main` that touches `web/`, check the GitHub run and the build marker of the page
  (`api.github.com/repos/vitaliksh/annateria/actions/runs`; the job log itself needs admin rights). 686b87a failed there and Pages
  silently kept the old version.
- Tests must not wait a fixed number of milliseconds: the CI runner is slower (wait for a condition; return the promise from timers).
- Before a pull writes, the page closes its open table without saving (45022d6): any later save of a table loaded earlier would
  overwrite what was taken.
- The owner's folders `D:\ANNATERIA` and `D:\ANNATERIA-B` hold **test** clients: read them freely while debugging (files, times,
  hashes). Anna's real data: only when the owner asks. The shared folder is visible from the owner's PC under `G:\My Drive\ANNATERIA`.
  Since the sync of 23 October `D:\ANNATERIA` also holds Anna's real clients (the owner debugs on them with her scans, 25 to 27
  October, at his request): keep results out of the repository and name no client, amount or document in commits.
- When writing to the owner, never put Hebrew inside a Russian or English line: mixed lines turn right-aligned and jumble. Name a
  button in Russian and give the Hebrew label on its own line.
- Scripts that edit files: write them with the file tool, not in a shell here-document (backslashes and `\d`, `\(` got eaten twice).

**Step 6.3.1 (24 October 2026): business details in the report header** (Anna's request: the VAT report as Rivhit's; the plan is
`WORK_PLAN.md` 6.3). The figures of the VAT report already equal her Rivhit samples for both test clients; 6.3.2 redraws the page.
How to repeat that comparison: her samples are in `D:\ANNATERIA\input\` (test root, free to read); compute `vatReport` of `web/reports.js`
from the declarations of the period with the client's `classification-codes.json` (a throw-away script outside the repository) and
compare line by line; never write the figures into the docs. **Changed existing code:** `workspace-core.js` (`normalizeClientTaxProfile`
keeps `address`), `workspace.js` (`fillProfile`, `readProfile` take an optional `address` input), `app.js` (the two inputs), `clients-view.js`
(one fact), `index.html` (one field in each client dialog), `reports-view.js` (new `formatVatId`, `businessLine`; `header` adds the
line), `reports-pdf.js` (`layoutReport` draws the number and the address on the top line; the name gets a `maxWidth`), `reports-ui.js`
(`info` carries `vatId` and `address`).

**Step 6.3.2 (24 October 2026): the VAT page as Rivhit's slip.** The slip is drawn by `vatSlip` in `reports-pdf.js` from the
places of the paper form (Rivhit's PDF holds a 496 x 244 picture of the form; it was read only to place the boxes and is not in the
repository; its field numbers are too small to read and are left out). Anna's choices: our footer, no table under the slip, the
exempt box empty (superseded by 6.4.1: it shows the sales rows without VAT). How to look at a drawn page at full size here: the browser pane is too narrow, so a throw-away static server
that also accepts `POST /__save/<name>` into the scratchpad lets the page post the canvas as PNG for the image reader (kept in the
session scratchpad, not in the repository). **Changed existing code:** `reports-pdf.js` (`layoutVat` rewritten, `rect` options,
`drawPage` fills a rect and takes its `lineWidth`), `reports-view.js` (`renderVatReport` lines and note; new `periodWords`, which
imports `monthName` of `reports.js`).

**Step 6.4.1 (24 October 2026): exempt sales on the slip** (first step of the PCN874 file, plan in `WORK_PLAN.md` 6.4). A sales row
without VAT is an exempt or zero-rate sale. **Changed existing code:** `reports.js` (`vatReport` returns also `taxableSales` and
`exemptSales`; `turnover` is unchanged), `reports-pdf.js` (the taxable box shows `taxableSales`, the exempt box `exemptSales`),
`reports-view.js` (the same two lines). Anna's PCN sample (VAT report, journal, file of one client for one month) is on the owner's
PC, outside the repository; read it only when the owner asks, record structure only.

**Steps 6.4.2 and 6.4.3 (24 October 2026): the PCN874 file.** `web/pcn874.js` (new, pure) and `docs/PCN874_SPEC.md`. **Changed
existing code for 6.4.3:** `index.html` (the option `pcn874` of `#reports-kind`, hidden; the buttons `#reports-save-pcn` and
`#reports-save-pcn-as`), `reports-ui.js` (keeps `declarations` and `chart` of the open client; `defaultPeriod` treats `pcn874`
as `vat`; `showActions`; the PCN branch of `buildReport`; `saveCopyAs` takes the file types; the two click handlers),
`reports-view.js` (new `pcnProblemText`, `renderPcn874Report`), `package.json` (check list).

**Waiting for the owner's own runs (do not tick before he reports):** 4.6.1 (a ticked rule lands in `rules.md`), 4.7.4 (an operations ledger
through the card), the phase check of 4.6 (a second similar month asks fewer questions), 6.4.1 and 6.4.3 (seen on the published page),
6.4.4 (a real PCN month). All of these, and 8.1 to 8.4, are expected to happen during the real work with Anna.

**Not verified in 6.3 and 6.4:** "שמירה בשם…" of the PCN file (the native picker cannot be driven from here); printing the VAT slip on
paper; a very long name or address in the slip's boxes (`maxWidth` squeezes it, not seen); the advances report of a client with
exempt sales (it uses the whole turnover; not compared with a Rivhit advances report of such a client).

**Open items (not started; the owner decides):**
- **66.67% VAT of a vehicle with a client's own chart** (postponed by the owner on 21 October): the 2/3 rule is applied only for the built-in
  codes 806, 807, 812 (`LIMITED_VAT_CODES` in `row-builder.js`, the same list in `applyBusinessRule` of `app.js`); a client chart has other codes
  (a test client: 214 "רכב רשוי וביטוח"), so its vehicle VAT is recognised in full. Anna confirmed 66.67% for a car. Proposed fix: decide by the
  name of the account, as was done for the 25% of a home.
- **Foreign currency:** Anna enters it in shekels at the rate of the date of receipt; the software does not convert (the row is for review).
  Converting needs an exchange-rate source (for example the Bank of Israel): an outside service, ask the owner first.
- **App help skill** (owner's reminder): the agent answers questions about the app itself (`WORK_PLAN.md`, "Later").
- The eval runner writes its report only at the end: a crash in the middle leaves nothing. Small fix: write the report after every case.
- The status "מוכן, חסרים סימונים" of rows that are not the agent's (inherited from ocr).
- Left from the tests: the Drive folder `annateria-sync-test` (shared with the owner's second Google account) and the folders
  `common/sync-before-*` in the test data roots; nothing uses them, the owner may delete them by hand.
- Not checked by hand: the 10-minute pause, "start anyway", the read-only table under the red plate, the permission prompt of a
  dropped file (unit tests only).

**How to run the eval** (costs money, about 2.3 USD for the full run of 16 cases x 2 with `gemini-3.8-flash`; use `--case a,b --repeat 1` while
working on one rule): in `web`, `$env:ANNATERIA_CODE = Read-Host "code"`, `npm run eval`, `Remove-Item Env:ANNATERIA_CODE`. The report goes to
`%TEMP%annateria-evaleval-<time>.json` (synthetic data only). Never edit a skill while the owner's eval is running: the runner reads the skills
from disk for every case. **How to find a Gemini error:** the Worker logs only the status; `npx wrangler tail annateria --format json` (in
`worker`) shows "Gemini answered <status>"; its events also carry the caller's IP and city, so keep only time, outcome, path and the log line,
and delete the raw output.

**Talking to the owner** (his request of 21 October 2026): short, simple replies without jargon; he is not a developer and not a bookkeeper.

### Log of 21 October 2026

**First real run after 5.1 (17 October 2026, 18:52; read from the run log and the data, structure only):** the skills loaded (the log header has
`base-2026-10-17o` and the three versions), the new row carries `agent.skills`, the client was routed by `alias` without a question, 7 tool
calls all ok, the original was filed (hash equal to the picture of the row, inbox empty), the amounts reconcile. **One defect seen:** the final
text of the model contained the internal handle "C1" although the instruction forbids handles. That run used `gemini-3.5-flash-lite`, chosen in
the settings (the default is `gemini-3.8-flash`); the rule existed only as text in the prompt. **Fixed (owner's yes, 21 October 2026):**
`handles.readable` (`web/agent/handles.js`) replaces issued `C`, `F`, `F1.1` and `R` handles in the final answer by the client name, the file name
or "שורה N (MM/YYYY)"; `run.js` applies it to the text of a completed run (the run log keeps the replaced text too). **Changed existing code:**
`agent/handles.js` (new method, imports `month-format.js`), `agent/run.js` (one line), `test/agent-boundary.test.mjs` (`handles.js` may import
`month-format.js`). **Not covered:** `Q`, `P`, `I` handles (no name to show); the text of `ask_user` questions and the `reason` of rows and proposals
(only the final answer is cleaned); a supplier name that happens to equal an issued handle (e.g. "F1") would be replaced. **Not verified:** a real run.

**Gemini answers 402 (21 October 2026, about 14:50 local time onwards).** Found with `wrangler tail` (the Worker logs only the status):
`Gemini answered 402`, i.e. payment required; the spend cap of AI Studio is not set (the owner's screenshot: "₪18.10 / -"), so it is the
billing of the Google project (probably a prepaid balance or a refused card; not verified, only the owner sees the billing). Until it is
fixed no model call works, in the eval and in the app. Since Worker `2026.10.21.1` a 402 answers code `billing` and the page says
"יש בעיה בתשלום ל‑Google עבור שירות ה‑AI. יש לפנות לויטליק." (before: "Gemini דחה את הבקשה").

**Eval of 21 October, 14:43 (after 6.2):** 91 of 118 checks. `close-month` passed both runs, and every case before the middle of the run
passed; from `previous-year` #2 on every model call ended with the Worker's `rejected` (Gemini answered a 4xx other than 429), in cases
that had passed an hour before. The cause was Gemini's 402 (see above), not the spend cap. The owner fixed the billing; the full eval after 5.4 passed 134 of 134.

**How 5.2 was done (kept as the recipe for a rule change).** Move the rules of ocr into the skills (the owner decides when to start; do not start without his "yes"):
read `D:\projects\ocr\agent-prompts\bookkeeper-agent.md` and `gemini-pass-1.md` (read only) and `ocr/docs/HANDOFF.md` ("Two-agent redesign",
"PCN clients", "Anna's first notes"); put what is a rule of the work into the skills, keep in code what code already does (duplicates, year,
periods, utilities 25%, allocation ceiling): the skill tells the agent to use the tool, not to compute. Create `pcn-allocation` (it gets its first
content here; add it to `SKILL_ROLES` in `web/agent/skills.js`); `month-closing-checklist` waits for 6.2. **How to change a skill:** edit the file,
raise `metadata.version`, run `npm test`: the failure prints the line to paste into `web/test/fixtures/skill-hashes.json`. The test that holds
the old prompts (`web/test/fixtures/legacy-prompts.json`, in `skills.test.mjs`) guards 5.1 only: 5.2 changes the rules on purpose, so remove that
fixture and its test in the same commit and say so. Run `npm run eval` before and after each rule change and put both summaries (pass counts, no case data) in the decision log; add a case for each rule that gets one.

### Anna's answers (21 October 2026, through the owner; put into the skills in 5.4)

In `classification` v3: taxes and National Insurance are not expenses (confirmed, no needs_review for that reason any more); a vehicle
licence fee is an expense on the vehicle account; a fine and a donation are not expenses; internet and software without an own account go to
the maintenance account and are a fit, not a loose one; a foreign currency: needs_review, the reason says to convert at the rate of the date
of receipt (the software does not convert). Eval: `loose-fit` became `internet-maintenance` (account 220), new `licence-fee` and
`parking-fine`. The date and PCN answers agree with what the code does: no change. Not built: converting a foreign currency (the rate of
the date of receipt would need an exchange-rate source, for example the Bank of Israel; an outside service, ask the owner first).

1. Payments of VAT and income-tax advances to the tax authority: not an expense, "no need to write it"; the owner chose to keep the
   current behaviour: a row that is not active (excluded from the reports), not_expense, with its reason. 2. National Insurance (ביטוח לאומי):
   not an expense. 3. Vehicle licence fee (אגרת רישוי): an expense (the vehicle account); a fine: not an expense; a donation: not an expense.
4. A yearly insurance goes to the month the document was received (the owner confirmed that "Bituah" in her answer means an ordinary
   insurance); electricity, telephone, water go by the date of the invoice. 5. VAT deduction: within 6 months (as the code does). 6. A water
   bill that becomes a tax invoice only after payment: the month the invoice is received. 7. A document without VAT above the ceiling needs no
   allocation number: yes (as the code does). 8. The ceiling follows the date of the invoice: yes (as the code does). 9. One tick per row or
   per invoice: her (voice) answer was about the amounts instead: gross = the total with VAT, VAT = the VAT of the invoice times the
   recognised percent (66.67% for a car), net = gross minus VAT; this is what `recognisedAmounts` does; the tick stays per row.
10. Internet or software without an own account: the maintenance account (אחזקה). 11. An invoice in a foreign currency: in shekels at the
   rate of the date the invoice was received (the software does not convert yet: a row for review, saying so).

**Open proposals** (cards, not started): the status "מוכן, חסרים סימונים" of rows that are not the agent's
(inherited from ocr).

**Practical notes.** The owner's data root `D:\ANNATERIA` (and its copy `D:\ANNATERIA-B` for the second browser profile) holds **test
clients, not real ones** (owner, 23 October 2026): read them freely while debugging (files, times, hashes), never copy them into the
repository. Anna's folder (phase 8) is real: read it only when the owner asks; record structure in the docs, never names or amounts, never copy it into the repository. `python` on this PC is the Microsoft Store stub (use
node); `gh` is not installed; for a browser check a throw-away static server of `web/` (a `.claude/launch.json` that is not committed) is enough for
module-level checks, but the dock itself needs a data root and the Worker. Pushes to `main` wait for the owner's explicit "yes" for that commit.

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

### Spike 7.1 (22 October 2026): a shared Drive folder between two accounts

**Set-up (the owner's PC):** Drive for desktop with two Google accounts, A on `G:`, B on `H:`, both "Stream files". A owns
`annateria-sync-test` in My Drive and shares it with B as an editor; B added it to its own My Drive with "Add shortcut", and it appeared as
`H:\My Drive\annateria-sync-test`. **Probe:** a throw-away page served from `localhost` (kept in the session scratchpad, not in the repository):
"write" puts files named `p-<written ms>-<size>-<first 16 hex of SHA-256>.bin` of random bytes into a subfolder, never over an existing name;
"watch" lists the other side's folder every 2 s and counts a file as whole only when size and hash match. Delays are measured on one clock.

| Run | Result |
| --- | --- |
| A → B, 10 x 1 KB, one per 30 s | 10/10, median 14.4 s, max 17.9 s |
| A → B, 100 x 10 KB and 1 x 16 MB | 100/100, median 38.9 s, max 54.4 s; 16 MB in 24.6 s; no partial read |
| B → A (shortcut side writes), the same | 1 KB median 15.2 s, max 40.8 s; 10 KB median 42.5 s, max 193.8 s; 16 MB in 42.0 s after **5 partial reads** |
| A → B with Drive paused about 2 min | 101 files written during the pause all arrived whole; a second pause: 101/101, 118 to 150 s after writing |

**What 7.2 to 7.4 must take from it:** (1) a file can be visible under its final name before it is whole, so the reader never trusts a
file before its size and hash match and otherwise says "waiting for Google Drive"; (2) Chrome writes through a temporary `<name>.crswap` and
renames on close, and Drive uploaded that temporary file too (it was gone later), so the reader ignores names it does not know; (3) many small
files are slow (100 files took 16 s to write on the streamed drive and up to about 3 minutes to arrive), so packs of a few big files are the
right shape; (4) the order in which files arrive was not measured: assume a snapshot can arrive before its pack.

**Google's documentation (read 22 October 2026):** up to 4 accounts at once, and syncing can be paused and resumed
(<https://support.google.com/drive/answer/10838124>); streamed files are available only while Drive for desktop runs, mirrored ones always,
shared drives can only be streamed (<https://support.google.com/drive/answer/13401938>). Neither page says how a shortcut to a shared folder
syncs; the spike showed that it does.

**Not covered:** two real PCs and a PC that is off for hours or days; Anna's PC and account; "Mirror files"; the real backup format through the
shortcut (backup on A, restore from B); Drive for desktop not running (the drive letter is then gone; the app should say so); the folder
permission after a browser restart on `H:`; both sides writing at the same time.

### Step 7.3 (22 October 2026): the push to the shared folder

**Checked in a real Chrome** (the browser pane, a local static server of `web/`, the data root and the "shared folder" as two folders of the
browser's private storage written into IndexedDB with a fresh key, synthetic client; no Google Drive): the icon appeared as `☁`, a click
wrote `annateria-sync/annateria-backup/` (store, one pack, one snapshot) and `common/sync-state.json`, the icon became `☁ ✓ 18:54` with
the tooltip; a second click wrote no new snapshot; no console error from the new code. The test data were deleted afterwards. **Not
verified:** the real Drive folder and the permission prompt after a browser restart (`☁ !`); the one-minute push after a real table edit
(unit tests only); the time of a push on a big root; what Drive does when two PCs push at once (no baton before 7.5).
**The first push of 7.3 (686b87a) failed `npm test` on the CI runner, so Pages kept 218a2ec.** The job log needs admin rights (the API
answers 403), so the cause was found locally: under CPU load the timer tests of `sync-ui.test.mjs` failed 6 of 8 runs, because the timer
callbacks did not return the push and the tests waited a fixed 25 to 50 ms. The callbacks now return the push and the tests wait for a
condition; 10 runs under heavier load passed. Lesson: after a push, check the run (`api.github.com/repos/vitaliksh/annateria/actions/runs`).

## Deployed versions

| What | Where | Version / how to check |
| --- | --- | --- |
| Web app | <https://vitaliksh.github.io/annateria/> (GitHub Pages, workflow `deploy-web.yml`, every push to `main` touching `web/`) | Build marker at the bottom of the sidebar: `YYYY.MM.DD · <short commit>`. After a deploy press Ctrl+F5 and compare it with `git rev-parse --short HEAD` |
| Worker | `https://annateria.vitaliksh.workers.dev`, version `2026.10.23.2` (Cloudflare `dd57e455`), record in `worker/DEPLOYMENT.md` | `GET /health` answers `BACKEND_VERSION` |
| Predecessor | ocr: `https://vitaliksh.github.io/ocr/` and the Worker `rivhit-telegram-transfer` | Not touched from this repository |

`web/config.js` sets `window.ANNATERIA_API` to the Worker URL; the sidebar shows the Worker version, and the login dialog opens on page load.

## How to run the checks

```powershell
cd web;    npm ci; npm test; npm run check   # node --test, 870 tests; check = node --check on every module
cd worker; npm ci; npm test; npm run check   # 69 tests; check = wrangler deploy --dry-run
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
  `adapters/` (`documents.js`: inside of files; `extraction.js`: the vision call), `web/assistant-ui.js` (the dock), `web/assistant-flow.js` (runs the agent for the dock), `assistant.css`, `web/model-settings-ui.js` (the model selects of the settings), `fact-record.js`, `prompts.js` (the base prompt and `AGENT_VERSION`), `skills.js` (parse, load and assemble the skills), `models.js`, `kinds.js`, `semaphore.js`; `rules-store.js` (reads `rules.md`). Specification: `docs/AGENT_TOOLS.md`. Not wired into `app.js` yet (4.3).
- **Skills (5.1, 5.2):** `web/skills/<name>/SKILL.md` (four: `invoice-extraction`, `classification`, `periods-and-duplicates`, `pcn-allocation`), `web/agent/skills.js`; tests `test/skills.test.mjs`, helper `test/skills-fixture.mjs`, ledger
  `test/fixtures/skill-hashes.json`.
- **Eval (5.3):** `web/eval/eval-core.mjs` (builds a case, runs it through `createAssistantFlow`, checks), `web/eval/run-eval.mjs` (`npm run eval`),
  `web/eval/cases/*.json` (synthetic cases); tests `test/eval.test.mjs`.
- **Rows of the agent (4.4):** `row-builder.js` (the row from a fact and a decision), `proposal-apply.js` (the apply button), `agent/facts.js`, `agent/answers.js`; the page side is
  `appendSnapshots`, `setRowImage`, `attachRowImages`, `openPdf`, `proposalOps` in `app.js`.
- **Client memory (4.6):** `rules-store.js` (`readRules` for the agent; `appendRule` and `saveRules` for the page only), `rule-text.js` (pure: the cleaned text of a
  rule), `client-rules-ui.js` (the dialog "כללים של הלקוח" of the client card, with the confirmed buyers), `client-alias.js` (pure: the rule of
  proof of an alias), `aliases-store.js` (`clients/<client>/aliases.json`: `readAliases` for the agent, `addAlias` / `removeAlias` for the page),
  `agent/aliases.js` (`holdersOf`).
- **Closing (6.2):** `lock-check.js` (the one check of the lock button and of `ready_to_close`), `agent/tools/ready-to-close.js`.
- **Inbox:** `inbox-store.js` (originals dropped by the user, `inbox/index.json`, SHA-256 dedup against the inbox and all declaration
  images; the Windows file-name rules and the accepted file types live here), `inbox-ui.js` + `inbox.css` (`#inbox-dialog`: drop target, picker,
  client choice, result lines; opened by `#open-inbox`). The backup already copies `inbox/` with the rest of the root.
- **Classification:** `rivhit-mapping.js` (Form 6111 map), `custom-rivhit-mapping.js`, `chart-of-accounts.js`,
  `ledger-*.js` (read the classification ledger, fix codes, reconcile with declarations).
- **Imports:** `excel-journal*.js`, `excel-import*.js` (Rivhit journal `.xlsx`), `income-report.js` (income-report PDF),
  `pdf-import.js` (PDF checks, pdf.js loader).
- **Reports:** `reports.js` (pure calculations), `report-data.js`, `reports-view.js`, `reports-pdf.js`, `pcn874.js` (6.4.2: the PCN874 file, pure),
  `report-viewer.js`, `reports-ui.js`.
- **Backup and transfer:** `backup-store.js`, `backup-state.js`, `backup-handles.js` (IndexedDB), `backup-ui.js`,
  `transfer-store.js`, `transfer-ui.js` (`.annateria` file), `sync-store.js` (7.2: the snapshot for the other PC, images always in,
  the files of one PC out; 7.3: `pushSnapshot` into `<shared>/annateria-sync/`, `common/sync-state.json`), `sync-ui.js` (7.3: the section
  "תיקייה משותפת" of the backup dialog and the ☁ icon `#sync-status`, the timers), `baton-client.js` and `baton-ui.js` (7.4.2: the
  plate `#baton-status` "who works": green, red with the table read only, yellow after 10 idle minutes, grey without a connection;
  7.4.3: blue while the other device's copy is taken). **Changed for 7.4.3:** `backup-store.js` (new `checkSnapshot`, `snapshotFiles`),
  `sync-store.js` (`pendingPull`, `pullSnapshot`, `applying`, `common/sync-before-*` local only), `sync-ui.js` (`pull`, `skip`; the ☁
  click takes a waiting copy), `baton-ui.js` (state `receiving`), `app.js` (`isPending`, `onReceive`, `onSkip`, a baton check when
  the data root changes). **Changed existing code for phase 7:** `backup-store.js`
  (`createBackup` takes `exclude` and `previous` and returns `unchanged` and `digest`), `backup-handles.js` (`SYNC_FOLDER_KEY`), `app.js`
  (`setupSync`; `sync.changed()` after `saveDraft` and after a lock; `sync.refresh()` when the data root changes; 7.4.2: `setupBaton`,
  `setTableLocked` also locks while another device works, `runAssistant` refuses then, a copy at `pagehide`), `sync-ui.js` (7.4.2:
  10 seconds after a save, `canPush`, `onPushed`, `lastPushName`), `index.html` (the icon,
  the section), `backup.css`, `package.json`.
- **Style:** `tokens.css` (the only file with colours; `styles.test.mjs` enforces it), `base.css`, `shell.css`,
  `dialogs.css`, `journal.css`, `clients.css`, `reports.css`, `backup.css`, `sidebar.css`, `photo.css`, `fonts/`.
- `worker/`: `src/index.js` (`/health`, `/v1/auth`, `requireUser`, CORS by `ALLOWED_ORIGINS`, 404 for the rest), `src/access.js`
  (codes, hashes, tokens), `src/auth-guard.js` (lock-out Durable Object), `src/baton.js` (7.4.1: the baton "who works", Durable Object `BATON`; routes `/v1/baton`, `/v1/baton/beat`, `/v1/baton/release`), `src/model.js` (what may be forwarded to Gemini), `scripts/access-codes.mjs` (creates codes and
  secret files outside the repository). Web side: `web/access.js` (token in memory), `web/access-ui.js` (login dialog), `web/model-client.js` (calls through the Worker; the settings button "בדיקת חיבור ל‑AI").
- `docs/`: `WORK_PLAN.md`, this file, `ARCHITECTURE.md`, `ROLLOUT.md` (8.1, the set-up on Anna's PC), and specs inherited from ocr (`REPORTS_SPEC.md`,
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

### Step 4.6.1 (17 October 2026): rules of a client

Decided by the owner (`docs/AGENT_TOOLS.md` question 12): the tick on a question card is the confirmation, so the **page** writes the rule at the click and
the tool `remember_rule` is gone (14 tools). `ask_user` `remember` is `{ client, rule, option }`: the rule is cleaned to one line (`rule-text.js`, pure, shared with
the store), bound to one option, refused with `choose_client`; the answer has `remember` (ticked and that option clicked) and `saved` (what the page reported).
`assistant-ui.js` calls the new `onRemember({ clientId, rule })` of `setupAssistant` only for the ticked box and the option of the rule and writes on the card what
happened; `app.js` finds the client (inside the data root) and calls `appendRule` (`rules-store.js`): `- <rule> (<date>, אושר ע״י המשתמש)`, never twice, also not
when the user typed it. The client card has the button "כללים של הלקוח" (`#client-rules`, hidden for a client outside the data root) that opens
`#client-rules-dialog` (`client-rules-ui.js`): the whole `rules.md` in a text field; a save keeps the text before in `rules.before-<time>.md`. The instruction has a
paragraph "RULES OF A CLIENT" (`AGENT_VERSION` `stand-in-2026-10-17m`). A test checks that nothing in `web/agent/` imports `appendRule` or `saveRules` and that only
`services.js` imports `rules-store.js` (`readRules`). **Changed existing code:** `agent/tools/ask-user.js` (remember), `assistant-ui.js` (`onRemember`, the box text
now names the answer, `finish` waits for the save), `workspace.js` (optional `clientRulesButton`, `onClientRules`), `app.js`, `index.html` (the button and the
dialog), `agent/prompts.js`, `package.json` (check). **Checked in a local Chrome (OPFS folder, synthetic client, no Gemini):** the dialog reads, edits and saves with a
copy; a card with the box ticked and the answer of the rule clicked wrote the line. **Not verified:** a real run where Gemini offers `remember` with an `option`; the
button in the client card of a real data root.

### Step 4.6.2 (17 October 2026): the confirmed alias

Decided by the owner (`docs/AGENT_TOOLS.md` question 13): the buyer printed on documents, once confirmed as a client, is routing proof. The
buyer of a fact is `{ vatId, name }` (`buyerOf`); a printed VAT number decides, otherwise the exact name after `nameTokens` (`aliasProves`).
`add_rows` `routed_by: alias` asks `holdersOf` (every client whose own VAT number or alias proves the buyer) and wants exactly this client.
`ask_user` with `choose_client` computes the offer (`aliasOffer`): all files extracted, one buyer (`provesSame`), no holder; the card gets
`alias: { vatId, name, clients: { optionId: clientId } }` and `assistant-ui.js` calls `onRememberAlias` (page, `addAlias`) for the ticked box and a
chosen client. **Changed existing code:** `agent/services.js` (read-only `clients.aliases`), `agent/tools/find-client.js` (`alias` match, `ORDER`),
`agent/tools/get-client-context.js` (`aliases`), `agent/tools/add-rows.js` (`verifyRouting` async, `alias`), `agent/tools/ask-user.js` (the offer,
`alias_saved`), `assistant-ui.js` (the box, `onRememberAlias`, hint `alias`), `client-rules-ui.js` (the list), `app.js`, `index.html`, `agent/prompts.js`,
`package.json` (check). **Not verified:** a real run with Gemini; the look of the box and the list on the published page.

### Step 5.1 (17 October 2026): the skills

The rules moved out of `agent/prompts.js` without a changed word (`docs/AGENT_TOOLS.md`, section 2, "Skills"). `web/skills/invoice-extraction` is the old
extraction prompt, word for word; `classification` holds the decision rules of the orchestrator (what a document is for the books, the
account of the chart, `decision`, `needs_review`, the reason); `periods-and-duplicates` holds the paragraph "THE SOFTWARE COMPUTES, YOU DECIDE" and the
sentences on the month, duplicates, previous years, recognition percentages and `month_override`. `BASE_PROMPT` keeps the mechanics. Choices made:
(1) **each skill goes to the model call it is meant for**, not all into the orchestrator: `invoice-extraction` is the system instruction of
the vision call only, because it says "you only read; you never classify" and the orchestrator never sees pixels; (2) the paragraph "THE SOFTWARE COMPUTES, YOU DECIDE"
was cut in two: the computing sentence went to `periods-and-duplicates`, "What you decide is…" to `classification`; (3) three short glue sentences are
new text (a lead-in in `classification`, the heading of each skill in the assembled instruction, one sentence in the base prompt that points to
the skills where the deciding sentence used to be). `AGENT_VERSION` is `base-2026-10-17o`. **Changed existing code:** `agent/prompts.js`
(`EXTRACTION_PROMPT` and `ORCHESTRATOR_PROMPT` are gone, `BASE_PROMPT` is new), `agent/adapters/extraction.js` (`createExtractionAdapter` takes `prompt`,
required), `assistant-flow.js` (loads the skills first; the option `system` became `fetchSkill`; `resultNote` knows `skills_unavailable`), `agent/run.js`
(`skills` option, kept in the context and in the run log header), `agent/run-log.js` (`header`), `agent/tools/add-rows.js` (`agent.skills`),
`package.json` (check), and the tests that read the old prompts. Nothing in `app.js` or the page changed. **Not verified:** the dock showing the
error (the real `runAssistant` needs a data root and a Worker; the message text is tested, and the flow was run in a real browser against a
local static server: three files loaded with status 200, and with one file removed the run did not start and no model was called); a run with real Gemini
after the move (the text is the same, but the order of the paragraphs in the instruction changed: the skills now follow the base prompt); the deployed
site serving `.md` files (GitHub Pages is expected to; checked after the push).

### Step 6.2 (21 October 2026): the check before closing a month

`web/lock-check.js` (pure): `lockProblems(rows, { pcnRequired })` gives the refusals of the lock button (`no_active_row`, `pcn_blocked`
with a count) and `lockProblemText` their messages, word for word the old ones. The lock button of the journal and the new tool
`ready_to_close` (`agent/tools/ready-to-close.js`, the 13th tool, read only) both call it, so the agent's "ready to close" cannot disagree with
the button. The tool answers `{ month, state, ready, blockers, warnings, summary }`: blockers with the row numbers (# column), warnings
`rows_to_review`, `inbox_waiting` (files in the inbox folder of the client), `inbox_unsorted`; a locked month answers `state: "locked"`.
New skill `month-closing-checklist` (v1): the agent never closes, answers from the tool only, and tells the user to lock with
"נעילת הצהרה" in the menu ⋯. Eval: new case `close-month` (the user asks to close; the agent must call `ready_to_close` and the month must
stay open); `eval-core.mjs` takes `request` (the words of the user) and the checks `called` and `stillOpen`. **Changed existing code:**
`app.js` (the lock handler calls `lockProblems`; the unused `reportRows` is gone; `pcnJournal.refresh()` keeps the plate up to date as the
old `lockProblem()` did), `pcn-review-ui.js` (`lockProblem` takes its text from `lockProblemText`), `agent/tools/index.js`, `agent/skills.js`,
the comment of `agent/prompts.js`, `eval/eval-core.mjs`, `package.json`; tests that count the tools (12 → 13). **Checked:** the full eval
after 5.4 (134/134, `close-month` included) and the lock button on the published page, by the owner ("OK").

### Step 5.2 (21 October 2026): the rules of ocr in the skills

Read (read only): `ocr/agent-prompts/bookkeeper-agent.md`, `gemini-pass-1.md` and `ocr/docs/HANDOFF.md` ("Two-agent redesign", "PCN clients",
"Anna's first notes"). Most rules were already in the skills since 5.1 in a short form; what was missing went in: **`classification` v2** (judge
by the title and the facts, not the kind alone; an insurer's letter about a payment or a renewal is an expense; which account: the client's chart
first, business insurance, vehicle policy, fuel, utilities by name, outsideVatBase and equipment accounts are valid, an account also for an
excluded row; **a loose fit is not ready**: the closest general account with needs_review; what the reason says), **`periods-and-duplicates` v2**
(what the software does with dates, in words, so the agent can explain it: the year of the declaration, a period of three months or more goes
to the month of receipt, closed months, the duplicate window; an exclusion is soft; a misread year on a blurred receipt: ask to check the date;
a late VAT deduction), **`pcn-allocation` v1** (new: the ceiling and the check are computed by the software, `facts_for` `pcn`; above the
ceiling needs_review and the bookkeeper's check, which the agent cannot give; a missing number: ask the supplier; the agent never writes or
changes a number, a correction only through `propose_change`). Kept in code, as before: duplicates, year, periods, 25% of utilities,
allocation ceiling. **`invoice-extraction` unchanged**: the eval does not cover the vision call yet, so a change there could not be checked;
the ocr extraction prompt and the skill agree except for the bounding boxes (not used here) and the "24 months" hint for two-digit years.
**Eval:** four new cases (`insurance-letter`, `vehicle-insurance`, `tax-payment`, `loose-fit`). With the old skills the owner's run gave 14 of 16
(`loose-fit` failed both times: internet charged to office supplies and marked ready); with the new skills the full run gave **108 of 108**
(13 cases x 2, `gemini-3.8-flash`, about 2.05 M tokens in and 85 k out, about 1.9 USD by my arithmetic). **Removed:** the 5.1 test that held the
old prompts and its fixture `legacy-prompts.json` (5.2 changes the rules on purpose). **Changed existing code:** `agent/skills.js`
(`SKILL_ROLES` gets `pcn-allocation`), the comment in `agent/prompts.js`; `AGENT_VERSION` is unchanged (the base prompt did not change).
**Not verified:** the wording of the reasons (the eval checks results, not words); the PCN rules with a real PCN client; anything with Anna.
**Still to confirm with Anna (step 5.4):** tax-authority and National Insurance payments are not expenses, and a licence fee, a fine or a
donation is unclear (both marked "not yet confirmed" in the skill); a period counts from three months; a document without VAT needs no
allocation number; the old ceilings apply to old invoices of the year; one tick per row of a split invoice; VAT deduction within six months.

### Step 5.3 (21 October 2026): the eval

Design agreed by the owner: the eval goes through the Worker with his access code, and the first version measures the decisions only (the
vision call is replaced by the facts of the case). **What it is:** `web/eval/cases/*.json` (9 cases: routing by VAT number, by folder, an
unknown buyer that needs "which client?", a duplicate, a document of a closed previous year, 25% electricity of a home client, a PCN invoice
above the ceiling without an allocation number, a foreign currency, a private purchase); each builds a data root in memory, runs the agent of
the dock (`createAssistantFlow`: the skills from `web/skills` on disk, the loop, the tools, the stores) and checks what was written: the row of
each expected document (client, month, account, status, active, recognition percentage), rows that must not be active or ready, the number
and kind of questions, the files filed, and that the run completed without a handle in its answer. The wording of the model is not checked.
**How to run** (PowerShell, in `web`): `$env:ANNATERIA_CODE = Read-Host "code"`, then `npm run eval` (options after `--`: `--case a,b`,
`--repeat 2`, `--model <id>` for the orchestrator, `--out <folder>`), then `Remove-Item Env:ANNATERIA_CODE`. The code and the token stay in the
process; a wrong code stops the eval after one login (the Worker locks out after a few). The runner sets `Origin` to the Pages origin, because the
Worker accepts only the page's origins. It prints one line per case and run and the failed checks; the full report (synthetic data, run logs
included) goes to `%TEMP%annateria-evaleval-<time>.json`. Exit code 1 when a check failed. **Cost:** not measured; my estimate is a few cents
per case and run (the first real run of 16 October used about 6 cents for six turns), so a full run of 9 cases twice is about 0.5 to 1 USD.
**Offline guard:** `test/eval.test.mjs` runs every case with a scripted agent that decides as the owner would and asserts that every check
passes, so a case the code cannot satisfy fails `npm test` (it found one: a document of 2025 for a client with no closed month goes to its own
new declaration 2025-11 as ready, because the year gate is relative to the target month; the case now has August 2026 closed, as a real client
would). **Changed existing code:** `assistant-flow.js` (optional `extraction`, never passed by the page), `package.json` (`eval`, check list).
**First real run (21 October, the owner, `gemini-3.8-flash`, 9 cases x 2):** 76/76 checks passed; about 1.19 M tokens in and 53 k out, about 1.1 USD by my arithmetic (so a full run costs about a dollar; use `--case` and `--repeat 1` while working on one rule). **Not verified:** whether the expectations match Anna's practice beyond the
rules written in the code (they were written from `intake-facts.js`, `home-utilities.js` and the skills, not checked with her). Not covered yet:
the vision call (synthetic PDFs, later), month questions, locked months, rules of a client (`rules.md`), aliases, imports.

### General check of 16 October 2026 (before the first PDFs)

- **Tests:** web 626, Worker 54, `npm run check` green. No Telegram, passkey, WebAuthn or Rivhit-export code left (`git grep`); `web/README.md` was stale (said there was no AI) and is rewritten.
- **Checked in a real browser on synthetic files, nothing sent to Gemini:** pdf.js loads from the CDN and `read_document` gets the text layer of a two-page PDF and one page of it; a page out of range gives `page_out_of_range`; the extraction request for a PDF carries the text layer and `inlineData`; a 42.5 MiB PNG goes through `browserShrink` to a 6.3 MiB JPEG of 3000 px in about 2 s and the request stays at 8.4 MiB. **Not checked:** HEIC (no sample, Chrome on Windows may not decode it; then the photo goes as it is if it is under 14 MiB), a PDF over 14 MiB (refused, no page splitting yet), the vision call itself.
- **Measured on the Free plan (second real run):** a request with a 718 KB PDF (0.96 MB body) used 41 and 34 ms of CPU and still answered 200; ordinary requests 1 to 4 ms. About 40 ms per MB, so the estimate below is too low, and the Free limit of 10 ms is not enforced as a hard cut, at least not at this size. Larger files not tried yet. `wrangler tail annateria --format json` shows `cpuTime`, `wallTime`, `outcome` and redacts the authorization header; its events also carry the IP address and the city of the caller, so only a summary should be kept (a script that prints just time, outcome, path and size was used).
- **Risk, Worker CPU (the estimate made before the measurement):** `/v1/model` reads the whole body, parses it, validates it and sends it on. Measured in Node on the owner's PC: `JSON.parse` of a body with base64 inline data costs about 1 ms per MB (6 MB: 6.5 ms; 18 MB: 18.7 ms); the rest of the path is of the same order, so two to three ms per MB is my estimate. Cloudflare gives the **Free plan 10 ms of CPU per request** (docs read for step 1.1, see below; not re-read today); then a photo or PDF above about 3 MB base64 (2.3 MB file) can end with a Cloudflare error that the page sees as a network error ("אין חיבור לשרת"). The plan of the account is not recorded: **the owner should say whether it is Free or Paid** (Paid: 30 s by default). If it is Free, the choices are the Paid plan, a smaller image before sending (`browserShrink` could be applied from a lower limit; the owner said image quality matters), or a Worker that does not parse the body (it cannot then validate it).
- **Output limit:** the thinking of the model counts against `maxOutputTokens`; raised to 16,384 (assistant) and 32,768 (extraction, the most the Worker allows). Thinking is also most of the cost of a run; a lower thinking level for extraction would cut it, but the parameter was not verified, so it is not used.
- **Style:** about 320 lines of the new modules (agent, inbox, assistant) are longer than the ~120 characters of `AGENTS.md`, mostly comments, prompts and tool descriptions. A formatting-only commit would fix it; proposed to the owner, not done.
- **Run logs hold data:** `common/agent-runs/*.json` keep the arguments and a shortened result of every tool call (supplier names, amounts). They are local, in the backup, and must be treated like the rest of the data root; nothing deletes them.
- **PDF through the dock:** put the PDF in `תיבת קלט`, press "בדוק מסמכים חדשים". An income report goes the same way since 4.7.5: the agent prepares it and its card adds it to the month of the report; the menu "ייבוא ובדיקות" is gone (4.7.6).

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
