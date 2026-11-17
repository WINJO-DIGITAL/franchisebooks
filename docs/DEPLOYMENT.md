# Deployment guide

Two things are deployed: the **web app** (Vercel) and the **background worker** (any Docker host). Both talk to one **Supabase** project.

> Nothing in this guide has been run against production. The steps below were written from the code and tested locally (see DEVELOPMENT.md → "What has and has not been tested").

## 0. What you need

| Item | Where from |
| --- | --- |
| Supabase project | supabase.com. The Free plan allows two active projects; if both are used, pause one or upgrade. |
| Vercel account/project | vercel.com, connected to this GitHub repository |
| A Docker host for the worker | Railway, Fly.io, Render or any VPS (≈1 GB RAM is enough) |
| Dropbox app | dropbox.com/developers (see §4) |
| DPD portal login (authorised) | From DPD. **Check that automated access is permitted by your franchise agreement and the portal terms first.** |

## 1. Supabase

1. Create a project in the **eu-west-2 (London)** region if you can (data stays in the UK). Note the project URL, the `anon` key and the `service_role` key (Settings → API).
2. Apply the schema. With the Supabase CLI:
   ```
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
   This runs the five files in `supabase/migrations/` in order (schema → guards & audit → row level security → functions → storage buckets).
3. Authentication → Providers → Email: keep **Confirm email** on, and **turn off "Allow new users to sign up"** (Authentication → Sign In / Providers). The app is for you and your team only; accounts are created by you.
4. Authentication → URL configuration: set **Site URL** to your production URL, and add `https://<your-domain>/auth/confirm` to **Redirect URLs** (used by password-reset emails).
5. Optional but recommended: set up a custom SMTP sender (Authentication → SMTP) so reset emails come from your own address.
6. Create your login and business (run from a trusted machine; the password is read from the environment, not typed on the command line):
   ```
   export NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   export NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
   export SUPABASE_SERVICE_ROLE_KEY=<service role key>
   OWNER_PASSWORD='a long passphrase' npm run create-owner -- --email you@example.com --name "Your Name" --business "Your Business" --fd <FD number>
   ```
7. Storage: the three buckets (`source-documents`, `reports`, `diagnostics`) are created by the migration and are private. Nothing else is needed.
8. Back-ups: on the Pro plan enable daily backups / point-in-time recovery. On Free there are no automatic backups — export regularly.

## 2. Web app on Vercel

1. Import the repository in Vercel. Framework: Next.js (detected). `vercel.json` sets the London region and the cron schedule.
2. Set these **Environment Variables** (Production):

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service role key (**Sensitive**) |
   | `APP_URL` | `https://<your-domain>` |
   | `ENCRYPTION_KEY` | `openssl rand -base64 32` |
   | `CRON_SECRET` | `openssl rand -hex 32` — Vercel sends it automatically as `Authorization: Bearer …` |
   | `WORKER_URL` | the worker's public URL (§3) |
   | `WORKER_AUTH_TOKEN` | `openssl rand -hex 32` (same value on the worker) |
   | `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REDIRECT_URL` | from §4 |

   **Do not** set `DPD_*` variables on Vercel. The portal credentials live on the worker only.
3. Deploy. Check `https://<domain>/api/health` returns `{"ok":true}`.
4. **Cron.** `vercel.json` calls `/api/cron/tick` every 5 minutes. Vercel Hobby only allows daily cron jobs: on Hobby either upgrade to Pro, or rely on the worker's own timer (it runs the same tick every 5 minutes — §3) and change the schedule to `0 6 * * *`. Either way the schedule is stored in the database as a **UK local time** (Settings → Schedule), so BST/GMT is handled for you.
5. Lock down: in Vercel → Settings → Deployment Protection, enable protection for preview deployments so previews with real data are not public.

## 3. Background worker

The worker runs the browser automation for the DPD portal (Playwright/Chromium), the scheduler tick, and the lighter jobs.

1. Build and run from the repository root:
   ```
   docker build -f worker/Dockerfile -t dpd-worker .
   ```
2. Deploy the image to your host and set:

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | as above |
   | `ENCRYPTION_KEY` | **same** value as Vercel |
   | `WORKER_AUTH_TOKEN` | **same** value as Vercel (≥ 24 characters; the worker refuses to start otherwise) |
   | `DPD_PORTAL_URL`, `DPD_USERNAME`, `DPD_PASSWORD` | your authorised portal login |
   | `DPD_LOGIN_SECRET` | only if the portal needs an extra login field |
   | `LOG_LEVEL` | `info` |
   | `ERROR_WEBHOOK_URL` | optional error tracker endpoint |

   The worker exposes `GET /health` and `POST /run` (bearer token). Give it a public HTTPS URL and set that as `WORKER_URL` on Vercel. (If you would rather not expose it, leave `WORKER_URL` empty: the worker still polls the queue every minute, so the only difference is up to a minute's delay.)
3. Keep **exactly one** instance running. (More would be safe — jobs are claimed with `SKIP LOCKED` — but the portal should not be hit concurrently with the same login.)
4. `railway.example.toml` shows the settings for Railway. On Fly.io/Render use the same Dockerfile and health check path `/health`.

## 4. Dropbox

1. dropbox.com/developers → **Create app** → *Scoped access* → *Full Dropbox* (or *App folder* if you prefer to keep everything in one folder).
2. Permissions tab — enable exactly: `account_info.read`, `files.metadata.read`, `files.content.read`. (The app only ever reads.) Press **Submit**.
3. Settings tab:
   - **Redirect URIs**: `https://<your-domain>/api/dropbox/callback`
   - **Webhook URI**: `https://<your-domain>/api/dropbox/webhook` (Dropbox verifies it immediately; the app must already be deployed with the secrets set).
4. Copy the **App key** and **App secret** into Vercel (`DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`), set `DROPBOX_REDIRECT_URL` to the redirect URI above, and redeploy.
5. In the app: **Data & Integrations → Connect Dropbox**, approve, then **Choose a folder to watch**.
6. While the app is in Dropbox's "development" status only you (the app owner) can connect. That is all you need.

## 5. DPD portal

The integration is read-only and has two stages. Neither has been run against the real portal yet.

1. **Explore.** Set the `DPD_*` variables on the worker (or in a local `.env.local`) and either press **Data & Integrations → Explore the DPD portal**, or run:
   ```
   npm run dpd:discover
   ```
   This signs in, follows ordinary links only, and writes `docs/PORTAL_INVENTORY.generated.md` describing the *shape* of each page (headings, table columns, file types). Complete `docs/PORTAL_INVENTORY.md` from it.
   - If the portal asks for MFA or a CAPTCHA the run stops and says so. It will not work around either. Use Dropbox or manual upload instead.
2. **Map.** A developer writes the *portal map* (JSON — see `src/lib/dpd/portal-map.ts`) from the inventory: how to reach each franchise and where the earnings/fuel/expense downloads are. Paste it into **Data & Integrations → DPD portal → Portal setup**. It is validated before saving.
3. **Calibrate parsers.** Upload 2–3 real sample documents. If one lands in *Needs attention* as "not recognised", add its column headings to `src/lib/ingest/columns.ts` (a one-line change per heading) and the tests in `tests/unit/parse.test.ts`.
4. Press **Sync DPD**. From then on it runs every evening after the time in Settings.

## 6. Smoke test after deployment

1. Sign in → Dashboard loads; no red banners.
2. Settings → add the franchise(s) (FD numbers exactly as on DPD documents).
3. Data & Integrations → upload one real earnings PDF → it is either imported or lands in *Needs attention* with an explanation.
4. Add a pay adjustment → confirm → it appears on Adjustments and the original DPD figure is unchanged; reverse it.
5. Reports → generate last month's report → download.
6. `curl -i https://<domain>/api/cron/tick` → `401`. `curl -i -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/tick` → `200`.
7. `curl https://<worker>/health` → `{"ok":true,…}`.
8. Connect Dropbox; drop a file into the watched folder; within a minute it appears under Recent documents.

## 7. Local development

```
npm install
npx supabase start -x realtime,studio,edge-runtime,logflare,vector,imgproxy,supavisor   # needs Docker
cp .env.example .env.local        # then fill the Supabase values printed by `npx supabase status -o env`
npm run db:types                  # regenerate DB types after a schema change
npm run seed:demo                 # synthetic demo business: demo@example.test / demo-password-123
npm run dev                       # http://localhost:3000
npm run worker                    # (optional) the background worker
```

Tests: `npm test` (unit), `npm run test:db`, `npm run test:integration` (need the local Supabase stack), `npm run build && npm run test:e2e` (browser journeys; needs the demo data).
