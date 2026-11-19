# Financial rules

All figures shown anywhere in the app (dashboard, driver pages, reports, exports) come from one module, `src/lib/finance/calc.ts`. It is pure code (no database, no network) and is tested on its own in `tests/unit/finance.test.ts`, including reconciliation tests that must hold for any data.

## Principles

1. **Money is whole pence.** In code, amounts are integers of pence; in the database they are `numeric(12,2)`. Nothing is added, subtracted or compared as floating-point pounds.
2. **Imported DPD figures never change.** `daily_earnings` is read-only after import (enforced by a database trigger, even for the service role). A later document that disagrees does not overwrite: it goes to *Needs attention*, and if the owner accepts it the old row is kept, marked as replaced.
3. **Corrections are new entries.** Pay adjustments are an append-only ledger. Reversal = a new, equal-and-opposite entry. Costs and revenue are *voided*, never deleted.
4. **Estimated ≠ confirmed ≠ unavailable.** Every revenue and profit figure carries one of those three labels.
5. **Revenue is never inferred from driver earnings.** If no revenue has been entered for the period, profit is "not available", not a guess.

## Formulas

| Figure | Formula |
| --- | --- |
| Original earnings (one report row) | the *net* DPD supplied; otherwise `gross − DPD deductions + DPD additional payments` |
| Adjusted driver pay | `original earnings + additional payments − deductions` where those are the *manual* adjustments (cover allocations are adjustments too). A reversed entry and its reversal cancel and count in neither total |
| Driver costs (franchise) | `Σ adjusted driver pay` |
| Fuel | fuel-card transactions + any expense in a fuel-kind category |
| Other expenses | every other expense |
| Operating costs | `driver costs + fuel + other expenses` |
| Operating profit | `verified franchise revenue − operating costs` |
| Margin | `operating profit ÷ revenue`, one decimal place |
| Driver contribution | `allocated revenue − adjusted pay − fuel − other expenses` (only when a revenue-sharing basis is configured; always labelled *estimated*) |

## Avoiding double counting

* Every cost is counted **once, in exactly one bucket**: attributed to a driver, to the franchise in general, or unallocated. (`finance.test.ts` → "counts every cost exactly once".)
* Costs with no reliable match stay **unallocated**. Vehicle-registration matching only attributes a cost when exactly one driver had that vehicle that day. The owner can assign or re-assign; earlier assignments are kept.
* Driver cover moves *pay* between drivers with two linked adjustments that sum to the same total, so franchise driver costs are unchanged. The owner chooses whether that day's fuel/expenses stay with the original driver, follow the covering driver, or go to the franchise. Cancelling the cover reverses its adjustments.
* Combined (all-franchise) profit is only shown when every franchise with costs has revenue entered; otherwise it would silently understate revenue.

## VAT

The business is VAT registered, so every figure in the app is **net of VAT**: VAT charged to DPD on income, and VAT paid on costs, are neither income nor cost.

* **Income:** the DPD Payments figures are net. DPD's self-billed invoice adds 20% VAT on top. Checked on the FD42102 invoice for 12/10/2026 to 08/11/2026: net £7,303.36, VAT £1,460.67, total £8,764.03.
* **Charges:** DPD's Transaction Charges are imported excluding VAT (the portal shows "£11.47 (excl. £2.29 VAT)").
* **How to read a DPD self-billed invoice:** every line amount and "Total exc VAT" are **excluding VAT**. VAT (20%) is shown separately in the VAT analysis, and "Invoice total" is net plus VAT. The VAT shown is the business's output tax due to HMRC. Each invoice names its period ("for period 12/10/2026 to 08/11/2026"), the FD number, an invoice date and a due date.
* **Invoice dates:** the invoice is dated on the last day of the four-week period and falls due five days later (six invoices checked, all the same). The invoice date is the last day of the billing period ("for period 12/10/2026 to 08/11/2026"); the next period starts the day after. Drivers need to know what they earned as soon as the period closes, so the automatic period report is made the evening after its last day (once the nightly sync has brought in that day), not on the due date. Change `REPORT_DELAY_DAYS_AFTER_PERIOD_END` in `src/lib/finance/periods.ts` if that needs to move.
* **Not yet in income:** the invoice also carries a *Fuel Supplement* (£71.27 that period) and a *C&D App* line (£9.23). They are not in the daily Payments rows, so income is a little under the invoice net. Everything else on the invoice ties to the daily figures exactly: weekday, Saturday and Sunday stops and pay, and excess parcels.
* **Same-day entries:** DPD can list two entries for one driver, route and day (for example a second run). They are added together, since the ledger holds one row per driver, route and day. A row that repeats with identical figures is treated as a likely double-listing and held for checking.

## Driver wages (day rates)

* Each driver has a **day rate** (what they are paid per day worked), set on the driver's page. Rates are append-only: a change is a new row with an *applies from* date, so wages already worked never move.
* **Wage** for a period = the sum, over each day the driver worked, of the day rate in force on that day. A day worked on several routes counts once.
* A worked day with **no rate in force** is never counted as zero. The wage is shown as *incomplete* and the missing dates are listed.
* The wage is a driver cost. It is separate from franchise revenue, which is entered on its own.
* Code: `src/lib/finance/wages.ts` (tested in `tests/unit/wages.test.ts`), table `driver_day_rates`.

## Revenue

Revenue entries are per franchise, per month or per day, with status *confirmed* or *estimated*, and sit inside one calendar month (a database constraint) so reports never have to apportion them. If the real DPD documents turn out to carry franchise revenue, it can be imported into the same table.

## Open question

Whether DPD's "daily earnings" statement is what a driver is paid (a cost to you) or what DPD pays the franchise for the driver's work is not known — no real document has been seen. The app follows the brief (driver earnings = cost; revenue entered separately). If that is wrong for your arrangement it changes which table the statement feeds, not the rest of the logic.

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

## Telling duplicates and missing data apart

See `docs/CORE.md` for the principles. In short:

* **Income is the daily Payments; expenses are the Transaction Charges.** A DPD invoice is a summary of those two. It is scanned and kept as a reference so our figures can be cross-checked against DPD's. It is never added to income or expenses, because that would count the money twice.
* **The only alert is that cross-check.** The payments we read, less the charges, against what the invoice states for the period.
* **A duplicate is the same row read twice:** the same franchise, driver, day and route. Two rows on the portal with identical figures are two records. The two spellings of a driver code (`DR27903` and `ref:dr27903`) are the same driver.
* **No data is not zero.** An invoice is compared with the daily payments only for a period the app holds daily payments for.
* **Only what is printed is used.** The app never fills in or corrects a figure. A printed total that does not add up is flagged for checking.
* **A daily report with headings and no rows** is a day with nothing in it. It is recorded as read and does not wait for a decision.
* **A franchise with no transaction charges is zero, not an error.** Some franchises (for example FD78797) carry no transaction charges: the Transaction Charges page shows no table, a zero total, or "no records". That is correct, because other accounts can be paying for that franchise's running costs. The app records zero when the page says so, and still raises an error for a page it does not recognise.
