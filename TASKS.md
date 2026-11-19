# Franchise Books by Winjo Digital: progress tracker

Working branch: `claude/kind-ptolemy-xt8rly`. `main` is deployed to production; merges to `main` need the owner's go-ahead.

## Objective
A paid subscription (£49 a month per account) that reads each franchise's DPD figures every night and gives owners
income, expenses, driver pay and a report for each four-week period, with self-service sign-up and onboarding.

## Outstanding

### You (owner) to do
- [ ] Say "merge" when the working branch has new changes to take live (you).
- [ ] Try the two DPD logins that did not sign in (`mattjacksonlite@gmail.com`, `sarahsarahalmond@aol.co.uk`) on the DPD portal, then fix them in Settings (you).
- [ ] Add `STRIPE_SECRET_KEY` on Vercel (`matthewai`, Settings → Environment Variables, Sensitive, Production): a restricted **test-mode** key from Stripe → Developers → API keys (you).
- [ ] In Stripe test mode, turn on the customer portal (you).
- [ ] Decide whether £49 includes VAT, then set the price and the legal wording (you).
- [ ] Fill in the contact email and VAT wording on the privacy and terms pages, and get them reviewed (you).
- [ ] Enter the sliding scale rates from the DPD portal, and set each franchise's vehicle (Settings, Edit franchise) (you).
- [ ] Confirm with your accountant how credit notes should be treated (currently: money in, labelled) (you).
- [ ] Press Sync DPD once, then check a new run appears in GitHub Actions, to prove `GITHUB_SYNC_TOKEN` works (you).
- [ ] Give the assistant an email address to send a test driver invitation to (you).

### Assistant to do
- [ ] Test the Stripe checkout and webhook end to end in test mode once the Vercel keys are set (assistant).
- [ ] Test a driver invitation and login end to end once there is a test address (assistant).

## Current implementation (summary)
- Next.js app with Supabase (Postgres, RLS) and a background worker that reads DPD with headless Chromium.
- Per-account DPD logins (several allowed), encrypted with AES-256-GCM; shared portal map for every account.
- Stripe Checkout subscription, webhook, access gate (`BILLING_ENFORCED`), customer portal.
- Owner pages: dashboard, drivers, income, expenses, adjustments, reports, period check, sliding scale, data, settings.

## Known issues
- Sync logins are read one after another in one worker; no parallel reads.
- The DPD read depends on DPD's current page layout; a layout change stops reads until the portal map is updated.

## Test results (latest run on this branch)
- Unit tests: 376 passing. Typecheck, lint and production build clean.
- Database tests: 55 passing. Integration tests: 49 passing (against a local Supabase stack).
- End-to-end tests: all passing (159 run, the rest are skipped by design) against the local stack and a production build.

## Log of finished work (not a checklist)
- Fuel importer fix, pay per day or per stop, period reports on Mondays, shared DPD setup, encrypted logins (merged to main).
- Franchise fee category, payment details (excess, mileage, stop/parcel pay), driver daily table and PDF section.
- Period check, sliding scale storage and page, Stripe billing, homepage and sign-up, onboarding with progress screen.
- Rename to Franchise Books by Winjo Digital; homepage and auth-card redesign.
- Several DPD logins per account, listed in Settings.
- Legal pages (draft), owner-only account closure, service emails via Resend (off until keys are set).
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
