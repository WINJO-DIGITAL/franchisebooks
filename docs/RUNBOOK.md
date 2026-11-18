# Runbook: when something goes wrong

Start with **Data & Integrations** in the app. Every problem it knows about
appears there in plain English, with a suggested next step. The technical
detail is under *Technical details*; you rarely need it, but copy it when
asking a developer for help.

Nothing here can lose or corrupt your figures: imports are repeatable, stored
money cannot be deleted, and a retry never duplicates anything.

## A sync failed

**What you see:** a red or amber message under *Data & Integrations* (and on
the dashboard) such as "Tonight's DPD sync did not finish."

1. **Read the message.** It names the cause where it knows it:
   | Message says | What it means | What to do |
   | --- | --- | --- |
   | "It will be tried again automatically" | A temporary problem (slow portal, network) | Nothing. It retries after 2, 8, then 32 minutes |
   | "Could not sign in to DPD" | Password changed, account locked, or portal down | Check you can sign in to the DPD portal yourself. If the password changed, update `DPD_PASSWORD` on the worker and redeploy it |
   | "DPD asked for a security code" / "blocked" | MFA or a CAPTCHA. The system will not work around it | Use Dropbox or **Import files** for now; tell a developer |
   | "The page layout has changed" | See *The DPD portal layout changed* below | |
   | "Needs review" | A document could not be read with enough confidence | Open **Review**, check the document, approve or fix it |
2. **Press *Sync DPD*** once. If another sync is already running you will be
   told; you cannot double up.
3. **Still failing after an hour?** Check the worker is up (step below). If it
   is, forward the *Technical details* to a developer.

**Missed a night entirely?** Press *Sync DPD* and choose the date, or upload
the day's documents by hand. Imports are repeatable, so overlapping dates are
safe.

### Is the worker running?

1. Open `https://<worker-address>/health`. "OK" means yes.
2. If not: restart it on the host (Fly: `fly machine restart --config
   deploy/worker/fly.toml`; a VPS:
   `docker restart dpd-worker`).
3. Look at its logs for a line with `"level":50` (errors). Secrets are
   already removed from the log.
4. A machine that keeps running out of memory needs 1 GB or more.

Jobs that were running when the worker stopped are detected and returned to
the queue automatically within a few minutes.

### Nothing is being scheduled at all

1. Vercel → **Cron Jobs**: is the job listed, and are recent runs 200?
   A 401 means `CRON_SECRET` differs between what Vercel sends and what the
   app has; re-save the variable and redeploy.
2. Settings → *Syncing is switched on*, and the sync time is what you expect.
3. Hobby plan? Cron only runs daily there (see `DEPLOYMENT.md`, step 5). The
   worker's own timer still runs the evening sync.

## Dropbox needs reconnecting

**What you see:** "Dropbox access has stopped working. Please reconnect."

1. **Data & Integrations → Dropbox → Reconnect.**
2. Sign in to Dropbox and press *Allow*.
3. Pick the same folder(s) again if asked. Files already imported are
   recognised by their content and are not imported twice.

If *Reconnect* returns you with an error:
* "redirect_uri mismatch": the address in the Dropbox App Console must match
  `DROPBOX_REDIRECT_URL` exactly (including `https` and no trailing slash).
* The app was deleted or its secret regenerated in Dropbox: update
  `DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET` in Vercel and redeploy.
* Files not appearing: check the webhook address under **Webhooks** in the
  Dropbox App Console is `https://<your-address>/api/dropbox/webhook`. The
  regular sync still picks files up within the hour without it.

## The DPD portal layout changed

**What you see:** "DPD's page layout has changed" or documents arriving as
"unknown" or "needs review", or columns reported as unrecognised.

The system is built to stop rather than guess when a page or document does
not look the way it expects. No wrong figures are stored.

1. In the meantime, keep going with **Import files** or Dropbox.
2. Press **Explore the DPD portal** again. It records the current pages and
   columns (read-only).
3. Send a developer: the *Technical details* from the failed job, and the new
   discovery result. They will:
   * update the portal map (which page holds what), and/or
   * add any new column heading to `src/lib/ingest/columns.ts` and add a test
     document for it.
4. After the fix is deployed, press *Sync DPD* for each missed date.

If you only see "needs review" on documents, the columns may simply have
changed names: open the document in **Review**; the headings it could not
read are listed.

## Password or sign-in trouble

* **Forgotten password:** *Forgotten your password?* on the sign-in page. If
  no email arrives, check spam and that real email sending is set up
  (`DEPLOYMENT.md`, step 1.4).
* **Locked out entirely:** a developer can create a fresh sign-in with
  `npm run create-owner` (for a new address) or reset the password in the
  Supabase dashboard (**Authentication → Users**).

## "Something went wrong" page

You saw the friendly error page. Press **Try again** first. If it keeps
happening, open **Technical details**, press **Copy details** and send that
to a developer. The *Reference* number lets them find the exact error in the
logs. Your data is not affected.

## Figures look wrong

1. Open the driver or day and the **source document** (Data & Integrations →
   Imported files). Does the row match the document?
2. If not, look in **Review** and **Alerts** for an explanation.
3. Do **not** fix an import problem with a pay adjustment. Adjustments are for
   real pay changes only (see `FINANCE.md`).
4. Anything you adjust shows separately from DPD's figures and can be
   reversed; nothing is lost.

## Who to contact and what to include

Always include: what you were doing, the time, the message on screen, and the
*Technical details* (copied from the app). Never send passwords, keys or the
contents of `.env` files.

## Rotating a secret

If a secret may have leaked (a key pasted somewhere it should not be):

| Secret | Where to change | Then |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API (regenerate) | Update Vercel and the worker; redeploy both |
| `CRON_SECRET` | Vercel variables | Redeploy |
| `WORKER_AUTH_TOKEN` | Vercel **and** the worker (same new value) | Redeploy both |
| `DPD_PASSWORD` | Change it in DPD first | Update the worker; redeploy |
| `DROPBOX_APP_SECRET` | Dropbox App Console | Update Vercel; redeploy; reconnect Dropbox |
| `ENCRYPTION_KEY` | **Do not just change it**: stored Dropbox connections become unreadable | Change it, then reconnect Dropbox |
