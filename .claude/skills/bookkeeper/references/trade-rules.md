# Trade rules

Everything known so far, with its source. Tags say how far to trust a rule:

- **LAW**: the text of the law was read.
- **ANNA**: Anna said it or confirmed it.
- **SAMPLE**: seen in Anna's Rivhit files.
- **OWNER**: a product decision of the owner.
- **WEB**: a secondary source. A hint, to be checked against the law.
- **OPEN**: not settled. Do not rely on it, and do not hide it.

## The law

Sources: VAT Law, 1975, and VAT Regulations, 1976, full wikitext on he.wikisource, version of 6 July 2026, read word by word on 7 November 2026 (a copy is in
`D:\ANNATERIA-LAB\law`). Wikisource is a copy of the law, so check an official text before changing a figure in code. Figures that the law indexes each year need a fresh look.

- **The deduction itself (s. 38(a)), LAW.** A dealer deducts input VAT shown in a tax invoice issued to them lawfully, or an import declaration or other approved document,
  and the deduction must be made within six months of the day the invoice, declaration or document was issued. From issue, not from receipt.
  This is the six-month window of `month-distribution.js`; Anna confirmed it (21 Oct 2026). **A late invoice, ANNA (7 Nov 2026):** it may still be entered and deducted.
  The app marks it and never blocks it; Anna decides. Where the law allows it after six months was not found in the text read.
- **Allocation number (s. 38(a1)), LAW.** No deduction of the VAT of a tax invoice whose amount **without VAT** is above 5,000, without an allocation number. From January to May 2026 the figure was
  10,000. 2025: 20,000 (WEB). The ceiling follows the invoice's date, ANNA. A document with no VAT needs none, ANNA. Asking for the number after the invoice does not move the six months (s. 47(a2)(4)), LAW.
- **Mixed use (reg. 18), LAW.** VAT is deductible by the share of business use. Where the share is unspecified and the Director has set none: two thirds if the main use is business,
  one quarter if the main use is not. This is where 66.67% and 25% come from.
- **Buying a private car (reg. 14), LAW.** The VAT on buying or importing one is not deductible, except for a dealer in cars, and a car used only for driving lessons, rental, passenger transport
  or organised tours by someone in that trade. Running costs fall under reg. 18.
- **A dwelling (reg. 15), LAW.** No deduction of VAT on buying or building the dealer's own home, or part of it, or on services for that, even if it is also the place of business. Running costs of a home business are a different matter: reg. 18.
- **Benefit to an employee (reg. 15a), LAW.** VAT on something for an employee, owner or manager included, is deductible only if it was sold or provided to them and reported as a taxable deal.
- **Invoice not in the dealer's name (reg. 12c), LAW.** The Director may accept one for telephone, water, gas, electricity and the like when the input served the business. This is why home clients' bills in a spouse's name are normal.
- **Reporting period (s. 67(a2), reg. 20), LAW.** One month by default. Two months if turnover does not pass the ceiling: 1,500,000 as indexed to July 2015, 1,775,000 from September 2025 (the note in the law), indexed each 1 September. Measured over the 12 months ending 31 August.
  Two-month periods start in January, March, May, July, September, November. The Director may let a two-month dealer file monthly. The figure for September 2026 was not in this version: look again before relying on it.
- **Deadlines (s. 67(b), s. 67a(d)), LAW.** A periodic report within 15 days after the period; a detailed report within 23 days. The Authority publishes dates for each year. Not used in any calculation.
- **Who files the detailed report, PCN874 (s. 69a(g)), LAW.** A dealer with turnover above 500,000, or who must keep double-entry books, or whom the Director allowed on request. It is always monthly (s. 67a(a)). The app keeps it as a client setting (`pcnRequired`), so Anna decides. The figure of 2.5 million quoted on one site was wrong or old.
- **Sales in the detailed report (s. 69a(c)), LAW.** Each sales tax invoice above 5,000 without VAT is listed; the ones below go in as a total. Input documents the dealer claims are listed (s. 69a(a)(5)). Compare with `docs/PCN874_SPEC.md` in the PCN exam.
- **Bad debts (reg. 24a), LAW.** The six months there are a different rule: a credit note for a bad debt, after six months and before three years.

Income tax, WEB unless marked. Vehicle: the higher of the use value or 45% of running costs (Income Tax Regulations, Deduction of Vehicle Expenses, 1995, reg. 2; seen through a reading tool on Nevo, to be re-read). Mobile phone: about 50% with a yearly ceiling (firms disagree on the figure). Home: by the share of rooms or area, usually a quarter.
**The app does not compute income-tax shares by itself:** Anna's percent per class counts. Whether the app's expense percent for a vehicle or mobile matches her books is checked in M2 against her journals.

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
- **Mobile phone, code rule.** VAT at 66% when VAT is present: built-in codes 806, 807, 812, and a client's own vehicle, fuel, parking and mobile accounts by name. Internet at 100%.
- **Vehicle and mobile at 66%, LAW and ANNA.** Two thirds (reg. 18) taken as 66%, as in Anna's Rivhit (Anna, 7 Nov 2026; her journals agree to the agora). Parking counts as vehicle. Reg. 18 and Anna agree. The app decides by the built-in codes and, since 7 November 2026, by the
  name of the client's own account (vehicle, fuel, mobile). Check it in every exam of a client with a vehicle: it was the cause of 3 false "ready" in M4.
- **Subscriptions of foreign services, ANNA (7 Nov 2026).** Google, Apple, Zoom: advertising or upkeep, "it does not matter". Not counted as a wrong account.
- **Fixed asset or consumable, ANNA (7 Nov 2026).** A fixed asset is usually a single item of 1,000 shekels or more. Sports weights and mats bought together are
  consumables, not fixed assets.
- **Example of a fixed asset, SAMPLE (8 Nov 2026).** Client B: one shading installation for the studio, above 1,000, is a fixed asset; an
  invoice of fourteen weights and mats, none above a few hundred, is consumables though its total is above 1,000. The reader sees only the
  total, so the classification skill takes equipment only for one named item.
- **The amounts of a share, ANNA (21 Oct 2026).** Two cases. VAT only at a share (car, mobile): gross stays the total with VAT, VAT is the invoice's VAT times the percent, net is gross minus VAT. Expense and VAT both at a share (home, 25%): all three amounts take the percent. This is `recognisedAmounts`.
- **Example, code rule.** Net 100 and VAT 18, expense at 100%, VAT at 66%: gross 118.00, net 106.12, VAT 11.88. The VAT that cannot be deducted
  stays in the expense.
- **Foreign currency, ANNA (8 Nov 2026, through the owner).** Always entered in shekels at the rate of the moment of the payment
  (the transfer). This replaces "the date the invoice was received". Since 10 Nov 2026 (owner) the app converts by itself at the
  Bank of Israel representative rate ("שער יציג") of the document's date, the last published rate before a weekend or holiday
  (source: the Bank's series database EXR, RER_<CUR>_ILS, checked 10 Nov 2026). The row keeps the original amount and names the rate.
  ANNA (11 Nov 2026, through the owner): the representative rate is the right one, not the card's charge in shekels (her October
  entry of a USD subscription was the card's charge, with its fee; no day's rate gives it).
- **A loose account fit is not ready, ANNA practice.** With no account of that kind, give the near one and mark it to review.

## Reading a document

- **The supplier's number is its VAT file number, SAMPLE (8 Nov 2026).** A toll road and a mobile operator print company numbers and,
  beside them, the number of a union of dealers (or an authorised dealer number); the union's number is the VAT file. Found by the
  independent exam on D's scans: the app took a company number, three rows were ready with it. Extraction skill v4.
- **A till receipt and the tax invoice of one purchase, LAW and SAMPLE (8 Nov 2026).** A supermarket prints a "חשבונית / קבלה" with only the
  total and, on request, a tax invoice with the VAT. VAT is deducted only from a tax invoice that shows it (s. 38(a)); the receipt is the same
  purchase. Keep the tax invoice, switch the receipt off; when only the receipt exists, it is an expense with VAT 0.
- **A total that says it includes VAT, SAMPLE (8 Nov 2026).** A mobile operator's bill prints only "סה״כ כולל מע״מ". The bookkeeper deducts its
  VAT: total minus total/1.18, then two thirds (client B's own months). A receipt that says nothing of VAT (a foreign service: Apple, Google,
  Zoom) has VAT 0. Extraction skill v6.
- **A bill and its payment confirmation, SAMPLE (8 Nov 2026).** A water bill and the confirmation of its card payment, a property-tax voucher
  and the municipal portal's confirmation: one expense. Keep the bill, switch the confirmation off. Since 9 Nov 2026 the code does it
  (`secondPaper` in `web/intake-facts.js`: same supplier and amount within 21 days; a receipt with VAT 0 against its tax invoice on the same day).
- **An insurer's letters of one policy, SAMPLE (8 Nov 2026).** The same policy number with another year in front (25/... and 26/...) is another
  year's policy; a renewal letter of the current year repeats the confirmation. Only the current year's counts once; last year's copy is off
  (the code: a payment confirmation dated in a previous year is previous-year, 9 Nov 2026).
- **A document the client issued itself** is income. Supplier number equals the client's, usually with no buyer number.
- **Dates** are day, month, year. A blurred year is often misread: a "previous year" on a bad photo should be doubted.
- **The shekel sign** is not a digit. A number printed after it keeps its first digit.
- **"Liable at 18%: 194.28"** means net 194.28. Never divide it by 1.18. Total VAT in a report is the sum of documents' VAT, not 18% of net.
- **Mixed invoice.** Separate rows only when its VAT summary prints separate groups. Exempt groups have gross equal to net and no VAT.
- **Credit notes** carry negative net and VAT, income credits too (fixed 30 Oct 2026). Expenses credits reduce input VAT.
- **A printed list of booked documents** is not one document. Every line with its own date and amounts is its own row; headings, balances
  and totals are not. Photographed ledgers happen. In such a list a line's amounts already include any recognised share.
- **Pages without amounts** (advertising, a tear-off slip repeating the total) are no documents. This is a known weak spot from `ocr`.

- **What Anna corrected in client B's 9-10/2026, SAMPLE (10 Nov 2026).** Her own copy, compared row by row with the agent's run:
  a course to the training account ("השתלמויות", Rivhit 814) and an instructor's sports shoes to work clothes (810), even when the
  client's own chart lacks them; software subscriptions (Apple, Google, Zoom, morning) to office (202); a person's driving licence
  renewal off (classification v9); the water bill with its VAT (extraction v6 reads it now); Zoom in USD typed in shekels by her;
  two small shop receipts turned off (private?, asked); the extra pages of a bill that hold no document left off.

## Months and periods

- **A bad photo, OWNER (9 Nov 2026).** What the reading cannot see stays empty, never a guess; the row asks for a retake and is never ready.
  A cropped receipt whose total is cut off was given an invented total by the model in the lab. The row's "צילום חדש" takes a better photo.
- **The open month decides, OWNER (1 Nov 2026).** Every document in a month's inbox becomes a row of that month. Doubts become marks.
- **A closed month is filed and paid, OWNER (6 Nov 2026).** It takes nothing. Two exceptions, each after a question: Rivhit's own files go to their own month,
  and VAT moved to a future month.
- **Which month a document belongs to, ANNA (21 Oct 2026).** A yearly insurance: the month it was received. Electricity, telephone, water: the date of the invoice. A water bill that becomes a tax invoice only on payment: entered when received, and its six months run from the date of the invoice, standing order or not (7 Nov 2026). The agent does not move documents; these say what to mark when the open month differs.
- **Dated after the month.** Written and marked: its VAT cannot be deducted before its date.
- **Dated before the month.** Written and marked: that month is filed. **Earlier year:** excluded softly, the row stays.
- **The VAT month of a later paper, SAMPLE (10 Nov 2026).** Anna moves the VAT of a paper dated in a later month to that month with the
  "חודש מע״מ" column: October papers scanned into September, and November papers into October. She did it for some and not for others
  of the same kind (asked). The column stays the user's (AGENTS.md); the app only marks such rows.
- **Two-monthly client, SAMPLE (8 Nov 2026).** Papers of the second month of the period scanned with the first are in the same VAT report; they
  must not be entered again in the second month (the code finds such a copy in the earlier month since 8 Nov). Papers of the next period
  (November for a 9-10 filer) are marked "after the month" and wait for that period. Papers of the filed period (August) are late: Anna may
  still deduct them (her answer of 7 Nov).
- **Declared together, SAMPLE.** A low-volume month may have no file of its own: one client's March is in journal 4, July in journal 8, so
  its VAT period 7 to 8 comes from declaration 08. This is normal; there is nothing to ask for.
- **VAT and advance periods are separate client settings, SAMPLE.** Pairs are 1-2, 3-4, up to 11-12.
- **Duplicates** are checked from the document's own month onwards, closed months included.

## Rivhit and reports

- **Codes belong to the client, SAMPLE.** The same class has different codes at different clients. The client's own chart first, always.
- **A journal never misses what the ledger has, ANNA (7 Nov 2026).** "There is no such thing; if there is, it is a discrepancy or a mistake." The ledger check
  still adds them so that the reports equal Rivhit, but each such row is a discrepancy to show Anna, never ready (seen: 4 operations at A, 7 at B).
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

- How should a moved sale appear in PCN874 (owner left it for later on 6 November 2026)?
- Should the allocation check count sales rows? The code does, as `ocr` did; Rivhit's sale line carries no allocation number.
