# UI redesign proposal: nothing waits unseen

Status: **approved by the owner for all seven changes** (30 October 2026: "implement it, then we'll try if it is good or not").
Built one commit per change on the branch `claude/wizardly-snyder-83391f`, not on `main` until the owner tries it.

| Change | State |
| --- | --- |
| C1 card states | built; checked in the local page with a scripted model (see `HANDOFF.md`) |
| C2 one-click clean import | built; checked in the local page |

## The goal in one sentence

Whatever the user still has to do (finish an import, answer a question, look at rows, handle files left in the inbox) is shown
by the page itself, outside the chat feed, until it is done; and a step that was started but not finished says so.

## What was looked at

- Code: `web/index.html`, `web/assistant-ui.js`, `web/inbox-ui.js`, `web/excel-import-ui.js`, `web/app.js` (run of the
  assistant, `openImportWizard`, the journal), `web/assistant-flow.js` (end-of-run notes), `web/journal-toolbar.js`,
  `web/journal-summary.js`, `web/sidebar-clients.js`, `web/agent/tools/add-rows.js`.
- A local walk in the built-in browser (static server of `web/`, window 1366×800) on a **synthetic** data folder in the
  browser's private storage: one invented client, a declaration 08/2026, an Excel journal built from
  `web/test/excel-journal-fixture.mjs` and two drawn "receipts" put into the inbox.
- **Not run:** a real check by the agent (it needs an access code and Gemini). The import card was drawn by the real
  `assistant-ui.js` and the wizard was the real `excel-import-ui.js`, both on copies of the page's elements, with the synthetic
  journal; the steps below were clicked by hand.
- Screenshots of the walk (synthetic data only) are kept outside the repository, because images are git-ignored here:
  the shared notes folder of this session, `ui-redesign-screens/` (8 files, named by what they show).

## What the user meets today (findings)

**F1. The import card says "the wizard opened" for ever.** The card button calls `openImportWizard`, which reports the line
"האשף נפתח." (`app.js:825`) as soon as the wizard is shown. Nothing listens for the wizard being closed: neither the × nor
"ביטול" of the Excel wizard, the codes dialog or the ledger check tells the card anything. The card keeps that line and its
button, the file stays in the inbox, the month stays empty. Reproduced in the walk: card → "הבא" → × leaves the card saying
the wizard opened. The income report path is the same: "ביטול" in its confirmation returns silently (`app.js:796`).
This is exactly the August case.

**F2. The chat feed is the only place the card lives, and it is memory only.** The feed is plain DOM
(`assistant-ui.js`); a reload, a closed tab or another day loses every card. The only trace of an unfinished import is the
small number of files beside "תיבת קלט" and beside the client in the sidebar.

**F3. Actions are buried in the feed.** The panel starts closed (`assistant-ui.js:426`). During a run the import card
arrives first; the agent's final text, the code's notes and the "rows were added" card come after it and push it up. In the
walk, at 800 px of window height, the open panel showed about three items, and the card's button was already half out of view.

**F4. Two buttons start the same check.** "בדוק מסמכים חדשים" in the panel bar (`index.html:83`) and "בדוק עם העוזר" in
the inbox dialog (`index.html:143`, `inbox-ui.js:254`) both call the same run under different names. The dialog's button sits
under the file list: with three files it was already below the fold. The panel's button is enabled with an empty inbox
(a model call that finds nothing).

**F5. The agent's summary hides the to-do.** The final text is one paragraph (`resultNote`, `assistant-flow.js:48`); the
one thing the user must do ("press בדיקה וייבוא") is a clause inside it. The code already knows the facts that matter
(files left in the inbox, rows added to look at, months that got rows, cards not acted on) but shows them as grey notes
after the paragraph, in the same style as everything else.

**F6. A clean Excel import still takes three clicks inside the wizard.** Card → "הבא" (step "בדיקה" lists every
classification code even when nothing needs a decision) → "ייבוא" → "סגירה". Each extra step is a place to stop half-way.

**F7. Rows to look at are visible only inside an open month.** The count "לבדיקה N" is in the summary bar of the open
table (`journal-summary.js:38`). The clients home, the client card and the sidebar show nothing about them, so a month with
rows to look at looks like any other.

**F8. The rows that "nothing is lost" adds are not counted as "to look at".** A document the agent left out becomes an
inactive row marked to look at (`add-rows.js:97`). The filter counts a row as "לבדיקה" only if it is not excluded from the
reports (`journal-toolbar.js:19`), and an inactive row is excluded, so these rows land under "מחוץ לדוחות" instead.
*From reading the code; not reproduced with a test yet.*

**F9. Related noise (not part of this plan).** Imported Excel rows show the orange status "מוכן, חסרים סימונים"
(already an open proposal in `HANDOFF.md`). When every row is orange, the orange of a real problem stops standing out.

## Proposed changes, smallest first

Size: **S** under ~80 changed lines with tests, **M** ~80–250, **L** more. Every change keeps the layout, the existing
functions' signatures (new options get defaults) and the existing Hebrew texts, unless a text change is listed.

### C1. The card tells the truth after the wizard closes (S, low risk) — fixes F1

What: the wizards opened from a card report how they were closed. The card then shows one of four states, with a coloured
edge and a line: ready (not opened yet), opened, **not finished** (closed without writing), done. "Not finished" keeps the
button, so the user can go back in. The income report's "ביטול" reports "not added" the same way.

Files: `excel-import-ui.js`, `ledger-codes-ui.js`, `ledger-check-ui.js` (`openWith` gets a new option `onClosed({ committed })`,
called from the dialog's `close` event); `app.js` (`openImportWizard`, `incomeReportImport`); `assistant-ui.js` (the card's
`data-state`); `assistant.css`; tests in `assistant-ui.test.mjs`, `excel-import-ui.test.mjs`, `app-excel-import.test.mjs`.

New texts (card line after the wizard was closed without import, and after the income report was cancelled):

| When | New text |
| --- | --- |
| wizard closed, nothing written | לא יובא: האשף נסגר לפני הסוף. הקובץ נשאר בתיבת הקלט. |
| income report cancelled | לא נוסף: ההוספה בוטלה. הקובץ נשאר בתיבת הקלט. |

Risk: low. The only behaviour change is a line on the card and its colour. Watch-out: the `close` event also fires after a
successful import, so "committed" must come from the wizard, not from how it was closed.

### C2. A clean Excel journal imports with one click in the wizard (S, low risk) — fixes F6

What: when the wizard is opened from a card and the file needs no decision (no errors, no new code names, no type the file
made the app change, and the target month is missing or empty), the wizard opens directly on the month step. That step
then also shows the one summary line and any warnings that the check step would have shown. Card → "ייבוא" → done. Any
decision to make (new codes, suggested types, a month that already has rows, a locked month) keeps today's steps.

Files: `excel-import-ui.js` (in `openWith` only; the menu path does not exist since 4.7.6), `dialogs.css` if the summary
needs a place on the month step, `excel-import-ui.test.mjs`. No new text.

Risk: low. The user no longer sees the list of known codes for a clean file; there is nothing to choose in it.

### C3. One check, one name (XS, low risk) — fixes F4

What: the button of the inbox dialog gets the same name as the panel's, so it reads as the same action; the panel's button
shows how many files wait and is disabled with a reason when the inbox is empty.

| Where | Old text | New text |
| --- | --- | --- |
| inbox dialog button | בדוק עם העוזר | בדוק מסמכים חדשים |
| panel button, files waiting | בדוק מסמכים חדשים | בדוק מסמכים חדשים (3) |
| panel button tooltip, inbox empty | (none) | תיבת הקלט ריקה |

Files: `index.html` (the label), `app.js` (passes the count from the inbox's `onCounts`), `assistant-ui.js` (a new
`setWaiting(count)`), `assistant-ui.test.mjs`. `inbox-ui.js` does not change.

Alternative for the owner: remove the dialog's button altogether, so the check starts only from the panel. That saves a
button but adds a step after dropping files (close the dialog, then press the panel's button). Recommended: rename.

### C4. Rows that "nothing is lost" added count as "to look at" (S, low risk) — fixes F8

What: an inactive row the code added for a document the agent left out (`needs_review` with the left-out reason) counts under
"לבדיקה" as well as under "מחוץ לדוחות", so the filter "לבדיקה" shows it. First a test that reproduces F8.

Files: `journal-toolbar.js` (`rowKinds`, changed existing function: listed in `HANDOFF.md`), possibly a marker set by
`app.js` when such a row is drawn, `journal-toolbar.test.mjs`. No new text.

Risk: low; the count "לבדיקה" grows by these rows, which is the point.

### C5. "For you" at the end of a run (M, low risk) — fixes F3 and F5

What: when a run ends, the page puts one card at the bottom of the feed, built by code, not by the agent: one line per open
item, each with its button. It lists import cards of this run that are not done, months that got rows to look at, files that
stayed in the inbox. The agent's paragraph stays, above it, folded to its first lines with a "show all" control. The panel
stays open while this card has open items.

| Where | New text |
| --- | --- |
| heading of the card | לטיפולך |
| import line | ייבוא {file} ל«{client}» לא הושלם |
| rows line | {n} שורות לבדיקה ב‑{month} של «{client}» |
| inbox line | {n} קבצים נשארו בתיבת הקלט |
| fold control of the agent's text | הצג את כל הסיכום |

Files: `assistant-ui.js` (a new `showTodo(items)`), `app.js` (`runAssistant` gathers the items from `result.added`,
`result.left`, `result.leftOut` and the cards it drew), `assistant.css`, `assistant-ui.test.mjs`. The agent's instruction does not
change, so no eval is needed for this step.

Risk: low. The facts all come from what the run returns today; nothing new is read.

### C6. A "waiting for you" strip outside the feed (M, medium risk) — fixes F2 and F3 for good

What: a thin strip under the top bar of the workspace, visible on every view, hidden when nothing waits. One entry per kind,
each a button that goes there:

| Kind | Source (code, not the agent) | Click goes to |
| --- | --- | --- |
| question of the agent waiting for an answer | the open question card of the run | opens the panel at the card |
| import not finished | the cards of this page session in state ready / not finished | opens the panel at the card |
| files in the inbox | the inbox index (already read for the sidebar) | opens the inbox dialog |
| rows to look at in the open month | the journal toolbar's count | sets the filter "לבדיקה" |

| Where | New text |
| --- | --- |
| strip heading | ממתין לך |
| question | שאלה של העוזר ממתינה לתשובה |
| import | ייבוא שלא הושלם: {file} |
| inbox | {n} קבצים בתיבת הקלט |
| rows | {n} שורות לבדיקה בחודש הפתוח |

After a reload, an import card is gone (the feed is memory only), but its file is still in the inbox, so the strip still says
files are waiting; the next check makes the card again. Keeping cards across reloads is listed under "Later".

Files: `index.html` (one element), a new `waiting-ui.js` (draws the strip from a list), `app.js` (feeds it from the inbox
counts, the assistant and the toolbar), `assistant-ui.js` (reports open cards; scroll to a card), `shell.css`, tests.

Risk: medium. It is a new always-visible element: it must not cover the table on a small screen, and its counts must stay in
step with the panel and the inbox (one source each, listed above).

### C7. Rows to look at across months and clients (M–L, medium risk) — fixes F7

What: the strip of C6 and the clients home learn about rows to look at in every **open** declaration, not just the open one:
a column "לבדיקה" in the clients home table, a small mark beside a month in the sidebar, and a strip entry
"{n} שורות לבדיקה ב‑{months}" that opens the first such month with the filter set.

| Where | New text |
| --- | --- |
| clients home column | לבדיקה |
| strip entry | {n} שורות לבדיקה ב‑{months} |

Files: a small reader of the saved tables of open declarations (reuses `loadDeclaration` and `rowKinds`'s rule on saved rows),
`clients-view.js`, `sidebar-clients.js`, `waiting-ui.js`, tests.

Risk: medium. It reads one table file per open month on each refresh of the list; with Anna's clients this is a few dozen
small files, but it must not slow the opening of the app (read once on open and after saves, not on every click). The rule
"needs a look" must be the same function for saved rows and for drawn rows, or the numbers will disagree.

## Recommended order

1. **C1** card states — the August case cannot happen silently any more.
2. **C2** one-click clean import — fewer places to stop half-way.
3. **C3** one name for the check — XS, can go with any other step if the owner prefers.
4. **C4** left-out rows counted as "to look at" — after a reproducing test.
5. **C5** "for you" card at the end of a run.
6. **C6** the "waiting for you" strip.
7. **C7** rows to look at across months and clients.

C1 to C5 change only what is already on the screen; C6 and C7 add a new element and new reads, so they come after the owner has
seen the first five on the published page.

## Later (not proposed now)

- Keep import cards across reloads (a small local list of prepared files, or the run log), so the card itself comes back.
- A shorter final text of the agent (a skill change: needs `npm run eval` first, per `AGENTS.md`).
- Whether "מה נשאר?" (a model call) is still needed once the strip answers that question without AI.
- The status "מוכן, חסרים סימונים" on rows that are not the agent's (F9; open proposal in `HANDOFF.md`).

## Not verified

- Every finding about a real run of the agent (order of cards, length of the summary) comes from the code and from the
  owner's report, not from a run in this session.
- F8 comes from reading the code; C4 starts with a test that reproduces it.
- The walk used one window size (1366×800); a smaller screen will make F3 and F4 worse, not better.
