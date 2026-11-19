# Billing, sign-up and onboarding

How a new customer goes from the front page to a filled-in dashboard, and what to switch on to run it.

## The customer's path

1. **Front page** (`/`, shown to anyone not signed in): what it does, £49 a month per account, Get started.
2. **Create an account** (`/signup`): email and a password of at least 10 characters.
3. **Subscribe** (`/subscribe`): Stripe Checkout for the monthly plan. Stripe tells the app by webhook; the page moves on by itself.
4. **Set up** (`/onboarding`): business name, all their FD numbers, and their DPD login (saved encrypted).
5. **Connecting** (`/connecting`): a read of DPD is queued for every franchise at once and the screen follows the real jobs, then opens the dashboard.
6. **Every night after that**, the scheduler reads DPD at the time set in Settings (default 20:30 UK time), and a report is made the Monday after each four-week period.

Pricing is **per account**, however many franchises it holds.

## What the app needs

| Setting | What it is |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_test_...` while testing, `sk_live_...` when live) |
| `STRIPE_PRICE_ID` | The recurring £49 monthly price (`price_...`) |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of the webhook endpoint (`whsec_...`) |
| `APP_URL` | The public address of the app, for Stripe's return links |
| `BILLING_ENFORCED` | `true` to require a paid subscription. Leave unset until everything below is done |

Set these on the web app (Vercel). The background worker does not need them.

## Switching billing on (in this order)

1. **Run the migrations** `20261118000600_billing.sql` (and the earlier ones from the same day). It marks everyone who already has a business as *comped*, so nobody is locked out when billing is enforced.
2. **Stripe:** create the product and the £49 monthly price (a sandbox one already exists for testing: see the build notes). The business is not VAT registered, so £49 is the full price with no VAT. Set the price's tax behaviour to "exclusive" or "not taxable" to match, and do not add VAT to invoices.
3. **Webhook:** in Stripe add an endpoint `https://<your app>/api/stripe/webhook` listening to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
4. **Customer portal:** in Stripe settings enable the customer portal, so *Manage billing* (under Settings) can open it.
5. **Supabase (production):** Authentication → turn **sign-ups on**, and turn **email confirmation on** so addresses are verified. Add `https://<your app>/auth/confirm` to the redirect URLs.
6. **Test end to end** in Stripe test mode with the test card `4242 4242 4242 4242`: sign up, subscribe, set up, watch the connecting screen.
7. Set `BILLING_ENFORCED=true`.

## Emails

Service emails (a failed nightly read, a failed payment, a closure request) are sent through Resend. Set `RESEND_API_KEY` and `EMAIL_FROM` on Vercel (a sender address on a domain you have verified in Resend). Until both are set, nothing is sent and the attempt is logged.

## Notes

* Access follows the **owner's** subscription: an account's other users never need their own.
* A subscription that is `past_due` keeps access while Stripe retries the card; `canceled` and `unpaid` do not.
* If a customer's DPD login is refused, or DPD asks for a verification code, the connecting screen says so and offers *Try again*. The sync never tries to get round a verification step.
* Only the current four-week period is read on first connect. Earlier periods are not back-filled automatically.
