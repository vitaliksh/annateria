# Hand-off

The present state only, at most 80 lines. Rules: `../AGENTS.md`. Plan: `WORK_PLAN.md`. Old notes: `archive/HANDOFF-to-2026-11-07.md`; search it by name when needed
(repository map, deployed versions, Cloudflare and Gemini facts), do not read it through.

## State on 8 November 2026

- **M0 done.** One document of client B through the real app and the real Gemini; row equal to my reading.
- **M1 done in its first form.** The law read for every OPEN and WEB rule (`trade-rules.md`, sources in the lab's `law` folder); worked examples added; a fresh agent with only the skill answered 20 situations in line with the key (`D:\ANNATERIA-LAB\runs\m1-situations`). Continues with every exam.
- **M2 done.** A and B from nothing by the buttons, twice: by me, then by an independent agent with only the skill. VAT, advances, every P&L line and every ledger total equal Rivhit; backup and restore equal; the P&L now also has Rivhit's cost-of-sales group. Fixes from both runs are in; what is still awkward on screen is listed in `D:\ANNATERIA-LAB\findings.md`.
- **M3 done.** `node tools/gate/anna-day.mjs` runs before every push of `web/` (`.githooks/pre-push`); `node tools/gate/prove.mjs` shows it fails on each bug of 6 November. `npm run check` fails on undeclared names.
- **M4 done.** Real documents through the real agent, against my reading and Anna's journals, each with a clean repeat: B's 21-page scan, B's 15 phone photos (14 rows equal her journals, VAT to the agora at 66%), C's photographed ledger (47 of 47 lines exact), D's two scans (25 rows), E's two-month pack (34 pages). Lost 0, false ready 0 on every clean repeat. Targets from the baseline: wrong account at most 1 in 20 rows, hand corrections at most 1 in 10. B's September (36 photos, two PDFs) checked against my own reading: 0 lost, 0 false ready after the receipt-and-invoice fix. Scorecards in the lab's `runs`.
- **M5:** Hebrew rules sheet for Anna (`docs/anna/rules-he.md`); rules that made me better are in `web/skills/` (classification v6).
- **M6 under way.** Backup to the Drive test folder `G:\My Drive\ANNATERIA-TEST` and restore into an empty folder: equal file by file. Two PCs (a second Chrome profile): the baton and the copy go both ways; two defects found and fixed (the last copy on "finish work", the baton taken back). Cut: PCN874 of a real month (double-entry client; Anna will not keep double-entry books). Done since: VAT month on both reports, foreign currency (real Zoom USD invoice; Anna: rate of the day of payment), client rules, ledger check (M2), dead code, the list of new Hebrew texts for Anna (`docs/anna/new-texts-he.md`). Left in M6: the independent agent's two exams, blocked on 8 November by folder pickers aborting in the lab Chrome (see `references/lab.md`, known traps); Anna's marks on the texts.
- `main` has everything. Web 1045 tests, Worker 74.
- Published page: <https://vitaliksh.github.io/annateria/>. Worker: `https://annateria.vitaliksh.workers.dev`, version `2026.11.10.1` (11 Nov 2026: GET /v1/rate, foreign currency into shekels). Not checked yet: that the Bank answers the deployed Worker (only the local one was tried); a foreign row still marked "מטבע זר" would mean it does not. Details are in `worker/DEPLOYMENT.md`.
- Anna has the app and tried it on 25 and 31 October, and is waiting for a product that works. Anna's time is not to be spent on testing. Questions for Anna go as a short list.
- `D:\ANNATERIA` has real clients (5, one empty). It is the owner's debug master and is read only for agents.

## What is known to be wrong or unknown

- No run through the page before 6 November had really worked since step 9.6; the fixes are not proved on a real month. M4 is the first proof.
- Reading of real documents has never been measured. Eval totals of 100% carry no signal: it stubs the reading, with fake PDFs, open months and fresh lists.
- 29 checkboxes of the old plan stayed open, many only waiting for a click by the owner. M2, M4 and M6 cover them; no need to tick old boxes.
- Open rules are listed in `.claude/skills/bookkeeper/references/trade-rules.md`. Defects and questions of the exams: `D:\ANNATERIA-LAB\findings.md`.
- Anna answered on 7 November (rules in `trade-rules.md`, dated): journals never miss ledger operations (now a discrepancy to review); B is two-monthly; B's advances 23% monthly; a late invoice may be deducted; a fixed asset is one item of 1,000 or more; the account of a subscription does not matter. A water bill paid by standing order: the six months run from the invoice's date.
- Agent rows do not keep what the agent first read in a usable form (`row.agent.fact` is not an object), so hand corrections cannot be counted from the table. The scorecard counts them for now. Run logs (`common/agent-runs/`) may help; not checked.

## Environment

- **Key:** `GEMINI_API_KEY` is in `worker/.dev.vars`. Never read or print it. Spend cap: set by the owner in AI Studio; a run refused with `rejected` or `402` probably means the cap (seen on 21 October). Report it, do not retry.
- **Model:** default in `web/agent/models.js` is `gemini-3.6-flash`. An app's own saved choice (`common/ui-settings.json`, `models`) can override the default.
- **Lab tools:** `tools/` (`lab.mjs`, `browser.mjs`, `windows-dialog.ps1`, `doc.py`); how to use them is in the skill's `references/lab.md`.
- **Phone:** Remote Control is connected for the planning session. Push needs the owner's two settings (see below); until then `PushNotification` answers "not sent".

## Waiting for the owner

- [ ] Push to the iPhone: Claude app signed in with notifications allowed; in an interactive `claude` terminal, `/config`: **Push when Claude decides** and **Push when actions required**.
- [ ] Desktop app, Settings, Claude Code: **Connect new sessions to Remote Control**.
- [ ] Permission mode of the new session, so it does not stop at each tool: auto mode is allowed by policy.

## Not checkable by an agent

- Anna's Android phone scanning, Anna's PC, the first real month with Anna (M6, M7).
