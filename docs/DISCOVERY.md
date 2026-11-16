# Discovery report

_Phase 1 output. Last updated 16 November 2026._

## 1. What was inspected

| Area | Finding |
| --- | --- |
| Repository | Empty apart from a one-line README. Everything in this project was built from scratch. |
| DPD portal credentials | **Not available** in the build environment (`DPD_PORTAL_URL`, `DPD_USERNAME`, `DPD_PASSWORD` unset). |
| Dropbox app credentials | **Not available** (`DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` unset). |
| Supabase | Organisation on the **Free plan** with two existing, unrelated projects. The Free plan allows two active projects, so a dedicated project for this app could not be created without the owner's decision (pause one, or upgrade). Development and testing used a full local Supabase stack (Postgres 17, Auth, REST, Storage) in Docker. |
| Vercel | A team exists. No project was created or deployed — that is an outward-facing step left for the owner's go-ahead. |

## 2. DPD partner portal — what is and is not known

**The portal has not been inspected.** Without authorised credentials it is not
possible to see what the account can access, and nothing in this project
pretends otherwise:

* No page names, URLs, selectors or report layouts of the real portal are
  assumed anywhere in the code.
* The portal capability inventory (`docs/PORTAL_INVENTORY.md`) lists every
  section the brief asks about with status **"Not verified"**.
* The portal integration is an *engine driven by a portal map*
  (`src/lib/dpd/`). The map — which pages hold earnings, fuel and expenses for
  each franchise and how to reach them — is produced by the discovery tool
  from the real portal and reviewed by a person before any sync runs.
* The engine itself (login, read-only guard, navigation, download, failure
  handling) is tested against a **synthetic mock portal**. That proves the
  mechanics; it does not prove anything about DPD's portal.

### How discovery will be completed

Once credentials are set on the worker:

```
npm run dpd:discover        # or press "Explore the DPD portal" in Data & Integrations
```

The discovery run logs in, then walks every page reachable by ordinary
navigation links (GET requests only — see the read-only guard below), and for
each page records: title, headings, tables and their column headings,
downloadable files, date filters, and whether the page contains forms. It
writes `docs/PORTAL_INVENTORY.generated.md` plus a JSON file, and stores the
result against the job so it can be read in the app. A developer then turns
that into the portal map (a small JSON document) and, if a real DPD PDF uses
column headings the parser does not know, adds them to
`src/lib/ingest/columns.ts`.

### Read-only guarantee

The integration can only look, never touch. This is enforced in code, not by
convention (`src/lib/dpd/guard.ts`):

1. Every network request the browser makes is intercepted. Anything other
   than `GET`/`HEAD`/`OPTIONS` is **blocked** unless it matches the explicit
   login allow-list (the sign-in form post, and nothing else).
2. Clicks go through one helper that refuses any control whose label looks
   like a write action (save, submit, approve, reject, delete, cancel, update,
   confirm, pay, send…).
3. Forms are never filled except the login form. Discovery records that a
   page has forms and moves on.
4. MFA prompts and CAPTCHAs are detected and **not** worked around: the job
   stops with status "blocked" and tells the owner to use manual upload.
5. Requests are rate-limited (one page at a time, with a delay between pages).

## 3. Open questions for the owner

These affect how figures should be read. The system is built so each answer is
a setting or data entry, not a code change.

1. **What do the DPD "daily earnings" figures represent in your business?**
   The brief treats them as *driver earnings* (a cost to the franchise) and
   says revenue must not be assumed from them. The app follows that: profit is
   only shown once franchise revenue has been entered or imported. If in fact
   the DPD statement is what DPD pays *you*, tell us — the revenue input can
   then be fed from it.
2. **Where does franchise revenue come from?** (A DPD invoice/self-bill
   statement? A portal page?) Until this is known, revenue is entered by hand
   per franchise per month (or day) and labelled confirmed or estimated.
3. **What time are the daily reports reliably available?** The evening sync
   defaults to 20:30 UK time and is adjustable in Settings.
4. **Does the portal use MFA or a CAPTCHA?** If so, fully automatic login is
   not possible (and will not be bypassed); Dropbox sync and manual upload
   remain available.
5. **Is automated access permitted by your DPD franchise agreement / portal
   terms?** Please confirm before the sync is switched on.

## 4. Credentials and access needed to finish

| Needed | For | Where it goes |
| --- | --- | --- |
| DPD portal URL, username, password (and login secret if any) | Portal discovery, then the nightly sync | Environment variables on the **worker only** |
| 2–3 real sample documents (earnings PDF, fuel report, expense report) | Calibrating the parsers to the real layouts | Upload through the app; they go to the review queue if not recognised |
| Dropbox app key + secret (create an app at dropbox.com/developers) | "Connect Dropbox" | Vercel environment variables |
| A Supabase project for production | Database, auth, file storage | Decision needed: free up a slot or upgrade the plan |
| Vercel project + a host for the worker (Railway, Fly.io, Render or any Docker host) | Hosting | See `docs/DEPLOYMENT.md` |

## 5. Integration constraints identified

* **Browser automation cannot run on Vercel functions.** Chromium needs
  system libraries and several hundred MB, and a portal run for several
  franchises can exceed function time limits. Playwright therefore runs in a
  separate always-on **worker** (a small Docker service). Vercel only queues
  jobs and pokes the worker over an authenticated HTTPS call.
* **Vercel Cron is UTC-only and, on the Hobby plan, limited to once a day.**
  The schedule is therefore stored as a UK local time in the database and a
  frequent "tick" decides whether the sync is due (DST-safe). The worker runs
  the same tick on its own timer, so the schedule works on any Vercel plan.
* **The Supabase Data API returns at most 1,000 rows per request.** All reads
  that feed a financial total are paged (`src/lib/data/fetch-all.ts`).
* **Scanned (image-only) PDFs cannot be read** without OCR. They are detected
  and sent to the review queue with a plain-English explanation.
