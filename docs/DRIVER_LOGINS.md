# Driver logins

A driver can sign in and see their own days and pay for each four-week period, and nothing else.

## What a driver sees (`/my`)
Their days (route, stops, parcels, miles), what each day paid them, their pay adjustments and a total. Never the franchise's income,
expenses or profit, and never other drivers. A day shows "Not set" until the driver's pay rate has been set.

## How it is kept safe
- A driver login has **no business profile**. Every access rule in the database is built from the signed-in user's business
  profile, so a login without one reads nothing from any business table (tested in `tests/db/security.test.ts`).
- The database refuses to give one login both a driver link and a business profile, in either direction.
- The driver's page reads through the server, for the account and driver recorded in their own link only. Nothing in the address or
  a form can choose a different driver.
- Only the owner can invite or remove a driver's access, from the driver's page.

## One setting needed in Supabase
Invitations arrive by email. In Supabase go to **Authentication → Email Templates → Invite user** and set the link to use a token hash,
so the app can finish the sign-in:

```
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/reset-password">Set your password</a>
```

Also make sure `{{ .SiteURL }}` is the app's address (Authentication → URL Configuration), and that the redirect URL
`https://<your app>/auth/confirm` is allowed.

## Migration
Run `supabase/migrations/20261118001000_driver_logins.sql` before using this.
