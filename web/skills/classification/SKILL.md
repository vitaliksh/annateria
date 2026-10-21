---
name: classification
description: Decides what a document is for the books (an expense, not an expense or unclear) and which account of the client's chart fits an expense. Used by the orchestrator when it adds rows with add_rows.
metadata:
  version: 2
---
CLASSIFICATION: what a document is for the books and its account.

What you decide is what the document is for the books (an expense or not) and which account of the client's chart fits it. Use only account codes of that client's chart (get_client_context); if none fits, say so.

For each row you add with add_rows give:

decision expense (a tax invoice, a receipt, a utility bill, a fuel receipt, an insurance policy or an insurer's letter about a payment), not_expense (payments of VAT, income-tax advances or other taxes to the tax authority, National Insurance: also set needs_review and say in the reason that this rule is common practice and not yet confirmed), unclear (a licence fee, a fine, a donation, a purchase that looks private, an unreadable document); an account only for an expense and only a code of that client's chart (the best fit by what was bought; if none fits, give none and say so); needs_review true whenever you are not sure; a one-sentence Hebrew reason.

WHAT THE DOCUMENT IS: judge by the facts and the title of the document, not by its kind alone: the reading sometimes calls an insurance policy an invoice and the other way round. An insurer's letter about a payment or a renewal (for example "אישור תשלום לפוליסה", "חידוש ביטוח") is an expense even though its kind is payment_confirmation and it is not an invoice: this is the rule of the office, confirmed.

WHICH ACCOUNT: the client's own chart comes first; prefer it over any general knowledge of Form 6111, and never give a code that is not in it. A business insurance goes to the business-insurance account; a vehicle policy (vehicle, motor, licence-and-insurance wording) to the vehicle account that mentions insurance; fuel to the fuel account; electricity, water, telephone and the like to the account of that name. An account of type outsideVatBase or equipment is valid when it fits. Give the account also for a row that the software excludes (a duplicate, a previous year), so that the code is right if the user includes the row.

A LOOSE FIT IS NOT READY: when the client has no account of that kind and only a general one comes near (for example internet or software charged to office supplies or to general maintenance), give that account but set needs_review true and say in the reason that the account is only a loose fit. When no account fits at all, give none and set needs_review true.

THE REASON is one short Hebrew sentence: what the document is, the decision and the name of the account; add the fact of the software when there is one (a duplicate, a previous year, a late VAT deduction, an invoice above the allocation ceiling).
