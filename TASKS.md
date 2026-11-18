# Franchise Books by Winjo Digital: progress tracker

Working branch: `claude/kind-ptolemy-xt8rly`. `main` is deployed to production; merges to `main` need the owner's go-ahead.

## Objective
A paid subscription (£49 a month per account) that reads each franchise's DPD figures every night and gives owners
income, expenses, driver pay and a report for each four-week period, with self-service sign-up and onboarding.

## Outstanding

### You (owner) to do
- [ ] Check the Resend domain `mail.winjodigital.co.uk` shows "verified" (it was still pending).
- [ ] Add on Vercel (`matthewai`): `STRIPE_SECRET_KEY` (restricted test key), `RESEND_API_KEY` (send-only key), `EMAIL_FROM` (`hello@mail.winjodigital.co.uk`).
- [ ] In Stripe test mode, turn on the customer portal.
- [ ] Decide whether £49 includes VAT, then set the price and the legal wording.
- [ ] Fill in the contact email and VAT wording on the privacy and terms pages, and get them reviewed.
- [ ] Turn on sign-ups in Supabase (Authentication settings) when ready to take customers.
- [ ] Enter the sliding scale rates from the DPD portal, and set each franchise's vehicle (Settings, Edit franchise).
- [ ] Confirm with your accountant how credit notes should be treated (currently: money in, labelled).
- [ ] Say "merge" when the working branch has new changes to take live.

### Assistant to do
- [ ] Re-check the Resend domain and send a test invitation once it verifies.
- [ ] Test the Stripe webhook and checkout end to end in test mode once the Vercel keys are set.
- [ ] Run the database, integration and end-to-end test suites against a local stack (CI runs them on push).
- [ ] Test a driver invitation and login end to end.

## Current implementation (summary)
- Next.js app with Supabase (Postgres, RLS) and a background worker that reads DPD with headless Chromium.
- Per-account DPD logins (several allowed), encrypted with AES-256-GCM; shared portal map for every account.
- Stripe Checkout subscription, webhook, access gate (`BILLING_ENFORCED`), customer portal.
- Owner pages: dashboard, drivers, income, expenses, adjustments, reports, period check, sliding scale, data, settings.

## Known issues
- Sync logins are read one after another in one worker; no parallel reads.
- The DPD read depends on DPD's current page layout; a layout change stops reads until the portal map is updated.

## Test results (latest run on this branch)
- Unit tests: 363 passing. Typecheck, lint and production build clean.
- Database and integration tests: not run here (need a local Supabase stack).
- End-to-end tests: not run since the redesign and rename (needs the full local stack).

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
