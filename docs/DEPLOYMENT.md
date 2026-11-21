# Deployment

A plain, in-order guide to putting Franchise Books by Winjo Digital live. Do the steps in
order; each one says how to check it worked. Nothing here needs you to write
code. Anything marked **(you)** needs a login or a decision only you can make.

## What you will end up with

| Part | Where | Cost note |
| --- | --- | --- |
| Web app | Vercel | Pro plan if you want the 5-minute scheduler (see step 5) |
| Database, sign-in, files | Supabase (production project) | Free plan allows two projects; if both are used, pause one or upgrade |
| Background worker (DPD portal) | GitHub Actions, every evening (see [`GITHUB_ACTIONS_WORKER.md`](GITHUB_ACTIONS_WORKER.md)) | Free within GitHub's included minutes. Fly.io, Railway or any Docker host also work if you outgrow it: a small always-on machine with at least 1 GB of memory |
| Backups | Supabase daily backups | Included on the Pro plan |

You will need these values at various points. Generate the secrets on your
own computer and keep them in a password manager; never paste them into chat,
email or the code.

```bash
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -hex 32      # CRON_SECRET
openssl rand -hex 32      # WORKER_AUTH_TOKEN
```

## 1. Production Supabase **(you)**

1. Create a new project (region: London / `eu-west-2`). Save the database
   password in your password manager.
2. **Authentication → Providers → Email**: keep email sign-in **on**, and turn
   **"Allow new users to sign up" off**. The owner is created by script
   (step 4); nobody else can register themselves.
3. **Authentication → URL Configuration**: set *Site URL* to your web app
   address (for example `https://franchise.example.com`) and add
   `https://franchise.example.com/auth/reset` under *Redirect URLs* (add the exact address, with no `?` or wildcard; password-reset emails land there).
4. **Authentication → SMTP**: configure real email sending (Resend, Postmark,
   SES…). Supabase's built-in sender is for testing only and is rate-limited;
   password-reset emails depend on this.
5. From a computer with the repository: 
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push          # applies every migration
   ```
6. **Settings → API**: note the *Project URL*, the *anon* key and the
   *service_role* key. The service role key is a master key: it goes only on
   Vercel and the worker, never in the browser or in Git.
7. **Database → Backups**: confirm daily backups are on.

Check: **Table editor** shows the tables, and **Storage** shows three private
buckets (`source-documents`, `reports`, `diagnostics`).

## 2. Vercel web app **(you)**

1. Import the Git repository as a new project. Framework: Next.js (detected).
   Production branch: `main`.
2. Add these **Environment Variables** (Production, and Preview if you use it):

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL from step 1 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
   | `APP_URL` | Your web address, no trailing slash |
   | `ENCRYPTION_KEY` | the base64 key you generated |
   | `CRON_SECRET` | the hex secret you generated |
   | `WORKER_URL` | Worker address from step 3 (add after step 3) |
   | `WORKER_AUTH_TOKEN` | the hex secret you generated (same value on the worker) |
   | `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REDIRECT_URL` | Step 6 |
   | `ERROR_WEBHOOK_URL` | Optional: an error-tracking address (step 8) |
   | `ALERT_EMAIL` | Optional: who is emailed when an error is logged (step 8) |

   **Do not add the `DPD_*` variables to Vercel.** The DPD login belongs on
   the worker only, so the web app can never see it.
3. Deploy. Add your own domain under **Settings → Domains** if you have one,
   and make sure `APP_URL` and Supabase's *Site URL* match it exactly.

Check: opening `https://<your-address>/api/health` shows
`{"status":"ok", ...}`.

## 3. The background worker **(you)**

The worker is a Docker image defined in `deploy/worker/Dockerfile`. It always
builds from the repository root. Pick **one** host. The default is GitHub Actions, so you only need this if you move off it. (This is the only worker Dockerfile; `railway.json` and `deploy/worker/fly.toml` all point at it.)

Environment variables for the worker (set them in the host's secrets screen,
**not** in a file in Git):

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, `WORKER_AUTH_TOKEN`,
`DPD_PORTAL_URL`, `DPD_LOGIN_SECRET` (only if the portal needs one; each
account's own DPD username and password are saved in the app, encrypted), `ERROR_WEBHOOK_URL` (optional). `PORT` and
`SERVICE_NAME` are already set by the image.

### Option A — Fly.io (recommended: small, UK region, simple secrets)

```bash
fly auth login
fly launch --no-deploy --copy-config --config deploy/worker/fly.toml --dockerfile deploy/worker/Dockerfile
fly secrets set --config deploy/worker/fly.toml \
  SUPABASE_SERVICE_ROLE_KEY=... ENCRYPTION_KEY=... WORKER_AUTH_TOKEN=... \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=... DPD_PORTAL_URL=... DPD_USERNAME=... DPD_PASSWORD=...
fly deploy --config deploy/worker/fly.toml --dockerfile deploy/worker/Dockerfile
```
Edit `app` and `NEXT_PUBLIC_SUPABASE_URL` in `deploy/worker/fly.toml` first.
The worker's address is `https://<app>.fly.dev`.

### Option B — Railway

New project → *Deploy from GitHub repo*. Railway reads `railway.json` at the
repository root (it points at the Dockerfile and the `/health` check). Add the
variables under **Variables**. Generate a public domain under **Settings →
Networking**.

### Option D — any VPS with Docker

```bash
docker build -f deploy/worker/Dockerfile -t dpd-worker .
docker run -d --restart unless-stopped --name dpd-worker -p 8080:8080 --env-file /secure/path/worker.env dpd-worker
```
Put it behind HTTPS (Caddy or nginx). The env file must be readable only by
you (`chmod 600`).

Run **exactly one** instance: jobs are claimed safely, but the DPD portal should
not be hit concurrently with the same login. `WORKER_AUTH_TOKEN` must be at least
24 characters (the worker refuses to start otherwise) and identical on Vercel and
the worker. If you would rather not expose the worker publicly, leave `WORKER_URL`
empty: the worker still polls the queue every minute, so the only difference is
up to a minute's delay.

Then put the worker's address in Vercel as `WORKER_URL` and redeploy.

Check: `https://<worker-address>/health` returns OK, and the container's health
status is "healthy".

## 4. The owner account **(you)**

From a computer with the repository and a `.env.local` that points at the
**production** Supabase (the three values from step 1):

```bash
npm install
npm run create-owner -- --email you@example.com
```

You will be asked for a password privately (at least 10 characters). Then
sign in on the live site; it asks for your business name and first franchise.

Do **not** run `npm run seed:demo` against production. It refuses to, but
there is no reason to try.

## 5. Scheduled jobs

`vercel.json` asks Vercel to call `/api/cron/tick` every 5 minutes. Vercel
sends `Authorization: Bearer <CRON_SECRET>`, which the route checks.

* **Hobby plan**: Vercel only allows once-a-day cron jobs and will reject a
  5-minute schedule at deploy time. Either upgrade to Pro, or change the
  schedule in `vercel.json` to once a day (for example `"30 20 * * *"`). The
  worker also runs the same tick on its own timer (every 5 minutes), so evening syncs still
  happen on time either way.
* The tick compares UK clock time with the sync time in **Settings**
  (default 20:30), so it follows GMT/BST by itself. Vercel's own clock is UTC;
  that does not matter.

Check: **Vercel → project → Cron Jobs** lists the job; after five minutes
**Logs** show `/api/cron/tick` returning 200.

## 6. Dropbox **(you)**

1. Go to <https://www.dropbox.com/developers/apps> → *Create app* → *Scoped
   access* → *Full Dropbox* or *App folder* (App folder is safer: the app can
   only see its own folder).
2. **Permissions**: tick `files.metadata.read`, `files.content.read`,
   `account_info.read`, then *Submit*.
3. **Settings → Redirect URIs**: add exactly
   `https://<your-address>/api/dropbox/callback` (and
   `http://localhost:3000/api/dropbox/callback` for local use).
4. **Webhooks**: add `https://<your-address>/api/dropbox/webhook`. Dropbox
   checks the address when you save it.
5. Copy the *App key* and *App secret* into Vercel (`DROPBOX_APP_KEY`,
   `DROPBOX_APP_SECRET`, `DROPBOX_REDIRECT_URL` = the redirect address above)
   and redeploy.
6. In the app: **Data & Integrations → Connect Dropbox**, sign in to Dropbox,
   allow access, then choose the folder(s) to watch.

While the Dropbox app is in "development" status only you (the app owner) can connect, which is all you need.

The connection token is stored encrypted. If Dropbox access is later revoked,
the app says so and shows a *Reconnect* button (see the runbook).

## 7. DPD portal **(you, then a developer)**

The integration is read-only and has three stages. **All of them have been run against the real portal** (myportal.drivers.dpd.co.uk): since November 2026 the sync reads payments, charges and self-billed invoices for live franchises. The steps below are for setting it up again or for a new portal layout.

1. Confirm your DPD franchise agreement and the portal's terms allow automated,
   read-only access. (The system never changes anything on the portal; every
   non-GET request is blocked in the browser and the automation refuses
   buttons that look like they submit or change something.)
2. **Explore.** Put `DPD_PORTAL_URL`, `DPD_USERNAME` and `DPD_PASSWORD` on the
   **worker** (and `DPD_LOGIN_SECRET` if the portal needs a second login value),
   redeploy, then press **Data & Integrations → Explore the DPD portal**, or
   locally run `npm run dpd:discover`. This signs in, follows ordinary links
   only, and writes `docs/PORTAL_INVENTORY.generated.md` describing the *shape*
   of each page (headings, table columns, file types). Complete
   `docs/PORTAL_INVENTORY.md` from it.
3. **Map.** A developer writes the *portal map* (JSON, see
   `src/lib/dpd/portal-map.ts`) from the inventory: how to reach each franchise
   and where the earnings, fuel and expense downloads are. Paste it into
   **Data & Integrations → DPD portal → Portal setup**; it is validated before saving.
4. **Calibrate parsers.** Upload 2-3 real sample documents. If one lands in
   *Needs attention* as "not recognised", add its column headings to
   `src/lib/ingest/columns.ts` (a one-line change per heading) and a test in
   `tests/unit/parse.test.ts`.
5. Press **Sync DPD**. From then on it runs every evening after the time in Settings.

If the portal asks for a code from your phone (MFA) or a CAPTCHA, the sync stops
with "needs you" and does **not** try to get round it. Use Dropbox or manual
upload instead.

## 8. Errors and monitoring

* Every server error is logged with secrets removed. In Vercel: **Logs**.
  On the worker: your host's log screen.
* Optional: set `ERROR_WEBHOOK_URL` to an error tracker's HTTP address
  (Sentry, Better Stack, Logtail…) and errors are forwarded there too.
* Set `ALERT_EMAIL` (on Vercel, and as a GitHub Actions secret for the nightly
  run) and every error logged is emailed there through Resend: the same error at
  most once an hour, and no more than 20 alert emails a day. Owners are emailed
  separately, once a night, when their DPD read fails, and at 23:00 UK time if
  a franchise still has no successful read that night.
* Add an uptime monitor (UptimeRobot, Better Stack…) on
  `https://<your-address>/api/health`; it returns 503 if the database cannot
  be reached.

## 9. Production smoke test

After every deploy, run:

```bash
npm run smoke -- https://<your-address>
```

It makes a few read-only requests and prints a tick or a cross for each:
health check, sign-in page, private pages redirect to sign-in, the scheduled
job endpoint refuses callers without the secret, data endpoints are closed,
unknown pages are handled, and no private files are served. If `WORKER_URL`
is set in your environment it also checks the worker. Exit code 0 means all
passed.

Then do what a script cannot:

1. Sign in; the Dashboard loads with no red banners.
2. Settings: add the franchise(s) (FD numbers exactly as on DPD documents).
3. Data & Integrations: upload one real earnings PDF. It is either imported or
   lands in *Needs attention* with an explanation.
4. Add a pay adjustment and confirm it. It appears on Adjustments, the original
   DPD figure is unchanged, and you can reverse it.
5. Reports: generate last month's report and download it.
6. Connect Dropbox and drop a file into the watched folder; within a minute it
   appears under Recent documents.

## 10. Local development

See the README quick start. In short: Docker + `npm run db:start`, copy the
printed keys into `.env.local`, `npm run seed:demo`, `npm run dev`. Local
Supabase catches emails at <http://127.0.0.1:54324> instead of sending them,
which is where password-reset links appear.

## Updating

* **Web**: merge to `main`; Vercel deploys. Run the smoke test.
* **Database changes**: `npx supabase db push` *before* deploying code that
  needs them. Never edit a migration that has already been applied; add a new one.
* **Worker**: on GitHub Actions nothing needs redeploying (it runs the latest `main`). On another host, redeploy it (`fly deploy …`, or push for Railway). Jobs
  that were running are returned to the queue automatically.
* Keep the Playwright version in `deploy/worker/Dockerfile` in step with
  `playwright` in `package.json`.

## Go-live checklist

- [ ] Sign-up is off in Supabase; owner created with `create-owner`
- [ ] Supabase Site URL and redirect URL match the live address
- [ ] Real SMTP configured; a password-reset email arrives
- [ ] All Vercel variables set; `DPD_*` are **not** on Vercel
- [ ] `/api/health` is `ok`; uptime monitor added
- [ ] Worker healthy; `WORKER_URL` and matching `WORKER_AUTH_TOKEN` set
- [ ] Cron visible in Vercel and returning 200
- [ ] Dropbox connected (if used) and a test file imported
- [ ] DPD permission confirmed; discovery run and portal map reviewed
- [ ] Daily backups on
- [ ] `npm run smoke` passes


## Homepage hero video
- `public/hero-demo.webm`, `public/hero-demo.mp4` and `public/hero-demo-poster.jpg` are a recording of the app on the synthetic demo account, made by `scripts/record-hero-demo.cjs`. Re-record and re-encode after any visible change to the app's main screens.
- Files ending in `.mp4` or `.webm` are excluded from the sign-in check in `src/proxy.ts`; keep them that way or the video cannot load.
