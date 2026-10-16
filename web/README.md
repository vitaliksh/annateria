# Browser client

This is the static, secret-free GitHub Pages application: a local-first journal for a bookkeeper. It keeps
clients, monthly declarations (locked or open), the journal and reports in a local folder chosen with the File System
Access API. The interface is ANNATERIA: a docked sidebar, a clients start screen and client cards, a journal with a
column chooser, reports as a page, and one dialog template.

Status (step 0.3 of [`../docs/WORK_PLAN.md`](../docs/WORK_PLAN.md)): the transports inherited from ocr (Telegram upload
sessions, QR codes, passkey / Windows Hello, the Rivhit TXT export) are removed, so for now the app has **no AI and no
photo intake**; documents arrive through the Excel import and the income-report PDF import. The inbox and the in-app
assistant come in phases 2-4. The key to Gemini will live only in the Worker (`../worker`).

## Excel migration and reports

The journal can import Rivhit's printed journal (`.xlsx`, one file per month) through **ייבוא מ‑Excel**: parsing is
deterministic, amounts are stored as source values, and the classification names are mapped through a per-root chart of
accounts (`common/chart-of-accounts.json`). **דוחות** produces the VAT, advances, profit-and-loss and classification
ledger reports from the declarations in the local folder; the PDF comes from the browser's print dialog. SheetJS is
loaded on demand from its official CDN (`cdn.sheetjs.com`). Formats and formulas:
[`../docs/EXCEL_IMPORT_SPEC.md`](../docs/EXCEL_IMPORT_SPEC.md), [`../docs/REPORTS_SPEC.md`](../docs/REPORTS_SPEC.md);
inherited from ocr.

## Backup and transfer

The sidebar item **גיבוי** writes encrypted copies of the data (text data and report PDFs, no images by default) into folders the
user picks: a Google Drive folder that Google Drive for desktop mirrors, and a USB drive used by hand about once a month; a dot shows
whether the copies are fresh. **העברה לקובץ** saves one month or a whole client into one encrypted `.annateria` file (USB drive or
e-mail) and imports such a file on the other PC (add-only merge). Both use the same recovery code, created once and kept on paper.
The app makes no network call for this. Format, runbook and limits: [`../docs/BACKUP_SPEC.md`](../docs/BACKUP_SPEC.md).

## Local check

From the repository root:

```powershell
py -m http.server 8000 --directory web
```

The Worker URL goes into `config.js` (`window.ANNATERIA_API`, empty until step 1.4); the page then shows the Worker version
from `/health`.

## Checks

```powershell
npm test
npm run check
```
