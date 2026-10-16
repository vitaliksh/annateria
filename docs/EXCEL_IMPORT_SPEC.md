> Inherited from `vitaliksh/ocr` (copied 16 October 2026). Content is unchanged except that paths `telegram-web/` now read `web/`.
> Parts about upload sessions, QR, passkey and the Rivhit export describe code that step 0.3 removed.

# Rivhit journal Excel import contract

One-time migration input: Rivhit's printed journal "ספר תקבולים תשלומים – יומן קליטה" saved as `.xlsx`, one file per
declaration month. This is the format of the six sample files (months 1, 2, 4, 5, 6, 8 of 2026; 220 rows), checked
against the real files on 2 October 2026. The files hold real client data: never copy names, IDs or amounts into code,
tests or docs. Tests use synthetic grids from `web/test/excel-journal-fixture.mjs`.

## Reading the workbook

- The workbook has two sheets, `גיליון2` (data, first in the workbook) and `גיליון1` (empty). Pick the sheet by name
  `גיליון2`; if it is missing, take the only sheet that has cells; otherwise reject the file.
- All cells are text, except the date column, which is a real Excel date (serial number, e.g. `46023` = 2026-01-01).
  The reader adapter converts it to `YYYY-MM-DD`; the parser accepts either a serial number or an ISO string.
- `web/excel-journal-reader.js` does this: it checks the ZIP signature (SheetJS otherwise parses any bytes as
  text), anchors the range at `A1` and keeps dates as serial numbers.
- The reader returns a grid `rows[rowIndex][colIndex]` (0-based) with empty cells as `""`. The parser never touches
  the xlsx library.
- Text cells may carry U+200F (RLM) and spaces. Trim every text cell. Labels are matched on trimmed text.

## Layout (1-based Excel coordinates)

| Area | Position | Content |
| --- | --- | --- |
| Print header | `C3`, `K3`, `C4` | print timestamp, title, page info; ignored |
| Declaration month | `K5` | `לחודש M/YYYY`; a suggestion only |
| Column labels | row 9 (`F9`, `G9`), row 10 | `אסמכ' 2`, `אסמכ' 1`; `סטטוס`, `מע"מ`, `ללא מע"מ`, `כולל מע"מ`, `פרטים`, `חשבון נגדי`, `קוד מיון`, `שורה`, `תאריך` |
| Data | row 11 onward, odd rows only | one transaction per row; even rows are empty spacers |
| Footer | after the last data row | see below |

Locate things by label, not by fixed offsets: find the header row by `סטטוס` in column A, the data by rows with a
date in column N, the footer by the label texts.

Data columns:

| Col | Field | Notes |
| --- | --- | --- |
| A | status | `טיוטא` (draft) in all samples; other values are kept as text and reported |
| B | VAT | text number, see signs |
| D | net | text number |
| E | gross | text number |
| F | reference 2 | empty in all samples |
| G | reference 1 | digits or empty (27 of 220 empty) |
| I | details | short supplier name |
| J | counter account | always `כרטיס כללי 0`; ignored |
| L | classification name | the only classification identifier in the file (no code) |
| M | line number | has gaps; display only, never a key |
| N | document date | real date; 64 of 220 fall outside the file's month, which is normal |
| C, H, K | none | empty in data rows |

## Numbers and signs

- Text numbers use `,` as thousands separator and `.` as decimal point: `"1,325.42"`.
- Parentheses mean negative: `"(38.14)"` is `-38.14`. Zero is `"0.00"`.
- Net + VAT = gross in absolute terms on every sample row; VAT is ≈ 18 % of net, or ≈ 11.3 % for 66.67 %-recognised
  items (vehicle, cellular, EV charging), or zero.
- Sign convention is mixed. Do not infer the kind from the sign of one cell:

| Row kind | VAT | net, gross |
| --- | --- | --- |
| Expense | negative (parentheses) | positive |
| Credit note on an expense | positive | negative (parentheses) |
| Income (class `הכנסות`) | positive | positive |

- Expense versus income is decided by the classification name `הכנסות`, never by sign.

## Footer

Row numbers below are those of the samples; locate by label.

| Row | Cell | Text | Meaning |
| --- | --- | --- | --- |
| last + 1 | `B`, label in `E` `:סה"כ מע"מ לחודש` | number | total VAT = Σ signed column B |
| last + 3 | `I` | `סיכום אריטמטי ללא מע''מ לביקורת : N` | Σ column D, signed |
| last + 3 | `M` | `סיכום אריטמטי כולל מע''מ לביקורת : N` | Σ column E, signed |
| last + 4 | `D`, `I`, `M` | `ת.ציוד כולל : N`, `תשומות כולל : N`, `עסקאות כולל : N` | gross of equipment, inputs, outputs |
| last + 5 | `D`, `I`, `M` | `מע"מ ת.ציוד : N`, `מע"מ תשומות : N`, `מע"מ עסקאות : N` | VAT of equipment, inputs, outputs (positive) |

The label text contains an ASCII `''` (two apostrophes) and variable spaces around `:`. Parse with
`/(.+?)\s*:\s*([\d,.()]+)$/`. The total VAT label is written with the colon first (RTL rendering).

### Checksums

Verified on all six sample files:

1. Σ net (signed) = arithmetic net; Σ gross (signed) = arithmetic gross.
2. Σ signed VAT = total VAT, and total VAT = outputs VAT − inputs VAT − equipment VAT + Σ signed VAT of the rows
   outside the VAT input base. The total is the plain sum of column B, so VAT on such a row (clothing, `ביגוד`) stays
   in it while the inputs line leaves it out. The six samples had no such row; a second client (Oct 2026) did.
3. Outputs gross and VAT = Σ gross and VAT of the income classes (`הכנסות`; another client names it `הכנסה חייבת`).
4. Equipment gross and VAT = Σ of the equipment class (`רכישת ציוד/רכוש קבוע`, code 900).
5. Inputs gross and VAT = Σ over remaining expense rows, **excluding** classes outside the VAT input base
   (`ביטוח עסק`, `ארנונה`), with credit notes subtracting. Zero-VAT rows of other classes (parking) are included.

A footer mismatch is an error shown to the user before import, not a silent warning. Checksums 2, 3 and 5 test the
class types in the chart of accounts. The types depend on the client's Rivhit settings (one client books
`רכב רשוי וביטוח` as an ordinary expense, another keeps it outside the input base), so the chart keeps a default type
per class and optional per-client types (`clientTypes: { clientId: type }`). The import wizard lists every class of
the file with this client's type, re-runs the footer checks (`recheckImport`) on every change, and saves a changed
type of a known class for this client only. When the footer does not add up under the current types, the wizard
searches the class types that make every check pass (`suggestClassTypes`, at most 16 classes, fewest changes from
the current types), preselects them, highlights the changed rows at the top and says so. A suggestion is used only
if `recheckImport` confirms it; the user can still change any type.

## Classification ledger (`כרטסת קודי מיון`)

Rivhit codes are per client (the same class has different codes at two clients), and the journal has no codes, only
names. The ledger lists every class with its code, grouped into sections (`הכנסות`, `עלות המכר`,
`הוצאות הנהלה וכלליות`, `לא משתתף`). It is loaded once per client, before the journals, into
`<client>/classification-codes.json`; the import wizard, the journal and the reports then use that chart for the client.

- Excel: a row with `קוד מס'` in column N holds the code in M, the name is in N of the next non-empty row; a section
  title is a row with that single cell.
- PDF (text positions from pdf.js): the code is the number left of the `קוד מס':` label on the same line, the name is the
  text right below the label with the same right edge, section titles are short texts at the left margin (x < 200).
- Section decides the type: `הכנסות` income, `לא משתתף` equipment, others expense. A class outside the VAT input base
  (property tax, clothing) is not visible in the ledger; its type carries over from the chart the client had before
  (by name) and can be changed in the dialog, and the journal footer checks catch the rest.
- Loading rewrites the codes of rows imported earlier from Excel (documentId `import-*`) in open declarations by class
  name, after saving a copy of each table. Locked declarations are listed and not touched.
### Checking the declarations against the ledger

The ledger lists every operation with its declaration month, line number, date, details, references and amounts; the
exported journals turned out to miss operations (7 and 4 operations at the two real clients tested; every other class total of the ledger was equal).
`ledger-rows.js` reads all operations (xlsx: columns by the header row of each block; pdf: columns by the right edge of
the text, a class that continues on the next page repeats its header). Each class block is checked against its own total
(gross, net, VAT); a file that does not add up is rejected instead of being reconciled against.

`ledger-reconcile.js` matches the operations with the rows of the declarations of the ledger's year by declaration month,
class name, date, net and gross (the ledger shows expenses negative and credits positive, the declarations the opposite;
VAT follows the sign of the net). Equal operations are counted, so two identical payments need two rows. What is left on
the ledger side is missing, what is left on the declarations' side is reported and never changed.

The dialog "בדיקה מול כרטסת…" (menu "+ הוספת מסמכים") lists the missing operations; the chosen ones are appended to the
declaration of their month (open ones only, a missing declaration is created) after saving a copy
`draft-table.before-ledger-<time>.json`; the rows read "נוסף מהכרטסת". An operation whose class has no code in the
client's chart is not added (load the ledger codes first).

## Not in the file

Supplier ID (write `0`), allocation number, image, confidence, agent opinion, raw (pre-recognition) amounts, client
name and tax ID, classification code. Amounts are already recognised: imported rows are stored as source values with
expense 100 % and VAT 100 %, and the business rules (`applyBusinessRule`, codes 806/807/812, home-utility 25 %) are
not run on them.

## Parser output (`web/excel-journal.js`)

`parseJournalGrid(rows)` returns `{ declarationMonth, rows, footer, errors, warnings }`. A row is
`{ status, vat, net, gross, reference1, reference2, details, classificationName, line, date, kind, sourceRow }` with
money as signed numbers exactly as in the file, rounded to two decimals, `date` as `YYYY-MM-DD`, `kind` one of
`income`, `expense`, `credit`, and `sourceRow` the 1-based sheet row for error messages. `errors` and `warnings` are
`{ code, message, row? | key? }`; any error means the file must not be imported. The class types used by checksum 5
(income, equipment, outside the VAT input base) come from the optional `classTypes` argument, defaulting to the
sample classes until the chart of accounts exists. Rows with a draft status add a
warning that the source transactions were not final.
