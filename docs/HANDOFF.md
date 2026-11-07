# Hand-off

The present state only, at most 80 lines. Rules: `../AGENTS.md`. Plan: `WORK_PLAN.md`. Old notes: `archive/HANDOFF-to-2026-11-07.md`; search it by name when needed
(repository map, deployed versions, Cloudflare and Gemini facts), do not read it through.

## State on 7 November 2026

- **M0 is done** (see the skill's `references/lab.md`): one document of client B through the real app and the real Gemini; row equal to my reading. Next: **M1, M2**.
- `main` has everything. Web 997 tests, Worker 69, per the last counts on record.
- Published page: <https://vitaliksh.github.io/annateria/>. Worker: `https://annateria.vitaliksh.workers.dev`, version `2026.10.23.2`. Details are in `worker/DEPLOYMENT.md`.
- Anna has the app and tried it on 25 and 31 October, and is waiting for a product that works. Anna's time is not to be spent on testing. Questions for Anna go as a short list.
- `D:\ANNATERIA` has real clients (5, one empty). It is the owner's debug master and is read only for agents.

## What is known to be wrong or unknown

- No run through the page before 6 November had really worked since step 9.6; the fixes are not proved on a real month. M4 is the first proof.
- Reading of real documents has never been measured. Eval totals of 100% carry no signal: it stubs the reading, with fake PDFs, open months and fresh lists.
- 29 checkboxes of the old plan stayed open, many only waiting for a click by the owner. M2, M4 and M6 cover them; no need to tick old boxes.
- Open rules are listed in `.claude/skills/bookkeeper/references/trade-rules.md`.
- `npm run check` is syntax only, until M3.
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
