# Core principles

What Franchise Books is for, and the rules every change must keep. If a change breaks one of these, the change is wrong.

## What it is for

A DPD franchisee reads their own portal figures nightly, so they can **invoice their drivers at the end of the month without doing it by hand**: each driver's income, what it cost, and what is left, per day and per month. Further services build on that, but this is the core.

## The rules

1. **Facts only.** Everything on the DPD portal is correct. The app scans what the portal states and reports exactly that. It never makes up, estimates, fills in or "corrects" a figure. If a document cannot be read, or a printed figure does not add up, it is flagged for a person. Nothing is substituted.
2. **Income is the daily Payments. Expenses are the Transaction Charges.** Nothing else is income or expense.
3. **Invoices are a reference, never income.** A DPD invoice is a summary of the payments and the charges. It is scanned and kept so our figures can be cross-checked against DPD's. It is never added to the payments or the charges, because that would count the same money twice.
4. **The only alert is the cross-check.** Do the payments we read, less the charges, agree with what the DPD invoice states for the period? If yes, nothing to report. Duplicate drivers, unregistered names and similar are not alerts.
5. **A duplicate is the same row read twice.** Same franchise (FD), driver, day and route. Two rows on the portal are two facts even if their figures are identical: a franchise often runs more than one route on the same day. Partial matches are shown to a person; the app does not decide.
6. **No data is not zero, and a stated zero is zero.** Days we have not read are missing, not "£0 earned", so nothing is compared with them. A page that says zero or "no records" is zero: some franchises carry no transaction charges because other accounts cover their running costs (for example FD78797).
7. **Show only what is stated.** A figure goes on a page or an export only if the portal or the invoice states it. Adding up or subtracting stated figures is fine (a total, a difference). Anything that has to be estimated or worked out with an assumption (VAT at a standard rate, a computed due date, an allocated share) is not shown. The Period Check page shows the charges excluding VAT as the portal states them, and the invoice's own printed total, VAT and due date.
8. **Money out is what the portal says it is.** Charges are the portal's charges, excluding VAT as stated. Credit notes are franchise income, never driver pay.

## Why

An accountant or a driver must be able to put the app's figures next to the portal and find they are the same figures. Anything the app adds, removes or merges on its own breaks that.

## Wording style

Headings, page and section titles, menu items, buttons and table headers use **Title Case** ("Data & Integrations", "Add Franchise", "Daily Payments"). Small words (a, an, the, and, of, to, in, on, for) stay lower case unless first or last; acronyms and codes (DPD, FD42102, PDF) keep their capitals. Paragraphs, hints and form field labels stay in normal sentence case. To apply this to new text, run `python3 scripts/title-case.py --apply`.
