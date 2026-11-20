# Max perk: sliding-scale discrepancy report (plan)

Status: plan only. Not built. Working branch `claude/awesome-goodall-4t6d6r`; do not merge to `main` without the owner's go-ahead.

## What it is

On the Max plan, the app checks each day's stop pay against the DPD sliding scale the franchisee has entered, and produces a
report the franchisee can take to DPD themselves. The app never contacts DPD, never writes to the DPD portal, and never claims
money is owed. It shows what the figures say, against the scale as entered.

It builds on the Rate Checks page that already exists on Max (`src/lib/finance/sliding-scale.ts`, `src/lib/history/insights.ts`).
What is new is the report: per-day detail, both directions, money totals, and an export.

## Rules (non-negotiable)

1. **Both directions.** Days paid more than the scale gives are shown as clearly as days paid less. A one-sided report loses
   credibility, and DPD would audit the whole picture anyway. Underpayments are listed first, overpayments second, and the
   totals are the net and both sides.
2. **Stated figures only.** Stops, miles, stop pay and the scale's rates are taken as stated. The expected rate is labelled
   "per the scale entered for this franchise". No VAT, no estimates, no assumed bands (see `docs/CORE.md`).
3. **Not compared is not zero.** A day missing stops, miles or stop pay, or with no single matching band, goes in a separate
   "not compared" list with the reason. It is never counted as agreeing or differing.
4. **No claim of entitlement.** The report says what was paid and what the scale gives. It does not say DPD owes anything,
   and it does not tell the franchisee what to demand.
5. **No commission, no recovery figures in the product.** The report is a Max feature only. See the website note above.

## Inputs

- Daily stops and stop pay per franchise, per day, from the DPD Payments table (already imported).
- Miles per day, from the same table where DPD states it (`mileage`). Days without miles are not compared when the scale needs them.
- The sliding scale rates (`sliding_scale_rates`) and each franchise's vehicle (`franchises.vehicle_*`).
- The tolerance already used by Rate Checks (2p per stop), so the report and the page agree.

## What the report contains

Per franchise, per period (choose one or more periods; default: the last finished period):

- **Summary:** days compared, days paid below the scale, days paid above, days not compared, net difference in pounds, the
  underpayment total and the overpayment total, each stated, with the scale version and the date it was entered.
- **Detail, one row per day:** date, stops, miles, the expected rate from the scale, the rate paid (stop pay ÷ stops), and the
  difference in pence per stop and in pounds for the day. Underpayments first.
- **Not compared:** each day with the reason it could not be compared.
- **Method note:** how the expected rate was found (the single band matching stops and miles), in plain English.
- **Footer:** "This report shows DPD's stated figures checked against the sliding scale entered on [date]. It is not a claim
  about what DPD owes. Questions about pay should be taken to DPD."

Export: PDF for the franchisee, and CSV with the same rows, both from the Reports page.

## Pages and access

- New Reports entry: "Sliding Scale Report" (Max only). Standard accounts see the upgrade note, as Insights does.
- Shown to the owner. Drivers never see it (drivers use their own page). Managers and viewers see it only if the owner gives
  access.
- Built from `checkStopRates`, so the Rate Checks page and the report cannot disagree.

## Checks before it ships

- Unit tests: a day above and a day below the scale; a day with missing miles (not compared); two periods with a band change;
  a franchise with no vehicle (report says so, nothing compared); overpayments listed after underpayments; totals equal the sum
  of the rows.
- Database tests: only the owner (and managers with access) can read the report; drivers cannot.
- A worked example checked by hand against one real period before it is shown to a customer.
- Wording reviewed by the owner (and a solicitor, given the franchisee will take it to DPD).

## Open questions for the owner

1. Is the scale rate the only pay component to check, or are parcel pay and other DPD pay lines to be covered too? (This plan
   checks the stop rate only.)
2. Who signs off a scale that has been entered: the owner, or should the app ask for a DPD document reference when it is saved?
3. How long should the report keep old scale versions, so a past period is checked against the scale that applied then?
4. Should the report say which scale band each day matched, or just the expected rate?
