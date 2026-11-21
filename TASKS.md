# Franchise Books by Winjo Digital: progress tracker

Working branch: `claude/awesome-goodall-4t6d6r`. `main` is deployed to production; merges to `main` need the owner's go-ahead.

## Objective
A paid subscription (Essential £49, Max £99 a month per account) that reads each franchise's DPD figures every night and gives owners
income, expenses, driver pay and a report for each four-week period, with self-service sign-up and onboarding.

## Outstanding

### You (owner) to do
- [ ] Remove the saved live `api.stripe.com` key from the assistant's environment (environment menu in the session title bar, Edit, Network secrets) (you).
- [ ] To go live, add a live Stripe secret key on Vercel as `STRIPE_SECRET_KEY_LIVE` (sensitive, production), and `STRIPE_PORTAL_CONFIGURATION_ID_LIVE` = `bpc_1UdiQOLEEs7hsljuIpbZ8YsV` (the Franchise Books portal, not the account default), then say "go live" (you). The assistant will first set that live portal's plan change to charge straight away.
- [ ] Delete the test customer "Franchise Books test run" (`cus_VfNfDF6wFI0aHV`) in the Stripe test dashboard (you).
- [ ] Switch on two-step sign-in (authenticator app, "TOTP") on the live Supabase project: Authentication, Sign In / Providers, Multi-Factor, turn on enrolment and verification (you). Until then the Settings button says it is not switched on. Check your Supabase plan includes it.
- [ ] In Settings, Edit franchise, choose each franchise's sliding scale; then open Reports, Sliding Scale Report for a closed period and say if any route looks wrong (you).

### Assistant to do
- [ ] On "go live": switch on the live webhook `we_1UdiPuLEEs7hsljuekFwuBLe`, set `STRIPE_MODE=live`, redeploy and check a live checkout (assistant).
- [ ] Check an Essential to Max change end to end through the app: create a test login through sign-up and checkout, upgrade it, then check the plan row, the webhook and the first history reads in the sync log (assistant, needs a test login from you).

## Current implementation (summary)
- Next.js app with Supabase (Postgres, RLS) and a background worker that reads DPD with headless Chromium.
- Per-account DPD logins (several allowed), encrypted with AES-256-GCM; shared portal map for every account.
- Stripe Checkout subscription with two plans (Essential, Max), webhook, access gate (`BILLING_ENFORCED`), customer portal with plan changes.
- Max plan: history reads over the current and previous tax year (a few periods a night), and Insights pages (trends, driver performance, rate checks).
- Owner pages: dashboard, drivers, income, expenses, adjustments, reports, period check, sliding scale, insights (Max), data, settings.

## Known issues
- Sync logins are read one after another in one worker; no parallel reads.
- The DPD read depends on DPD's current page layout; a layout change stops reads until the portal map is updated.

## Test results (latest run on this branch)
- Unit tests: 552 passing. Typecheck, lint and production build clean.
- Database tests: 59 passing. Integration tests: 85 passing (against a local Supabase stack).
- End-to-end tests: 195 passing, 62 skipped by design (phone-only and desktop-only tests), against the local stack and a production build.

## Log of finished work (not a checklist)
- Two-step sign-in: anyone can turn it on for their own login in Settings (authenticator app code after the password). A password-only session is stopped at the code page for every page and API call. This is enforced by the app; the database itself does not require the code, so it protects sign-in, not a direct database connection.
- Team: the owner invites managers and viewers from Settings, chooses which franchises each can see, changes that later, or removes them. A removed person whose name is on records they entered keeps a blocked login (so the records stay linked) and cannot sign in or see anything.
- Portal change warning: when several DPD reads fail on layout in a day (across accounts, or the same step repeatedly), one email goes to ALERT_EMAIL, at most every six hours. History reads queued before a downgrade are skipped.
- Driver and vehicle dates: licence, right to work, DBS, MOT, service, road tax and insurance, with reminders on the Drivers page and a dashboard prompt for anything overdue or due within 30 days (all plans).
- End-of-period reports: Driver Pay Report and Profit and Loss (Essential) and Sliding Scale Discrepancy (Max, PDF and CSV), made automatically the evening after each period closes and listed on the Reports page.
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
- Max plan (£99): plan recorded from the Stripe price, history reads over two tax years, Insights pages, plan changes in the billing portal. Live in test mode; merged to `main`.
- Dashboard: Start Reading DPD button on the first set-up step, so the first read starts without going to Settings.
- Live Stripe prepared but not switched on: live Max price, live webhook (disabled), Franchise Books portal, and `STRIPE_MODE` to switch between test and live.
- Checkout refuses to start a second subscription; the webhook ignores other WINJO Digital products in the same Stripe account.
- CI runs on `main`, pull requests and by hand only, and skips documentation-only changes.
