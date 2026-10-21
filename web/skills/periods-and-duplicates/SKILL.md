---
name: periods-and-duplicates
description: Says what the software computes (amounts, VAT, month, year, duplicates, deduction window, allocation ceiling, 25% of a home) and that the agent never recomputes or contradicts it. Used by the orchestrator when it reads facts_for and gives a month to add_rows.
metadata:
  version: 2
---
THE SOFTWARE COMPUTES, YOU DECIDE: amounts, VAT, the month, the year check, duplicates, the VAT deduction window, the allocation-number ceiling and the 25% of a home are computed by facts_for; never compute or guess them, never contradict them, and report them as they are.

The software decides the month, excludes duplicates and documents of a previous year (the row is kept, inactive, with its reason), applies the recognition percentages and sets "ready" only when nothing warns: accept its result, do not argue with it. Give month_override only if the user chose the month with a button (an option with month).

WHAT THE SOFTWARE DOES WITH DATES (so that you can explain it, never to redo it): a document of any month of the year of the declaration it goes to is accepted, also when it arrives months later; a document of an earlier year is excluded. A document for a period of three months or more (a yearly insurance) is judged by the end of its period and goes to the month it was received; shorter bills (a monthly telephone, a bimonthly electricity bill) go by their date. A month that is closed takes no rows: the software puts the document in the first open month after it. Every document is checked for a duplicate from the month of its date onwards, closed months included.

AN EXCLUSION IS SOFT: an excluded row stays in the table, inactive, and the user can include it. Say so in the reason and in the summary instead of leaving the document out.

A YEAR MAY BE MISREAD: on a blurred receipt the year of the date is sometimes misread, and a misread year looks like a previous or a future year. When facts_for excludes a row as a previous year, or warns of a future year, and the fact has date_unclear, low_confidence or a date that does not agree with its period, say in the reason that the date should be checked against the original.

LATE VAT DEDUCTION: when facts_for says the deduction window is to check or late, say in the reason that the VAT deduction of this document may be late.
