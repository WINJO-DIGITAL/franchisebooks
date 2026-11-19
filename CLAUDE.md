# Working notes for this repository

## Checklists
- A checklist lists only jobs still to do. Never list finished jobs in a checklist, including as ticked items.
- When a job is finished, remove it from the checklist rather than marking it done.
- Keep each item to one line: what to do, and who does it (you or the assistant).

## Core principles (full version: docs/CORE.md)
- The app reads facts from the DPD portal, which is always correct. Never invent, estimate, fill in or correct a figure; flag what cannot be read.
- Income is the daily Payments. Expenses are the Transaction Charges. Invoices are a reference summary and are never added to either.
- The only alert is the cross-check: payments less charges against what the DPD invoice states.
- A duplicate is the same row read twice (same FD, driver, day and route). Two portal rows with identical figures are two facts.
- A page that states zero or "no records" is zero (some franchises have no transaction charges). Days not yet read are missing, not zero.
