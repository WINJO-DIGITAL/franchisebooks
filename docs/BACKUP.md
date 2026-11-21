# Database backups

The free Supabase plan keeps no backups of its own, so `.github/workflows/backup.yml` makes one every day.

## What is copied
- Every day at about 03:15 UTC, a full copy of the database's `public`, `auth` and `app_private` schemas.
- It is encrypted (AES-256, with a passphrase only the owner holds) before it leaves the runner.
- It is stored as a GitHub Actions artifact and kept for 14 days. GitHub deletes it after that.

## What is not copied
- **Uploaded files** (the DPD documents and report PDFs kept in Supabase Storage). A database copy does not include them. They can be rebuilt from DPD by a re-read, but manual uploads cannot. Copying storage is a separate job we have not built.
- Anything older than 14 days.

## One-time setup (owner)
1. **Passphrase.** Choose a long passphrase and keep a copy somewhere safe, not only in GitHub. Without it the backups cannot be opened.
2. **Connection string.** In Supabase, open the franchisebooks project, press Connect, and copy the *Session pooler* connection string (the one with `pooler.supabase.com` and port 5432). Use the database password, not the service key.
3. In GitHub, open the repository's Settings, then Secrets and variables, then Actions, and add two repository secrets:
   - `SUPABASE_DB_URL`: the connection string from step 2.
   - `BACKUP_PASSPHRASE`: the passphrase from step 1.
4. Open the Actions tab, choose "Database backup", and press Run workflow. Check it finishes green and that an artifact appears.

## Restoring
Restore into an empty project, never over the live one.

1. Download the artifact (from the run in the Actions tab) and unzip it. You get `database.dump.enc` and `database.dump.enc.sha256`.
2. Check the file: `sha256sum -c database.dump.enc.sha256`.
3. Decrypt it: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass prompt -in database.dump.enc -out database.dump` (it asks for the passphrase).
4. Restore into the empty project, using its session pooler string:
   `pg_restore --no-owner --no-privileges --clean --if-exists --dbname "<pooler string for the empty project>" database.dump`
   (run it from a Postgres 17 client, for example `docker run --rm -v "$PWD:/b" postgres:17 pg_restore ...`).
5. Compare row counts for the main tables (`drivers`, `daily_earnings`, `earnings_adjustments`, `franchises`) between the restored copy and the live database.

Tested: not yet. Run one restore before relying on this.
