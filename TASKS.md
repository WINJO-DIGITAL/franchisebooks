# Franchise Books by Winjo Digital: progress tracker

Working branch: `claude/kind-ptolemy-xt8rly`. `main` is deployed to production; merges to `main` need the owner's go-ahead.

## Objective
A paid subscription (£49 a month per account) that reads each franchise's DPD figures every night and gives owners
income, expenses, driver pay and a report for each four-week period, with self-service sign-up and onboarding.

## Outstanding
- [ ] Owner to run migrations `20261118000700` and `20261118000800`, and to set Vercel secrets (Stripe key, Resend, Supabase auth settings).
- [ ] Owner to fill in the contact email and VAT wording in the legal pages, and get them reviewed.
- [ ] Owner to decide: credit notes and franchise fee meaning; whether £49 includes VAT.
- [ ] Sliding scale is stored but not used in any calculation (needs a decision on which vehicle each day belongs to).
- [ ] Driver login (drivers seeing their own earnings) is not built; needs a product decision on access.
- [ ] End-to-end and integration tests not yet run on this branch against the live stack.

## Current implementation (summary)
- Next.js app with Supabase (Postgres, RLS) and a background worker that reads DPD with headless Chromium.
- Per-account DPD logins (several allowed), encrypted with AES-256-GCM; shared portal map for every account.
- Stripe Checkout subscription, webhook, access gate (`BILLING_ENFORCED`), customer portal.
- Owner pages: dashboard, drivers, income, expenses, adjustments, reports, period check, sliding scale, data, settings.

## Known issues
- Sync logins are read one after another in one worker; no parallel reads.
- The DPD read depends on DPD's current page layout; a layout change stops reads until the portal map is updated.

## Test results (latest run on this branch)
- Unit tests: 344 passing. Typecheck, lint and production build clean.
- Database and integration tests: not run here (need a local Supabase stack).
- End-to-end tests: not run since the redesign and rename (needs the full local stack).

## Log of finished work (not a checklist)
- Fuel importer fix, pay per day or per stop, period reports on Mondays, shared DPD setup, encrypted logins (merged to main).
- Franchise fee category, payment details (excess, mileage, stop/parcel pay), driver daily table and PDF section.
- Period check, sliding scale storage and page, Stripe billing, homepage and sign-up, onboarding with progress screen.
- Rename to Franchise Books by Winjo Digital; homepage and auth-card redesign.
- Several DPD logins per account, listed in Settings.
- Legal pages (draft), owner-only account closure, service emails via Resend (off until keys are set).
- Nightly reads spread across a 30-minute window per account (deterministic, unit tested).
- Content Security Policy added; verified in a browser on the production build, no violations on public pages.
- Driver daily table fits a phone (detail columns shown from tablet width).
- Production build verified (`next build` succeeds).
