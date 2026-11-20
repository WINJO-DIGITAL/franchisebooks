# Sliding-scale grids: handoff for the next build

Branch: `claude/awesome-goodall-4t6d6r`. Do not merge to `main` without the owner's go-ahead. Max plan only.

## What is already built (commit `519b289`)

- `src/lib/finance/scale-grid.ts`: `gridRate(grid, stops, miles)`. Rounds stops and miles down to the nearest printed row and
  column, and returns the printed rate. Beyond the printed top row or column it uses the top point and sets `beyondScale`.
  Below the bottom it returns null.
- `src/lib/finance/discrepancy.ts`: `buildDiscrepancyReport(days, bands, vehicle, grid?)`. When a grid is given it uses it;
  otherwise it uses the old band table. Days above the printed scale are `not_compared` with reason `beyond_scale` and a
  `guideRate`. They are kept out of every total.
- `src/app/(app)/reports/scale/page.tsx`: the Max-only report page. It still uses the band table, so it does not yet show grids.
- Tests: `tests/unit/scale-grid.test.ts`, `tests/unit/discrepancy.test.ts`.

## Verified (against the printed Micro PDF)

- The PDF's text reads cleanly: 29 rows (60 to 200 stops, steps of 5) × 16 columns (10 to 160 miles, steps of 10), every cell
  filled. More stops never raise the rate and more miles never lower it, so no cell was misread.
- `gridRate` returns the printed value for all 464 cells, and every in-between day rounds down to the right cell.
- Paying exactly stops × the printed rate agrees for all 464 cells; paying 1p a stop short is caught for all 464.
- Two bugs found and fixed: the report used to add all drivers on a franchise-day together before looking up the rate (two
  correctly paid drivers showed as £24 overpaid), and it allowed 2p a stop either way, which hid a route paid from the wrong row
  or column (neighbouring printed rates are often 1p apart). It now checks each payment row (route) on its own, to the penny.
- Not yet verified: a real DPD payment report against its scale for the same period. Do that before any customer sees a figure.

## Decided rules (from the owner)

1. A scale is a printed grid: stop counts down the side (rows), miles across the top (columns), pounds per stop in the cells.
   Example file: "Electric Vehicle Sliding Scale - Micro", rows 60 to 200 in steps of 5, columns 10 to 160 in steps of 10.
2. Units: a printed 1.69 is £1.69 per stop. Store the value exactly as printed. Do not round.
3. Lookup: round DOWN to the nearest row and column. 104 stops uses the 100 row; 91 miles uses the 90 column.
4. Pay for the route = the stop count actually done × the rate found. Pay is to the penny; no rounding of the rate.
   Checked per route (each DPD payment row), never per franchise-day, and with no tolerance against the printed grid.
5. Above the top row or column (over 200 stops or over 160 miles): use the top point as a guide only, label it as such, keep
   it out of the totals. Do not treat it as a stated fact.
6. Both directions in the report: underpayments first, then overpayments, then agreeing days, then not-compared days.
7. Estimates are never shown as figures (`docs/CORE.md`).

## Still to confirm with the owner (assumed for now)

- **Below 60 stops** (or below 10 miles): assumed "not compared", never guessed. Confirm.
- **Mileage:** assumed to be the same measure as the miles on the DPD Payments table, for the same day. Confirm with a real
  payment report before any figure is shown to a customer.

## To build next

1. **Grid storage.** A table of scales: name (for example "Electric Vehicle Sliding Scale - Micro"), the spec (vehicle type,
   size, fuel, and make if DPD prints it), the row and column values, an effective-from date, and the source PDF kept on file.
   Keep the existing band table working for accounts that already use it.
2. **PDF import.** Read the printed grid from the PDF text. Do not accept an import silently: show the parsed grid next to a
   summary (name, row count, column count, first and last values) and hold it until a person approves it. Reject any grid with
   missing or non-numeric cells, and any grid whose rows or columns are not evenly stepped as printed.
3. **Dropdown per vehicle.** On the franchise (or each vehicle, if a franchise has several), a dropdown of the stored scale
   names. Choosing one applies that grid. Show the chosen name on the report.
4. **Report.** Pass the chosen grid into `buildDiscrepancyReport`. Show which scale name and effective date were used, and the
   rule used (round down). Keep the disclaimer: "This report shows DPD's stated figures checked against the scale entered. It is
   not a claim about what DPD owes."
5. **Export** (later): PDF for the franchisee, CSV with the same rows.

## Checks

- Unit tests for the import parser (a known grid, a grid with a missing cell, an unevenly stepped grid).
- A hand check of at least one real period against the PDF, before the report is shown to a customer.
- Database tests: only the owner (and managers with access) can read or change scales; drivers cannot.
- Commands: `npx tsc --noEmit -p tsconfig.json`, `npx eslint <changed files>`, `npx vitest run tests/unit`.
- Title Case for headings and buttons; sentence case for paragraphs (`CLAUDE.md`).
- Pushes start CI only for `main` and pull requests; batch commits.

## Built since this handoff was written

- **Saved scales:** `data/sliding-scales/*.json`, 33 scales named exactly as the DPD portal lists them (ODF and ODW), each with its
  `effective_date` as the portal shows it (01/01/1970 is DPD's own placeholder) and `display_order` (the portal's list order).
- **Library:** `src/lib/finance/scale-library.ts` lists the scales and loads one grid. A key is accepted only if it names a saved
  file. The files are included in the deployed functions through `outputFileTracingIncludes` in `next.config.ts`.
- **Choosing a scale:** Settings, Edit franchise, "Sliding scale" dropdown (name, then the effective date). Stored in
  `franchises.sliding_scale_key` (migration `20261120000100_franchise_sliding_scale.sql`). Until the migration is applied the dropdown
  is hidden and everything else works.
- **Report:** `/reports/scale` uses the chosen grid when there is one (round down, to the penny, above-scale routes as a guide
  only), and the older band table otherwise. The heading names the scale and its active date.
- Still open: a real DPD payment report checked against its scale before any customer sees a figure; confirmation that the
  mileage on the Payments table is the measure DPD uses; the LSC grid (every cell £0.01) is kept as the owner named it.
