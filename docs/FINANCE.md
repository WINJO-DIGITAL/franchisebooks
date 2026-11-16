# How the numbers are worked out

Every figure in the app, the monthly reports and the exports comes from one
file, `src/lib/finance/calc.ts`. It has no database or network access and is
tested on its own, so the same inputs always give the same answer, whichever
screen you are looking at. All money is held as whole pence, so there are no
rounding drifts.

## The formulas

| Figure | How it is worked out |
| --- | --- |
| **Original earnings** (per driver, per day) | The net figure DPD gave, or if DPD gave none: gross − DPD deductions + DPD additional payments |
| **Adjusted driver pay** | Original earnings + your own pay adjustments (additions, deductions, cover payments, corrections) |
| **Operating costs** | Adjusted driver pay + fuel + other expenses |
| **Operating profit** | Verified franchise revenue − operating costs |

## Rules that protect the figures

* **DPD figures are never edited.** Anything you change is a *pay adjustment*
  with a reason, shown separately from what DPD reported. Reversing one adds
  a correcting entry; the history stays.
* **Revenue is never guessed from driver earnings.** If no revenue has been
  entered for a period, profit is shown as *unavailable*, not as a number.
* **Every figure is labelled** *confirmed* or *estimated*. Revenue you enter
  carries the label you give it.
* **Unreadable values are problems, not zeros.** If a document has a value
  that cannot be read, the document goes to the review queue; it is not
  imported with a zero in its place.
* **Cross-check.** An imported document is checked against its own totals
  line. If they disagree, its confidence drops and it goes to review.
* **Driver cover.** When one driver covers another, the original DPD figures
  stay as they are. The agreed split is recorded as two linked pay
  adjustments (extra pay for the covering driver, a deduction for the
  original), so the franchise total does not change.
* **Costs have an owner.** Each fuel or expense item is allocated to a
  driver, to the franchise, or is *unallocated* (and says so). Fuel is
  matched to a driver by vehicle registration where possible; everything else
  is manual. Re-allocating adds a new allocation; earlier ones are kept.
* **Anomalies never change a figure.** Alerts such as an unusual drop in
  parcels, a missing day or a fuel spike are only flags for you to look at.

## Dates and money

* Business dates are UK calendar days, carried as `YYYY-MM-DD`, never as
  timestamps, so a day can never shift with the server's timezone or
  daylight-saving changes.
* The evening sync time is a UK clock time (default 20:30). It follows
  GMT/BST by itself.
* Amounts you type can be written `50`, `£50.00` or `1,250.50`.
  Anything over £100,000 in one entry is refused as probably a typing slip.

## Checking a figure

1. Open the screen, find the day or driver, and open the source document
   from **Data & Integrations → Imported files** (the original is kept).
2. Compare the row with the document.
3. If they differ, it will be in the review queue or the sync log with a
   plain-English reason. Do not fix it by adjusting pay; resolve the import.
