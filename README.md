# ANNATERIA

A local-first web app for one bookkeeper and the owner: a monthly journal per client, reports computed by code (VAT,
advances, profit and loss, classification ledger), an encrypted backup and a transfer file. Hebrew, RTL, Chrome or Edge.
The next phases add a no-AI inbox, an in-app assistant (Gemini through a thin Worker) and sync between two PCs.
The app helps a bookkeeper; it is not tax advice.

**Published page:** <https://vitaliksh.github.io/annateria/> (Ctrl+F5 after a deploy; the build marker at the bottom of
the sidebar is `date · short commit`).

## Status

Phases 0 and 1 are done: the code of the ocr project is copied and cleaned, the page is published, and the Worker is
deployed with the access code (`/v1/auth`) and the Gemini proxy (`/v1/model`). The login dialog and the settings button
"בדיקת חיבור ל‑AI" work on the published page. Everything comes in through the **inbox** (`תיבת קלט`): the assistant turns
invoices into rows, and recognises import files (Rivhit journal, classification-codes ledger, operations ledger, income report),
for which it leaves a card that opens the existing wizard (step 4.7; the menu "ייבוא ובדיקות" is gone). Where to start:
[`docs/HANDOFF.md`](docs/HANDOFF.md), section "Start here"; the plan: [`docs/WORK_PLAN.md`](docs/WORK_PLAN.md).

## Layout

| Path | What |
| --- | --- |
| `web/` | The static app published to GitHub Pages (no build step, ES modules) |
| `worker/` | Cloudflare Worker, a thin Gemini proxy; today `/health`, the access code `/v1/auth` and the Gemini proxy `/v1/model` |
| `docs/` | Plan, architecture, hand-off notes, inherited specs |
| `.github/workflows/` | Test and deploy of `web/` |

## Run and check

```powershell
py -m http.server 8000 --directory web      # open http://127.0.0.1:8000, pick a COPY of a data folder
cd web;    npm ci; npm test; npm run check  # 808 tests
cd web;    npm run eval                     # the agent on synthetic cases, real model: costs money (docs/HANDOFF.md)
cd worker; npm ci; npm test; npm run check  # 54 tests (check = wrangler dry run)
```

## For developers and AI agents

Read [`AGENTS.md`](AGENTS.md) (rules that must not be broken), [`docs/WORK_PLAN.md`](docs/WORK_PLAN.md) (what to do next),
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/HANDOFF.md`](docs/HANDOFF.md) (repository map, versions, open
points). The predecessor is `vitaliksh/ocr`; it is read-only for this project.
