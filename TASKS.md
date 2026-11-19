# Franchise Books by Winjo Digital: progress tracker

Working branch: `claude/awesome-goodall-4t6d6r`. `main` is deployed to production; merges to `main` need the owner's go-ahead.

## Objective
A paid subscription (Standard £49, Max £99 a month per account) that reads each franchise's DPD figures every night and gives owners
income, expenses, driver pay and a report for each four-week period, with self-service sign-up and onboarding.

## Outstanding

### You (owner) to do
- [ ] Apply the database migration `20261119000500_billing_plans.sql` (`npx supabase db push`), before anything else for Max (you).
- [ ] Then set `STRIPE_MAX_PRICE_ID` on Vercel to `price_1Ude0fLEEs7hsljuOkJEGuQb` (test mode) so Max is offered, or ask the assistant to (you).
- [ ] Remove the saved `api.stripe.com` credential from the assistant's environment settings, because it is a live key (you).
- [ ] Review the new plan wording in the Terms page, section 10 (you).
- [ ] Ask an accountant to confirm the Max plan (records and reports only) stays outside regulated accountancy services (you).
- [ ] Before launch, say "go live" so the assistant sets up live Stripe prices, webhook and portal, then put the live keys on Vercel (you).
- [ ] Decide whether CI should run only for `main` and pull requests, to save GitHub Actions minutes (you).
- [ ] Try the two DPD logins that did not sign in (`mattjacksonlite@gmail.com`, `sarahsarahalmond@aol.co.uk`) on the DPD portal, then fix them in Settings (you).
- [ ] Enter the sliding scale rates from the DPD portal, and set each franchise's vehicle (Settings, Edit franchise) (you).
- [ ] Confirm with your accountant how credit notes should be treated (currently: money in, labelled) (you).
- [ ] Give the assistant an email address to send a test driver invitation to (you).
- [ ] Say "merge" when the working branch has new changes to take live (you).

### Assistant to do
- [ ] Test a Max checkout, a Standard to Max change in the billing portal, and the first history reads, once the migration and price are in (assistant).
- [ ] Run the database, integration and end-to-end tests against a local Supabase stack for the Max changes (assistant).
- [ ] Test a driver invitation and login end to end once there is a test address (assistant).

## Current implementation (summary)
- Next.js app with Supabase (Postgres, RLS) and a background worker that reads DPD with headless Chromium.
- Per-account DPD logins (several allowed), encrypted with AES-256-GCM; shared portal map for every account.
- Stripe Checkout subscription with two plans (Standard, Max), webhook, access gate (`BILLING_ENFORCED`), customer portal with plan changes.
- Max plan: history reads over the current and previous tax year (a few periods a night), and Insights pages (trends, driver performance, rate checks).
- Owner pages: dashboard, drivers, income, expenses, adjustments, reports, period check, sliding scale, insights (Max), data, settings.

## Known issues
- Sync logins are read one after another in one worker; no parallel reads.
- The DPD read depends on DPD's current page layout; a layout change stops reads until the portal map is updated.

## Test results (latest run on this branch)
- Unit tests: all passing (see the latest commit). Typecheck, lint and production build clean.
- Database, integration and end-to-end tests: not run for the Max changes yet (they need a local Supabase stack).

## Log of finished work (not a checklist)
- Fuel importer fix, pay per day or per stop, period reports on Mondays, shared DPD setup, encrypted logins (merged to main).
- Franchise fee category, payment details (excess, mileage, stop/parcel pay), driver daily table and PDF section.
- Period check, sliding scale storage and page, Stripe billing, homepage and sign-up, onboarding with progress screen.
- Rename to Franchise Books by Winjo Digital; homepage and auth-card redesign.
- Several DPD logins per account, listed in Settings.
- Legal pages, owner-only account closure, service emails via Resend (off until keys are set).
- Sync DPD button starts the GitHub Actions sync straight away when GITHUB_SYNC_TOKEN is set on Vercel (it falls back to queueing for the next run without it).
- Each DPD login has "Check & refresh" in Settings: checks it signs in (wrong logins are reported there), picks up new franchises and re-reads them.
- Adding a DPD login: name and FD numbers are optional; with no FD numbers, the franchises are found from the portal (Routes drop-down) and read straight away.
- Nightly reads spread across a 30-minute window per account (deterministic, unit tested).
- Content Security Policy added; verified in a browser on the production build, no violations on public pages.
- Driver daily table fits a phone (detail columns shown from tablet width).
- Production build verified (`next build` succeeds).
- Getting-started panel on the dashboard (only the steps still to do).
- Credit notes recorded as labelled money in; franchise vehicle recorded; each day's stop rate checked against the sliding scale on the Period check page.
- Driver login: drivers see only their own days and pay at /my; owner invites and removes access from the driver page; database keeps driver logins and business users separate (tests in tests/db/security.test.ts).
- Duplicate driver payments fixed: the importer treats `DR27903` and `ref:dr27903` as one driver (migration `20261118001100`), and re-syncing was checked not to add rows.
- Sign-up accepts several DPD logins (up to 5), each with optional name and FD numbers; a login added at sign-up or in Settings starts a GitHub run straight away.
- Drivers named on a DPD report are added automatically and linked to their franchise; the set-up panel no longer asks for franchises or drivers by hand.
- A DPD sign-in that does not complete now says why (wrong password, password change or new terms waiting, locked login) instead of "layout may have changed".
- Local database, integration and browser tests run and brought up to date.
- Payment confirmation: a loading screen while Stripe's payment is recorded, then a Payment Confirmed screen before set-up.
- Set-up checklist: the first read counts as done after a successful DPD read, even when the franchise has no payments.
- Max plan (£99): plan recorded from the Stripe price, history reads over two tax years, Insights pages, plan changes in the billing portal.
