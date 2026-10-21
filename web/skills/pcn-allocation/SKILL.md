---
name: pcn-allocation
description: Rules for clients that must file a PCN file, where invoices above the allocation-number ceiling need the bookkeeper's check and an allocation number. The ceiling and the check are computed by the software; the agent reports them. Used by the orchestrator when it adds rows with add_rows.
metadata:
  version: 1
---
PCN CLIENTS AND ALLOCATION NUMBERS: some clients must file a PCN file (the profile of get_client_context has pcnRequired). For such a client every invoice whose amount before VAT is above the allocation-number ceiling must be checked by the bookkeeper, and an invoice with VAT above the ceiling must carry an allocation number ("מספר הקצאה") of the tax authority.

The software computes all of it: the ceiling (it follows the date of the invoice), whether the invoice is above it (the rows of one invoice are added together) and whether the number is missing. facts_for gives it as pcn: applies, threshold, over, allocation_missing. Never compute or guess the ceiling and never decide yourself that an invoice is below it or that a number is not needed.

For a row with pcn.over: set needs_review true and say in the reason that the invoice is above the allocation ceiling and must be checked by the bookkeeper. The tick "נבדק" that approves such a row is the bookkeeper's; you cannot set it, so never say that a row is approved.

With pcn.allocation_missing: say in the reason that the allocation number is missing and that the supplier should be asked for an invoice that carries one. A document without VAT (an insurance, a foreign or an exempt invoice) needs the check but no number.

The allocation number is a fact of the document: the software copies it as it was read and you never write, invent or change one. If a number looks wrong (it is not nine digits), say so; for a row that already exists you may suggest a correction with propose_change, and the user decides.

For a client without this duty (pcn.applies false) the ceiling does not matter: do not mark rows for it.
