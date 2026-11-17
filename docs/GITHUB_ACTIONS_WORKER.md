# Nightly sync on GitHub Actions

The DPD portal is read once a day, around 20:30 UK time. Nothing runs the rest
of the day, so there is no server to host or pay for.

| Part | Where |
| --- | --- |
| Web app | Vercel |
| Nightly Playwright run | GitHub Actions (`.github/workflows/dpd-sync.yml`) |
| Data | Supabase |
| Extra documents | Dropbox API (read during the nightly run, and by webhook on Vercel) |

## What a nightly run does

`npm run worker:once` (`worker/run-once.ts`) does the same work as the
always-on worker (`worker/index.ts`), then exits:

1. Starts at 20:32 UK time and starts headless Chromium.
2. Queues what is due: the DPD sync for each **active franchise (FD number)**, a Dropbox catch-up, the daily checks.
3. Signs in to the DPD portal once, reads each franchise's reports, and passes every document through the import pipeline (validate, de-duplicate, store in Supabase).
4. Records success or failure on the job (`import_jobs`) and in the sync log, both visible under **Data & Integrations**.
5. Waits out retries (below), closes the browser and exits. The run fails (red cross, email from GitHub) if any job ended failed or blocked.

**No duplicates.** A job is unique per type, franchise and report date, the
scheduler queues "only if it does not exist", and imports are idempotent. Running
the workflow twice, or pressing manual run after a scheduled one, cannot double up.

**Retries when reports are not ready.** A failed job is re-queued with a delay
(2 minutes, then 8), up to 3 attempts. The run stays alive for those retries, up
to 25 minutes. A job still waiting after that is picked up by the next run.

## UK time

GitHub cron is UTC only and does not follow daylight saving. The workflow is
scheduled at **19:32 and 20:32 UTC**. In summer (BST) the first is 20:32 UK; in
winter (GMT) the second is. A first step (`.github/scripts/in-window.sh`) checks
the UK clock and lets only the one inside **20:30 to 21:29 UK** continue. The
other stops within seconds. The window end leaves room for GitHub starting a
scheduled run late. Checked across both clock changes (29 March and 25 October 2026).

If you change the sync time in **Settings**, change the cron lines and the window
to match (repository variables `SYNC_WINDOW_START` and `SYNC_WINDOW_END`, as `HHMM`).

## One-time setup

GitHub does not run scheduled workflows from a branch. **Merge this file into
the default branch first.** Then, in the repository: **Settings → Secrets and variables → Actions**.

Secrets (never put these in code or chat):

| Secret | Value |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` key |
| `ENCRYPTION_KEY` | The same key the Vercel app uses (32 bytes, base64) |
| `DPD_PORTAL_URL`, `DPD_USERNAME`, `DPD_PASSWORD` | The DPD portal login |
| `DPD_LOGIN_SECRET` | Only if the portal has an extra login field |
| `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` | Only once Dropbox is connected |

Variables (not secret):

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | The project URL, `https://<ref>.supabase.co` |
| `APP_URL` | The Vercel app address (optional) |
| `SYNC_WINDOW_START`, `SYNC_WINDOW_END` | Optional, default `2030` and `2129` |
| `ACTIONS_MONTHLY_LIMIT_MINUTES` | Optional, default `2000` |

## Running it by hand

**Actions → DPD nightly sync → Run workflow.** It always runs now (no time check).

* *Queue a sync now* (default on): syncs every active franchise. Fill in *report date* to re-collect a past day.
* *Explore the DPD portal*: a read-only exploration instead of a sync.

The **Sync now** button in the app only queues the job. It runs at the next
nightly run, or immediately if you start the workflow by hand.

## Free allowance

Public repositories: GitHub-hosted runners are free. Private repositories: the Free
plan includes about **2,000 Linux minutes a month** (GitHub has described this
as a dollar-based pool since late 2026; confirm the current figure on the billing
page of your GitHub account).

Expected use, estimated, not measured: a nightly run takes roughly 5 to 8
minutes, and the turned-away run takes about a minute, so **about 200 to 280
minutes a month, around 10 to 15% of 2,000**. Retries add a few minutes only on
nights something fails.

The last step of every run sums this month's Actions minutes (all workflows,
including CI) from run times, rounded up per run, and writes a table to the run
summary. It raises a **warning at a projected 80%** and an **error at 90% used**.
It is an estimate; the billing page is the authority.

## If it outgrows the free allowance

In order of cost, cheapest first:

1. Reduce the minutes: CI runs on every push count too. Trim `ci.yml` before paying for anything.
2. Make the repository public (the code holds no secrets; credentials live in GitHub secrets and Supabase). Only if you are comfortable with that.
3. A small always-on host (Render Starter or Railway hobby, roughly $5 to $7 a month) running `worker/index.ts` from `deploy/worker/Dockerfile`. The code for this already exists.

## Known limits

* Scheduled runs can start several minutes late when GitHub is busy. The window allows for this.
* GitHub turns off scheduled workflows in a **public** repository after 60 days with no repository activity.
* A run needs the Supabase project awake. Free Supabase projects pause after a week of no use.
