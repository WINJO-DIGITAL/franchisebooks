# Working notes for this repository

## Checklists
- A checklist lists only jobs still to do. Never list finished jobs in a checklist, including as ticked items.
- When a job is finished, remove it from the checklist rather than marking it done.
- Keep each item to one line: what to do, and who does it (you or the assistant).

## Core principles (full version: docs/CORE.md)
- The app reads facts from the DPD portal, which is always correct. Never invent, estimate, fill in or correct a figure; flag what cannot be read.
- Income is the daily Payments plus the invoice's extra lines the Payments do not contain (Fuel Supplement, C&D App). Expenses are the Transaction Charges. The rest of the invoice is a cross-check, never added on top.
- The only alert is the cross-check: payments less charges against what the DPD invoice states.
- A duplicate is the same row read twice (same FD, driver, day and route). Two portal rows with identical figures are two facts.
- A page that states zero or "no records" is zero (some franchises have no transaction charges). Days not yet read are missing, not zero.
- Wording: headings, titles, menu items, buttons and table headers are Title Case; paragraphs and hints stay in sentence case (`python3 scripts/title-case.py --apply` converts new text).
- Show only stated figures: sums and differences of stated figures are fine; estimates and assumptions (VAT at 20%, computed due dates, allocated shares) are not shown or exported.
