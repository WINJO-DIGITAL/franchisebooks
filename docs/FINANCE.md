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

## Revenue

Revenue entries are per franchise, per month or per day, with status *confirmed* or *estimated*, and sit inside one calendar month (a database constraint) so reports never have to apportion them. If the real DPD documents turn out to carry franchise revenue, it can be imported into the same table.

## Open question

Whether DPD's "daily earnings" statement is what a driver is paid (a cost to you) or what DPD pays the franchise for the driver's work is not known — no real document has been seen. The app follows the brief (driver earnings = cost; revenue entered separately). If that is wrong for your arrangement it changes which table the statement feeds, not the rest of the logic.
