# Billing, sign-up and onboarding

How a new customer goes from the front page to a filled-in dashboard, and what to switch on to run it.

## The customer's path

1. **Front page** (`/`, shown to anyone not signed in): what it does, from £49 a month per account, Get started.
2. **Create an account** (`/signup`): email and a password of at least 10 characters.
3. **Subscribe** (`/subscribe`): Stripe Checkout for Essential or Max. Stripe tells the app by webhook; a loading screen waits for it, then a Payment Confirmed screen moves on to set-up.
4. **Set up** (`/onboarding`): business name, all their FD numbers, and their DPD login (saved encrypted).
5. **Connecting** (`/connecting`): a read of DPD is queued for every franchise at once and the screen follows the real jobs, then opens the dashboard.
6. **Every night after that**, the scheduler reads DPD at the time set in Settings (default 20:30 UK time), and a report is made the Monday after each four-week period.

Pricing is **per account**, however many franchises it holds.

## The two plans

| Plan | Price | What it adds |
| --- | --- | --- |
| Essential | £49 a month | Nightly DPD reads, driver pay, expenses, period reports |
| Max | £99 a month | DPD figures over the current and previous UK tax year, and the Insights pages: trends, driver performance, rate checks |

The plan's stored value is `standard` (the database and code), shown to people as Essential.

Max is records and reports only. It never produces ledgers, reconciliations, accounts, tax or VAT figures.

* The plan is recorded by the webhook from the Stripe price bought (`user_billing.plan`), and read with `billing_plan()`.
* **History reads:** for a Max account the nightly scheduler queues up to six past periods per franchise per night, newest first,
  after that night's normal reads. A period DPD no longer lists is recorded as not available (never zero) and not asked for again;
  a period whose reads fail three times is left alone. A Max account's first history reads also start after set-up and on upgrade.
* **Changing plan:** Settings, then Manage Billing, opens Stripe's portal, which allows switching between the two prices
  (differences are prorated on the next invoice).

## What the app needs

| Setting | What it is |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_test_...` while testing, `sk_live_...` when live) |
| `STRIPE_PRICE_ID` | The Essential plan's recurring £49 monthly price (`price_...`) |
| `STRIPE_MAX_PRICE_ID` | The Max plan's recurring £99 monthly price. Leave unset until the plans migration is applied: Max is offered only once it is set |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of the webhook endpoint (`whsec_...`) |
| `STRIPE_PORTAL_CONFIGURATION_ID` | The customer portal set up for Franchise Books (`bpc_...`). The Stripe account is shared with other WINJO Digital products, so its default portal is not ours |
| `STRIPE_MODE` | `live` to use the live settings below; anything else (or unset) uses the test ones |
| `STRIPE_SECRET_KEY_LIVE`, `STRIPE_PRICE_ID_LIVE`, `STRIPE_MAX_PRICE_ID_LIVE`, `STRIPE_WEBHOOK_SECRET_LIVE`, `STRIPE_PORTAL_CONFIGURATION_ID_LIVE` | The live versions. In live mode only these are read, never the test ones, so the two can never be mixed |
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

## Switching Max on (in this order)

1. Apply the migration `20261119000500_billing_plans.sql` (`npx supabase db push`). Until then a subscription is still recorded,
   but without its plan, so Max must not be offered yet.
2. Set `STRIPE_MAX_PRICE_ID`, then redeploy. The subscribe page now shows Max.
3. In Stripe, let the customer portal switch between the Essential and Max prices.

Test mode is already set up: Essential `price_1UdcyRLEEs7hsljuoxp2M8m8`, Max `price_1Ude0fLEEs7hsljuOkJEGuQb`, webhook endpoint
`we_1UddIlLEEs7hsljurkjjuGy7`, and portal `bpc_1UddOULEEs7hsljunmvUshmE` with plan switching on. Live mode needs the same four.

## Going live

Everything except the secret key is already in place on Vercel and in Stripe's live mode:

| Live setting | Value |
| --- | --- |
| Essential price | `price_1UdKwgLEEs7hsljutoMiqcgM` (£49 a month) |
| Max price | `price_1UdiOgLEEs7hslju2TlK2IKE` (£99 a month) |
| Webhook endpoint | `we_1UdiPuLEEs7hsljuekFwuBLe`, **disabled until go-live**, its secret saved as `STRIPE_WEBHOOK_SECRET_LIVE` |
| Customer portal | `bpc_1UdiQOLEEs7hsljuIpbZ8YsV` (Franchise Books only, plan changes on) |

To go live:

1. In Stripe (live mode), Developers → API keys: create a restricted or secret key, and add it on Vercel as `STRIPE_SECRET_KEY_LIVE` (sensitive, production).
2. Switch the live webhook endpoint `we_1UdiPuLEEs7hsljuekFwuBLe` on (Stripe, Developers → Webhooks), or ask the assistant to.
3. Set `STRIPE_MODE` to `live` on Vercel and redeploy.
4. Subscribe once with a real card, check Settings shows the plan, then refund and cancel it in Stripe.

To go back to test mode, remove `STRIPE_MODE` and redeploy. Test subscriptions do not carry over to live mode: anyone who
subscribed in test mode subscribes again (comped accounts are not affected).

## Emails

Service emails (a failed nightly read, a failed payment, a closure request) are sent through Resend. Set `RESEND_API_KEY` and `EMAIL_FROM` on Vercel (a sender address on a domain you have verified in Resend). Until both are set, nothing is sent and the attempt is logged.

## Notes

* Access follows the **owner's** subscription: an account's other users never need their own.
* A subscription that is `past_due` keeps access while Stripe retries the card; `canceled` and `unpaid` do not.
* If a customer's DPD login is refused, or DPD asks for a verification code, the connecting screen says so and offers *Try again*. The sync never tries to get round a verification step.
* Only the current four-week period is read on first connect. Earlier periods are not back-filled automatically.

## Plan changes
- Max features are checked against the account's plan each time they are used (`currentPlan` for pages, `accountPlan` for the worker). Nothing is switched on or copied when an account upgrades, and nothing has to be removed by hand when it downgrades: the next page view or job sees the new plan.
- Upgrades and downgrades reach the app through the Stripe webhook (`customer.subscription.updated` and `.deleted`), which updates `user_billing.plan`.
- On Max only: history reads (queued each night and when a new franchise appears), Insights pages, the Sliding Scale Report, the Sliding Scale Discrepancy report and its automatic generation.
- A history read queued while the account was on Max is not run after a downgrade; it is recorded as blocked, so it is not counted as read and the history is filled in again if the account upgrades later.
- Reports and history already stored stay in the account. Only access to Max features stops.
