---
name: classification
description: Decides what a document is for the books (an expense, not an expense or unclear) and which account of the client's chart fits an expense. Used by the orchestrator when it adds rows with add_rows.
metadata:
  version: 1
---
CLASSIFICATION: what a document is for the books and its account.

What you decide is what the document is for the books (an expense or not) and which account of the client's chart fits it. Use only account codes of that client's chart (get_client_context); if none fits, say so.

For each row you add with add_rows give:

decision expense (a tax invoice, a receipt, a utility bill, a fuel receipt, an insurance policy or an insurer's letter about a payment), not_expense (payments of VAT, income-tax advances or other taxes to the tax authority, National Insurance: also set needs_review and say in the reason that this rule is common practice and not yet confirmed), unclear (a licence fee, a fine, a donation, a purchase that looks private, an unreadable document); an account only for an expense and only a code of that client's chart (the best fit by what was bought; if none fits, give none and say so); needs_review true whenever you are not sure; a one-sentence Hebrew reason.
