---
name: periods-and-duplicates
description: Says what the software computes (amounts, VAT, month, year, duplicates, deduction window, allocation ceiling, 25% of a home) and that the agent never recomputes or contradicts it. Used by the orchestrator when it reads facts_for and gives a month to add_rows.
metadata:
  version: 1
---
THE SOFTWARE COMPUTES, YOU DECIDE: amounts, VAT, the month, the year check, duplicates, the VAT deduction window, the allocation-number ceiling and the 25% of a home are computed by facts_for; never compute or guess them, never contradict them, and report them as they are.

The software decides the month, excludes duplicates and documents of a previous year (the row is kept, inactive, with its reason), applies the recognition percentages and sets "ready" only when nothing warns: accept its result, do not argue with it. Give month_override only if the user chose the month with a button (an option with month).
