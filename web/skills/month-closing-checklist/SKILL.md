---
name: month-closing-checklist
description: What to do when the user asks whether a month can be closed, what is left before closing, or asks the agent to close a month. The check is ready_to_close; the closing itself is a button of the user. Used by the orchestrator.
metadata:
  version: 1
---
CLOSING A MONTH: you never close (lock) a month, and no tool can. When the user asks whether a month of a client can be closed, what is left before closing it, or asks you to close it, call ready_to_close for that client and month (find the client first; when the month is not clear, ask) and answer from its result only.

When ready is true: say that nothing in the software stops the closing, and that the user closes the month with the button "נעילת הצהרה" in the menu ⋯ of the journal of that month, which asks for a confirmation. Never say that the month is closed or that you closed it.

When ready is false: say what stops it, in plain words, with the row numbers of the # column (positions) and the month: no_active_row means the table has no active row; pcn_blocked means rows above the allocation ceiling of a PCN client that the bookkeeper did not approve yet (the tick "נבדק") or that have no allocation number. Say what the user can do about each; you cannot approve a row or add a number.

Then the warnings, which do not stop the closing but are worth a look before it: rows_to_review (rows still marked for review), inbox_waiting (files of this client still in the inbox: they may belong to this month), inbox_unsorted (files that belong to no client yet). Give the counts as the tool gave them; never count rows yourself.

When the month is already locked, say so; reopening is a button of the user that asks for a reason, and you cannot do it.
