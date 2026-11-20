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
* **Charges:** DPD's Transaction Charges are imported excluding VAT (the portal shows "£11.47 (excl. £2.29 VAT)": £11.47 is before VAT and £2.29 is the VAT added on top). The stated VAT is stored beside the amount (`expenses.vat_amount`) and shown as a breakdown: before VAT, stated VAT, including VAT. It is never estimated; a charge with no VAT stated has none.
* **Other VAT wordings on a charge:** "(excluding £3.00 VAT)" and "(ex £3.00 VAT)" read the same as "(excl. £3.00 VAT)". "£18.00 (incl. £3.00 VAT)" is read as £15.00 before VAT plus £3.00 stated VAT: simple arithmetic on stated figures, no rate assumed. A figure that cannot be read, or stated VAT larger than the amount that includes it, is held for a person.
* **Fuel:** the stated net amount is the cost. If only a total is stated with its VAT, the cost is the total less that VAT. If only a total is stated and no VAT, the file is held for a person to check (below the auto-import threshold); 20% is never assumed.
* **How to read a DPD self-billed invoice:** every line amount and "Total exc VAT" are **excluding VAT**. VAT (20%) is shown separately in the VAT analysis, and "Invoice total" is net plus VAT. The VAT shown is the business's output tax due to HMRC. Each invoice names its period ("for period 12/10/2026 to 08/11/2026"), the FD number, an invoice date and a due date.
* **Invoice dates:** the invoice is dated on the last day of the four-week period and falls due five days later (six invoices checked, all the same). The invoice date is the last day of the billing period ("for period 12/10/2026 to 08/11/2026"); the next period starts the day after. Drivers need to know what they earned as soon as the period closes, so the automatic period report is made the evening after its last day (once the nightly sync has brought in that day), not on the due date. Change `REPORT_DELAY_DAYS_AFTER_PERIOD_END` in `src/lib/finance/periods.ts` if that needs to move.
* **Invoice extras are income:** the invoice also carries a *Fuel Supplement* (£71.27 that period) and a *C&D App* line (£9.23). They are not in the daily Payments rows, so they are added to income once, as "invoice extras", dated at the start of the pay period (only from invoices whose lines add up to their printed net). Everything else on the invoice ties to the daily figures exactly (weekday, Saturday and Sunday stops and pay, and excess parcels), so those lines are never added again. Code: `loadOtherPayments` in `src/lib/data/period.ts`, which skips any line matching `DAILY_PAYMENT_LINE`.
* **One-off support payments are income, once:** DPD sometimes sends a self-billed *Support Payment* invoice with no billing period, for example "Business start" £500.00 when a franchise opens (FI1020123 for FD75486 and FI1020124 for FD75488, dated 13/09/2026, no VAT because the business was not yet VAT registered). It is not in the daily Payments, so its net is added to income once, dated on its **invoice date**, so it falls in the pay period containing that date (13/09/2026 is the last day of the period 17/08/2026 to 13/09/2026). It is never compared with the daily Payments in the period check.
* **VAT-only invoices add VAT, never income:** when the business registers for VAT, DPD sends a *Self Billed VAT Only Invoice* (for example FVI17562 and FVI17572, dated 11/10/2026) "for the adjustment of VAT" on earlier invoices it lists by document number. Its table shows the earlier invoice's net for reference (£500.00) and the VAT (£100.00), but its own "Total exc VAT" is £0.00, so it never adds net income. The app shows it with the payment it refers to as **one** entry: "DPD business start support payment: £500.00 + £100.00 VAT = £600.00 · invoices FI1020123 + FVI17562". Income in this app is always counted excluding VAT, so the £100 is shown, not added to profit. The VAT-only invoice is stored with its own invoice date (11/10/2026, pay period 14/09/2026 to 11/10/2026), which is the date the VAT was charged; if VAT is ever reported by period, that is the period it belongs to. If it arrives before (or without) the invoice it refers to, it is stored quietly and shown once that invoice arrives; it is never flagged as needing checking. Code: `parseSupportPayment` and `parseVatOnly` in `src/lib/ingest/invoice.ts`, `otherPaymentsFromInvoices` in `src/lib/data/period.ts`, column `dpd_invoices.kind` (migration `20261119000400_one_off_dpd_invoices.sql`).
* **Same-day entries:** DPD can list two entries for one driver, route and day (for example a second run) with different figures. They are added together, since the ledger holds one row per driver, route and day. An entry that repeats with exactly the same figures for the same driver, route and day is the same row read twice (`docs/CORE.md` rule 5), so it is held for a person to check rather than added.

## Driver wages (day rates)

* Each driver has a **day rate** (what they are paid per day worked), set on the driver's page. Rates are append-only: a change is a new row with an *applies from* date, so wages already worked never move.
* **Wage** for a period = the sum, over each day the driver worked, of the day rate in force on that day. A day worked on several routes counts once.
* A worked day with **no rate in force** is never counted as zero. The wage is shown as *incomplete* and the missing dates are listed.
* The wage is a driver cost. It is separate from franchise revenue, which is entered on its own.
* **Pay rules (optional, per driver, set by the owner).** A day rate can carry two extras, entered in Set Pay Rate:
  * **Extra pay per stop:** each stop over a number of stops in a day pays an extra amount. A £120 day with £1 for each stop over 110 pays £130 for 120 stops. The stops are the day's stops summed across the driver's routes.
  * **Days in a row:** after a number of days in a row, the day pays a different rate. £120 a day with £125 from the sixth day in a row pays £120 for days 1 to 5 and £125 for day 6 and every day after that in the run, with the extra for stops on top. A day with no work in between starts the count again. The count looks back across the period boundary, so a run that began in the last period carries on.
  * The days-in-a-row rate is used as entered, even if it is lower than the day rate.
  * A day that needs a stop count (extra pay per stop) and has none is **not priced**: the wage is incomplete and the date is listed, as for a missing rate. A per-stop rate has no extras.
  * Statements show each day's working (the day rate used, a star for a days-in-a-row day, and the extra) and a note saying what the extras are.
* Code: `src/lib/finance/wages.ts` (`priceDay`, `dayInARowByDate`; tested in `tests/unit/wages.test.ts` and `tests/unit/pay-rules.test.ts`), shared reader `src/lib/data/day-rates.ts`, table `driver_day_rates` (migration `20261120000200_driver_pay_rules.sql`; the app reads without the new columns until the migration is applied).

## Revenue

Revenue entries are per franchise, per month or per day, with status *confirmed* or *estimated*, and sit inside one calendar month (a database constraint) so reports never have to apportion them. If the real DPD documents turn out to carry franchise revenue, it can be imported into the same table.

## Dates and money

* Numeric dates on documents are read day first (UK): `11/08/2026` is 11 August. ISO dates (`2026-08-11`) are read as written. A date that is not a real day (`31/02/2026`) is flagged, never swapped round.
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

* **Income is the daily Payments plus the invoice's extra lines; expenses are the Transaction Charges.** A DPD invoice is a summary of the payments and charges. It is scanned and kept so our figures can be cross-checked against DPD's. Only its extra lines (Fuel Supplement, C&D App) and one-off support payments are added to income; the rest is never added, because that would count the money twice.
* **The only alert is that cross-check.** The payments we read, less the charges, against what the invoice states for the period.
* **A duplicate is the same row read twice:** the same franchise, driver, day and route. Two rows on the portal with identical figures are two records. The two spellings of a driver code (`DR27903` and `ref:dr27903`) are the same driver.
* **No data is not zero.** An invoice is compared with the daily payments only for a period the app holds daily payments for.
* **Only what is printed is used.** The app never fills in or corrects a figure. A printed total that does not add up is flagged for checking.
* **Invoices that do not add up.** Net plus VAT is the invoice total. When character recognition reads a "VAT" figure that does not make that true (for example "Total exc VAT" split over two lines, so the net is read beside a "VAT" label), the VAT is the figure the invoice prints elsewhere (its VAT analysis) that does make it true; nothing is worked out. A line amount misread as "s7,45571" is read as £7,455.71 only because that reading makes the lines add up to the printed net. An invoice whose lines still do not add up is stored with its problems, its extras are not counted, and its original PDF and recognised text are listed for the owner under Data & Integrations → Documents That Could Not Be Read. The nightly sync reads such an invoice again each night it is listed; once a reading adds up, it replaces the old one and the document drops off the list. An invoice that adds up is never re-read or overwritten.
* **A daily report with headings and no rows** is a day with nothing in it. It is recorded as read and does not wait for a decision.
* **A franchise with no transaction charges is zero, not an error.** Some franchises (for example FD78797) carry no transaction charges: the Transaction Charges page shows no table, a zero total, or "no records". That is correct, because other accounts can be paying for that franchise's running costs. The app records zero when the page says so, and still raises an error for a page it does not recognise.
