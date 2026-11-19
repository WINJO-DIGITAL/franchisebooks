# Max plan: handoff

Branch: `claude/awesome-goodall-4t6d6r`. Do not merge to `main` without the owner's go-ahead.

## Already done (commit `ad67c5c`)

- Stripe, test mode only, account `acct_1UbEOYLEEs7hslju`:
  - Standard £49 a month: `price_1UdcyRLEEs7hsljuoxp2M8m8`
  - Max £99 a month: `price_1Ude0fLEEs7hsljuOkJEGuQb`, product `prod_Vexw0TXi5ddsSK`
- `src/lib/billing/status.ts`: `PLANS`, `PLAN_PRICE_GBP` (a record), `planFromPriceId`, and the plan on `billingRowFromSubscription`.
- `src/lib/billing/stripe.ts`: `createCheckoutUrl(db, user, plan)`; the webhook saves `plan`.
- `src/lib/actions/billing.ts`: reads `plan` from the form.
- `src/app/(auth)/subscribe/page.tsx`: shows Standard, and Max when `STRIPE_MAX_PRICE_ID` is set.
- `supabase/migrations/20261119000500_billing_plans.sql`: `user_billing.plan` and `billing_plan()`. **Not yet applied to the database.**
- `src/lib/supabase/database.types.ts`: `plan` added to `user_billing`.
- Unit tests: `tests/unit/billing-plans.test.ts`. All 491 unit tests pass.

## Still to build

1. **Apply the migration** (owner, or someone with Supabase access). Nothing Max-related works until this is done.
2. **Set `STRIPE_MAX_PRICE_ID`** on the hosting project to `price_1Ude0fLEEs7hsljuOkJEGuQb`, in test mode.
3. **Sign-up reads the current pay period.** `src/lib/dpd/first-sync.ts` (`queueFirstSync`) currently queues a read for today's date. Change it to the 4-week period containing today. The portal picks a period from a drop-down (`period_select` in `portal-map.ts`), so one read covers the whole period.
4. **First-read step ticks off after a successful sync**, not only when daily payments exist. `src/lib/onboarding/steps.ts` uses `hasEarnings`. An ended franchise with no payments must still complete the step.
5. **Tax-year backfill, Max accounts only.** Read every 4-week period that overlaps the current and previous UK tax year (6 April to 5 April). Label the edge periods that run outside the window. A period DPD reports with no payments records each of its days as £0. A day that hasn't been read stays blank, not zero (`CLAUDE.md`). Check first how the database stores days, because this may need a schema change.
6. **Three Max features**, each shown only when `billing_plan()` returns `max` (check on the server, not only in the page):
   - Long-run trends: income per stop and per parcel over time, with this year against last year.
   - Driver performance: stops, parcels and pay per driver over time, with an alert when a driver's numbers drop.
   - Rate checks: each day's stop count against the DPD sliding scale. Extend the Period Check page.
   - Standard accounts see a short note that these are included in Max.

## Rules to follow

- `CLAUDE.md` applies. Headings and buttons are Title Case, paragraphs are sentence case, and the app never shows estimates or assumptions as figures.
- Only show figures DPD reports. Do not produce tax figures, VAT figures, ledgers, reconciliations or anything formatted as accounts. The Max plan is "records and reports".
- Stripe: test mode only. Do not use the live key.
- Keep to the scope above. Ask before adding anything else.

## Checks

- `npx tsc --noEmit -p tsconfig.json`
- `npx eslint <changed files>`
- `npx vitest run tests/unit`
- Pushes start CI and use GitHub Actions minutes, which are close to the monthly limit. Batch commits.

## Open decisions

None. The history window is the current and previous UK tax year.
