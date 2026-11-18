# Development log

_Living document. Last updated 17 November 2026._

## Status at a glance

| Phase | State |
| --- | --- |
| 1. Discovery and architecture | Done, **except inspecting the real DPD portal** (no credentials were available) |
| 2. Foundation | Done |
| 3. Core application | Done |
| 4. Integrations | Built and tested against synthetic stand-ins; **not run against real DPD or real Dropbox** |
| 5. Financial intelligence | Done |
| 6. Reporting | Done |
| (merge) | Work from the `ops-qa` branch (CI, error pages, health check, accessibility and responsive tests, runbook, deploy configs) combined with the application; see `docs/OPS_NOTES.md` |
| 7. Quality assurance | Done for what can be tested locally — 332 automated tests + 145 browser tests green (see below) |
| 8. Deployment | Prepared (Vercel app; the nightly sync on GitHub Actions; worker image for other Docker hosts; runbook); **not deployed** |

## What has and has not been tested

**Tested automatically (all against synthetic data):**

| Area | How | Count |
| --- | --- | --- |
| Money, dates, UK formatting | unit | ~65 |
| Financial calculations + reconciliation (original + adjustments = final, for generated data) | unit | ~25 |
| Anomaly detection, stop-consistency classification | unit | ~25 |
| PDF / CSV / Excel parsing, column recognition, matching | unit (real PDFs generated with PDFKit and parsed back) | ~45 |
| Schedule (UK time / BST), retry backoff, crypto, secret scrubbing, report PDF content | unit | ~25 |
| Row level security, franchise/business isolation, roles, append-only ledgers, cover, adjustments, imports, conflicts, job queue, audit | database tests against local Postgres as each role | 51 |
| Import pipeline end to end, duplicates, review queue, reconciliation to DB sums | integration | ~15 |
| DPD browser automation against a **synthetic mock portal**: login, read-only network guard, refusing write-looking clicks, MFA stop, bad password, layout change → diagnostic screenshot + retry, untrusted report → review | integration (real headless Chromium) | 10 |
| Dropbox OAuth URL, token refresh, revoked access, incremental sync, duplicates, conflicts, webhook signature | integration (fake Dropbox API) | 12 |
| Scheduler tick (no double queueing, concurrency, crash recovery, month-end), cron auth, report generation | integration | 11 |
| Browser journeys: sign-in/out, dashboard, adjustment wizard + reversal, cover, upload + duplicate, held document, expense assign/void, report download, drivers, alerts, revenue, no sideways scrolling and bottom navigation on every page at phone size | Playwright e2e (desktop + Pixel 7), run twice consecutively | 145 (desktop, phone, and the demo-data journeys) |

**NOT tested — needs credentials or a live environment:**

* Anything against the **real DPD portal** — login, navigation, downloads. The mock portal proves the mechanics, not DPD's actual pages.
* **Parsing of real DPD documents.** Parsers are driven by column headings and verified on synthetic documents laid out like a typical tabular statement. Real layouts may need heading synonyms added (`src/lib/ingest/columns.ts`) — a one-line change each. Scanned/image PDFs cannot be read (no OCR) and go to review.
* **Real Dropbox** (OAuth consent, webhook delivery from Dropbox).
* Production Supabase, Vercel deployment, cron on Vercel, the worker on a host.
* Email (password reset delivery).
* Load/performance with a year of real data.

## Defects found and fixed during QA

* Franchise row-level-security policy rejected `insert … returning` for new franchises (found by the seed script; regression test added).
* Report files written in the same second collided in storage (random suffix added).
* "Sign out" ended the session on **every** device; it now signs out the current device only (found by the browser tests).
* Dropbox webhook returned 503 when Dropbox is unconfigured; browser test accepts 403/503 as "refused".
* `npm audit` (production): 2 moderate findings in the `exceljs` dependency tree (minimatch/uuid). Not exploitable here — Excel files are parsed server-side from the owner's own uploads — but worth upgrading when `exceljs` releases a fix.

* Password-reset email links ended on the sign-in page (redirect allow-list, host mismatch and a wrong-host redirect); fixed, with a browser test that follows the real emailed link.
* Field error text was part of the field's accessible name; forms wiped typed values after a rejected submission; header and toolbars overflowed at 320px wide. All fixed and covered by tests.
* Worker image: built and run (health endpoint, token check, Chromium launches). Built here with the sandbox's proxy certificate injected; a normal network needs nothing extra.

## Known limitations

* **Portal map is written for Payments and Charges** (`src/lib/dpd/portal-map.json`, tried against the real portal with `npm run dpd:try-map`: all four routes read cleanly). It is the shared setup for every account (loaded from `src/lib/dpd/shared-map.ts`), so nothing needs saving per account: an account is ready for the nightly sync once its owner has saved their DPD login in Settings and added their franchises with their FD numbers. An account can still carry its own map as an override. Invoices are not imported (no importer).
* **The nightly sync runs on GitHub Actions** (`docs/GITHUB_ACTIONS_WORKER.md`), not an always-on worker.
* **Earnings meaning:** the portal's Payments are per route per day. The app treats imported earnings as driver pay (a cost). If they are what DPD pays the franchise for the route, the finance model needs revisiting (see `docs/FINANCE.md`, open question).
* The meaning of DPD "earnings" vs franchise revenue is assumed per the brief (earnings = cost; revenue entered separately). See `docs/FINANCE.md`.
* One business per deployment is the intended use (the schema is multi-tenant, onboarding creates one account per signed-up user, and public sign-up should be off).
* Roles: `owner`, `manager`, `viewer`. There is no in-app screen for inviting extra users yet; add them with SQL or a script (the schema and RLS support them, including per-franchise access).
* No OCR; no vehicle-level or route-level revenue; no payroll export.
* Revenue sharing between drivers is an estimate by a chosen basis and is always labelled as such.
* The demo data seeder and e2e tests only run against a local database (they refuse anything else).

## External input needed to finish

1. DPD portal URL + authorised login (worker env vars) → run exploration → portal map.
2. Confirmation that automated access is permitted by your DPD agreement / portal terms; whether the portal uses MFA/CAPTCHA.
3. 2–3 real sample documents (earnings, fuel, expenses) to calibrate parsers.
4. Where franchise revenue can be obtained (statement/invoice?).
5. Dropbox app key + secret.
6. A production Supabase project (Free plan slots are both in use in the connected organisation).
7. Vercel project + worker host.

## Next step

Needs a human decision: provide the external inputs above, then follow `docs/DEPLOYMENT.md` to create the production Supabase project, Vercel project and worker host and run the smoke tests. Nothing has been deployed.
