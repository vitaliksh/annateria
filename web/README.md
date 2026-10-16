# Browser client

This is the static, secret-free GitHub Pages application. It creates a
temporary Telegram upload session, receives images from the Cloudflare Worker,
sends them to Gemini pass 1 and presents the resulting journal rows for review.

The browser keeps clients, monthly declarations (locked or open), the journal, reports and the (deprecated) Rivhit
export in a local folder chosen with the File System Access API. The interface is ANNATERIA: a docked sidebar, a
clients start screen and client cards, a journal with a column chooser, reports as a page, and one dialog template.
The file map, the screens and the data model are in [`../docs/HANDOFF.md`](../docs/HANDOFF.md); the design decisions in
[`../docs/GUI_REDESIGN_PLAN.md`](../docs/GUI_REDESIGN_PLAN.md).

No image, PDF, TXT or client history is sent from this client to GitHub Pages.
The Worker receives images only for temporary delivery and Gemini processing.

For the bookkeeper agent, connect each PC once from **חיבור המחשב לשיפור AI**:
scan its temporary Telegram QR, then approve Windows Hello. The agent runs by itself after the
recognition of an upload, authorised by the open upload session; without a session the button
**עיבוד חשבונאי** asks for Windows Hello. No Gemini key is ever exposed in the browser.

## Excel migration and reports

The journal can import Rivhit's printed journal (`.xlsx`, one file per month) through **ייבוא מ‑Excel**: parsing is
deterministic, amounts are stored as source values, and the classification names are mapped through a per-root chart of
accounts (`common/chart-of-accounts.json`). **דוחות** produces the VAT, advances, profit-and-loss and classification
ledger reports from the declarations in the local folder; the PDF comes from the browser's print dialog. SheetJS is
loaded on demand from its official CDN (`cdn.sheetjs.com`). Formats and formulas:
[`../docs/EXCEL_IMPORT_SPEC.md`](../docs/EXCEL_IMPORT_SPEC.md), [`../docs/REPORTS_SPEC.md`](../docs/REPORTS_SPEC.md);
status and testing notes: [`../docs/MIGRATION_HANDOFF.md`](../docs/MIGRATION_HANDOFF.md).

## Backup and transfer

The sidebar item **גיבוי** writes encrypted copies of the data (text data and report PDFs, no images by default) into folders the
user picks: a Google Drive folder that Google Drive for desktop mirrors, and a USB drive used by hand about once a month; a dot shows
whether the copies are fresh. **העברה לקובץ** saves one month or a whole client into one encrypted `.annateria` file (USB drive or
e-mail) and imports such a file on the other PC (add-only merge). Both use the same recovery code, created once and kept on paper.
The app makes no network call for this. Format, runbook and limits: [`../docs/BACKUP_SPEC.md`](../docs/BACKUP_SPEC.md).

## Local check

From the repository root:

```powershell
py -m http.server 8000 --directory telegram-web
```

Before the test, place the public Worker URL in `config.js` and ensure
`http://127.0.0.1:8000` is in the Worker's `ALLOWED_ORIGINS` setting.

For GitHub Pages, set `TELEGRAM_TRANSFER_API` as a repository Actions variable
to the public Worker URL. The workflow writes that non-secret value into the
published artifact. Add the Pages origin to `ALLOWED_ORIGINS` and redeploy the
Worker.

## Checks

```powershell
npm test
npm run check
```
