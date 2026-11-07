# Trade rules

Everything known so far, with its source. Tags say how far to trust a rule:

- **LAW**: the text of the law was read.
- **ANNA**: Anna said it or confirmed it.
- **SAMPLE**: seen in Anna's Rivhit files.
- **OWNER**: a product decision of the owner.
- **WEB**: a secondary source. A hint, to be checked against the law.
- **OPEN**: not settled. Do not rely on it, and do not hide it.

## The law

Source for this section: VAT Regulations, 1976, on he.wikisource, version of 6 July 2026, read 7 November 2026. Wikisource
is a copy, so check against an official text before changing a figure. The reading was through a summary tool: re-read the
exact wording of any regulation before you build on it.

- **Mixed use (reg. 18), LAW.** Input VAT follows the share of business use. Where no share was set: two thirds when
  business use is the main use, one quarter when private use is the main use. This is where 66.67% and 25% come from.
- **Buying a private car (reg. 14), LAW.** VAT on buying or importing one is not deductible, except for vehicle dealers,
  driving schools, car rental, passenger transport and organised tours. Running costs fall under mixed use (WEB, a CPA firm).
- **Reporting period (reg. 20), LAW.** One month by default. Two months for a dealer with turnover up to a threshold, measured
  over the 12 months ending 31 August. The page gives 1,775,000 from January 2026; a secondary guide says 1,725,000. OPEN.
- **Invoice not in the dealer's name (reg. 12c), LAW.** For telephone, water, gas, electricity and the like, the Director may
  accept it when the input served the business. It explains home clients' bills in another name.
- **A dwelling (reg. 15), OPEN.** Limits deduction on buying or building a home. The summary of the wording was unclear: read it.
- **The six-month window, OPEN.** The code flags late deduction after six months (`month-distribution.js`), from non-official
  sources. It is not in regulations 14 to 23; reg. 24a speaks of six months only for bad debts. Find it, probably in the VAT Law
  itself, and confirm the exact rule and how it can be extended.
- **Allocation-number ceiling, WEB.** For the deduction: 20,000 in 2025, 10,000 from 1 January 2026, 5,000 from 1 June 2026, before
  VAT. Several secondary sources agree, and `pcn-review.js` has the same table. Read the Tax Authority's directive.
- **Deadlines, WEB.** VAT and advances by the 15th; online by the 19th; the detailed file by the 23rd. One vendor gives another
  date. Not used in any calculation.
- **Who must file PCN874, WEB, conflicting.** A turnover test of 2.5 million is quoted by one site only. The app keeps it as a
  client setting (`pcnRequired`), so Anna decides.

## What counts, and how much

- **Not an expense, ANNA (21 Oct 2026).** Payments of VAT, income-tax advances and other taxes; National Insurance; fines; donations.
  Such a row stays in the table, inactive, so the document is kept.
- **Licence fee of a vehicle, ANNA.** An expense on the vehicle account.
- **An insurer's letter about a payment or renewal, ANNA.** An expense, although it is no invoice. Judge by what the document is,
  not by its kind. The whole period's amount counts, not one instalment.
- **Internet and software, ANNA.** Their own account when the client has one; otherwise maintenance. Internet itself is at 100%.
- **Home business, ANNA (12 Oct 2026).** Electricity, water, sewage and property tax are recognised at 25%, expense and VAT alike. Decide by
  what the document is. Never by the supplier's name: a shop with "electricity" in its name sells goods.
- **Amounts already booked, OWNER (30 Oct 2026).** Rows imported from Rivhit, and percentages set by hand, are never cut again.
  Anna's journal already holds the 25% share.
- **Mobile phone, code rule.** VAT at 66.67% when VAT is present, for built-in codes 806, 807, 812. Internet code 888 at 100%.
- **Vehicle at 66.67%, OPEN since 21 October.** It works only for built-in codes; real client charts miss it. Expect a wrong VAT
  figure until this is fixed, and check it in every exam of a client with a vehicle.
- **Example, code rule.** Net 100 and VAT 18, expense at 100%, VAT at 66.67%: gross 118, net 106, VAT 12. The VAT that cannot be deducted
  stays in the expense.
- **Foreign currency, ANNA.** Entered in shekels at the rate of the date the invoice was received. The app does not convert yet,
  so the row goes to review.
- **A loose account fit is not ready, ANNA practice.** With no account of that kind, give the near one and mark it to review.

## Reading a document

- **A document the client issued itself** is income. Supplier number equals the client's, usually with no buyer number.
- **Dates** are day, month, year. A blurred year is often misread: a "previous year" on a bad photo should be doubted.
- **The shekel sign** is not a digit. A number printed after it keeps its first digit.
- **"Liable at 18%: 194.28"** means net 194.28. Never divide it by 1.18. Total VAT in a report is the sum of documents' VAT, not 18% of net.
- **Mixed invoice.** Separate rows only when its VAT summary prints separate groups. Exempt groups have gross equal to net and no VAT.
- **Credit notes** carry negative net and VAT, income credits too (fixed 30 Oct 2026). Expenses credits reduce input VAT.
- **A printed list of booked documents** is not one document. Every line with its own date and amounts is its own row; headings, balances
  and totals are not. Photographed ledgers happen. In such a list a line's amounts already include any recognised share.
- **Pages without amounts** (advertising, a tear-off slip repeating the total) are no documents. This is a known weak spot from `ocr`.

## Months and periods

- **The open month decides, OWNER (1 Nov 2026).** Every document in a month's inbox becomes a row of that month. Doubts become marks.
- **A closed month is filed and paid, OWNER (6 Nov 2026).** It takes nothing. Two exceptions, each after a question: Rivhit's own files go to their own month,
  and VAT moved to a future month.
- **Dated after the month.** Written and marked: its VAT cannot be deducted before its date.
- **Dated before the month.** Written and marked: that month is filed. **Earlier year:** excluded softly, the row stays.
- **Declared together, SAMPLE.** A low-volume month may have no file of its own: one client's March is in journal 4, July in journal 8, so
  its VAT period 7 to 8 comes from declaration 08. This is normal; there is nothing to ask for.
- **VAT and advance periods are separate client settings, SAMPLE.** Pairs are 1-2, 3-4, up to 11-12.
- **Duplicates** are checked from the document's own month onwards, closed months included.

## Rivhit and reports

- **Codes belong to the client, SAMPLE.** The same class has different codes at different clients. The client's own chart first, always.
- **A journal can miss what the ledger has, SAMPLE.** 7 and 4 operations at two clients; cause unknown (standing orders are a guess). The ledger is complete, so
  it is checked against the months and the missing rows are added.
- **The inputs line, SAMPLE.** Rivhit's month total is the plain sum of the VAT column, while the inputs line leaves out classes outside the input base (clothing,
  property tax). Do not expect the two to match.
- **Equipment VAT** has its own line and is outside the profit and loss.
- **Rounding, SAMPLE.** VAT payable is the difference of the rounded lines; profit and loss is rounded once from exact sums. A one-shekel difference against another source
  is not a bug. Say which line and why.
- **PCN874 rules** are in `docs/PCN874_SPEC.md`, checked against two of Anna's samples. **Report formulas** are in `docs/REPORTS_SPEC.md`.
- **The documents report is used by Anna** (restored 25 Oct 2026 after being deleted as unused). Every active row needs its original there, Excel and HEIC too.

## A new client, in order (SAMPLE, from the dry run of October 2026)

1. Create the client and set the VAT and advance periods.
2. Load the ledger codes.
3. Import the journals month by month.
4. Check against the ledger.
5. Compare the VAT and profit and loss reports with the bookkeeper's.
6. Only then close the months.

## Questions for Anna, when nothing else settles them

- Why do journals miss operations the ledger has?
- How should a moved sale appear in PCN874 (owner left it for later on 6 November 2026)?
- Should the allocation check count sales rows? The code does, as `ocr` did; Rivhit's sale line carries no allocation number.
