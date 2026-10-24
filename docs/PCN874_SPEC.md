# The PCN874 file

The detailed VAT report of a client with the PCN duty (`pcnRequired`): a text file the bookkeeper uploads on the Tax
Authority's site. The app only writes it (`web/pcn874.js`, pure); it never sends it. Step 6.4 of `WORK_PLAN.md`.

## Sources (read 24 October 2026)

- The layout: "Appendix A" of the Tax Authority's notice to software houses, `IncomeTax_IncomeTaxSoftwareHousesInfo_874-eng.pdf`
  (gov.il, `BlobFolder/generalpage/tax-vat-online-invoice-reporting/en/`, created 2010). Appendix C lists which fields each kind
  of record fills.
- The last nine digits of a record hold the allocation number ("Israel invoice" guidance of 2024, gov.il
  `BlobFolder/generalpage/hor-software-other/he/vat_software-houses-180724.pdf`, as quoted by a search; the document itself was
  not read in full).
- Two files of Rivhit given by Anna on 24 October 2026 (one client that reports every month, one every two months; real data,
  kept on the owner's PC only, never in the repository). The code was compared with them; see "Checked against Rivhit".

## Layout

Fixed widths. Numbers are right-aligned with zeros in front; a sign field is `+` or `-` (`+` for zero). ASCII, one record per
line, lines end with CRLF, the last line too. Rivhit names the file `PCN874_<dealer number>_<yyyymm>.txt`.

**Opening record** (131 characters):

| Field | Width | Value |
| --- | --- | --- |
| Record type | 1 | `O` |
| Dealer number of the client | 9 | |
| Month of the report | 6 | `yyyymm`; for a two-month period its last month (Anna's sample) |
| Report type | 1 | `1` |
| Creation date | 8 | `yyyymmdd` |
| Taxable sales without VAT | 1 + 11 | sign and amount |
| VAT on taxable sales | 1 + 9 | |
| Sales at another rate | 1 + 11 | `+` and zeros |
| VAT on sales at another rate | 1 + 9 | `+` and zeros |
| Number of sales records | 9 | `S` and `L` lines |
| Exempt and zero-rate sales | 1 + 11 | |
| VAT on other inputs | 1 + 9 | |
| VAT on equipment inputs | 1 + 9 | |
| Number of input records | 9 | `T` lines |
| VAT to pay (`+`) or to refund (`-`) | 1 + 11 | |

**Document record** (60 characters):

| Field | Width | Value |
| --- | --- | --- |
| Kind | 1 | `S` sale to an identified customer, `L` sales to unidentified customers (aggregated), `T` input from an Israeli supplier; the layout also has `M`, `Y`, `I`, `K`, `R`, `P`, `H`, `C`, which Anna's clients do not use |
| Dealer number of the other side | 9 | the customer of `S`, the supplier of `T`, zeros for `L` |
| Document date | 8 | `yyyymmdd` |
| Reference group | 4 | `0000` |
| Document number | 9 | its last nine digits |
| VAT | 9 | the VAT of the document, or the part that may be deducted (2/3, 1/4): rounded to the shekel, positive |
| Sign | 1 | `-` for a credit note |
| Amount without VAT | 10 | always 100 %, rounded to the shekel, positive |
| Allocation number | 9 | its last nine digits, zeros when there is none |

**Closing record** (10 characters): `X` and the dealer number of the client.

## From the rows of the app

The rows are the active rows of the declarations of the period (by declaration month, like the VAT report; a document date may
lie outside the period). The kind of a row comes from the chart of accounts, as in `reportEntries` (`web/reports.js`).

- **Purchases.** An `expense` or `equipment` row with VAT is a `T` line: column 4 (supplier number), the date, the document
  number (`reference`, else column 5), the recognised VAT (column 9), the source net (`rawNet`), the allocation number
  (column 6). A row without VAT, and a row of a class outside the input base (`outsideVatBase`), is not in the file: its VAT is
  not deducted.
- **Sales.** An `income` row with a customer number in column 4 is an `S` line. The other sales rows become one `L` line for the
  taxable ones and one for those without VAT: a single row keeps its date and number; several rows get the last day of the
  period and the number of the last document (by date, then by place in the table) (Anna, 24 October 2026). The VAT and the
  net of an `L` line are the rounded sums of its rows.
- **Totals** of the opening record are the figures of `vatReport` (the same function as the VAT slip): taxable sales, VAT on
  sales, exempt sales, input VAT, equipment VAT, the amount to pay. Each line is rounded on its own, so the lines may add up to a
  shekel more or less than the totals; Rivhit does the same (one shekel apart in Anna's second sample).
- **Order:** `S` lines, then `T` lines, then `L` lines, each in the order of the declarations and their rows. Rivhit's order of
  the `T` lines follows neither the date nor the table; the order is not part of the layout.

## Refusals and warnings

The file is not written while any refusal is left; warnings are shown only.

| Code | Refusal |
| --- | --- |
| `no_vat_id` | the client card has no nine-digit dealer number |
| `month_open` | a declaration of the period is not closed |
| `pcn_blocked` | rows over the allocation ceiling not approved or without an allocation number (the rule of the lock button; it also counts sales rows, as in ocr: kept by the owner on 24 October 2026, although Rivhit's `S` line carries no allocation number) |
| `no_supplier` | a purchase row with VAT and no supplier number |
| `bad_date` | a row of the file without a readable date |
| `no_reference` | a row of the file without a document number |
| `too_long` | an amount that does not fit its field |

| Code | Warning |
| --- | --- |
| `bad_check_digit` | a dealer number of the other side whose check digit is wrong (the layout asks to allow it) |

## Checked against Rivhit

24 October 2026, rows rebuilt by hand from Anna's two samples (a throw-away script on the owner's PC; the purchases from the
file's lines, the cents from the journals where they show them and plausible cents elsewhere):

- The monthly sample: the opening, document and closing records are equal to Rivhit's.
- The two-month sample: equal. The opening record has the input VAT one shekel below the sum of the lines;
  the `S` line, the seven `T` lines and the closing record are equal. The `L` line differed only in its document number in the
  rebuilt rows (the October sale is not in the journals given): Rivhit wrote `4`; Anna confirmed that 4 is the number of the last small sale of the period, so the rule gives the same line.

## On the reports page (step 6.4.3)

The kind "קובץ PCN874" of the reports page is offered only for a client with the PCN duty. Its default period is the VAT period.
The page shows the refusals, the warnings, the totals of the opening record and the lines; "שמירת קובץ PCN874" writes the file
into the client's `reports/` folder under Rivhit's name, "שמירה בשם…" lets the user choose a place. Both build the file again at
the click and refuse while the list has a refusal. The file is not part of "save all".
