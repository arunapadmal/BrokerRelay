# BrokerRelay development rollout

Status: source build passes; development `billing-payment-setup` and
`billing-stripe-webhook` functions deployed. Netlify release and Stripe sandbox
end-to-end testing are pending account access and secret configuration.

## Netlify

Use the existing development site `brokerrelaydev.netlify.app`. Select the
repository directory containing package.json and netlify.toml as the build base.
Build command: `npm run build`. Publish directory: `.next`. Node: 22.
Netlify automatically installs its Next.js adapter. Use the committed lockfile.
Do not publish this source directory through a static drag-and-drop deployment.

Configure the four public variables in `.env.development.example` on the
development Netlify site, using its actual development publishable key.
Never put a Supabase service-role key or Stripe secret key in NEXT_PUBLIC variables.
Supabase Auth redirect URLs must allow this site's invitation and password reset
destinations. Verify sign-in, partner invitation, company onboarding, password
reset, role routing and billing after the deployment succeeds.

## Stripe sandbox: authorisation stage

In the development Supabase project's Edge Function secrets, securely set:

- STRIPE_SECRET_KEY: the chosen sandbox's sk_test_ key.
- STRIPE_PUBLISHABLE_KEY: the same sandbox's pk_test_ key.
- STRIPE_WEBHOOK_SECRET: the signing secret for this sandbox webhook endpoint.
- BILLING_ALLOWED_ORIGINS: https://brokerrelaydev.netlify.app (add localhost
  explicitly only if local testing is needed, as comma-separated origins).

Stripe webhook endpoint:
https://yhlaynvgmvfxvwhvlboq.supabase.co/functions/v1/billing-stripe-webhook

Subscribe to setup_intent.succeeded, mandate.updated and payment_method.detached.
Use an existing verified Head Broker account with a valid company billing email.
The Head Broker authorises through Company billing & invoices using Stripe's
published Australian BECS test bank details. Confirm webhook delivery succeeds,
then refresh payment status and verify the test authorisation label. Confirm
disabling authorisation clears enabled status. Never enter real bank details.

The server rejects live keys, live events and projects other than development.
It verifies webhook signatures against the raw request body, retrieves the
canonical SetupIntent and checks customer, company, mandate and current setup ID.
Test payment events deliberately do not change invoice or commission balances.
The live billing-worker is excluded and must remain disabled.

## Remaining integration stages

After authorisation succeeds, add an explicit sandbox invoice payment flow,
idempotent payment reconciliation, failure handling and receipt tests. Verify
the $25 Basic plan, three included settlements and $10 per extra settlement
against invoices and the agreed GST treatment. Existing invoicing remains the
source of settlement usage calculations; this release creates no duplicate
Stripe subscription prices or automatic debit schedule.

Live billing requires a separate reviewed release and successful sandbox tests.
No live payments or real invoice collection are enabled by this release.

## Validation

`node scripts/check-billing-sandbox.mjs` tests environment restrictions and
webhook signatures, including altered payloads, stale timestamps and secret
mismatches. `npm run build` compiles the application and checks TypeScript.
The source build used a placeholder publishable key; authenticated browser and
Stripe end-to-end tests remain pending. Deployment must use the actual public key.

Sources: https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/
and https://docs.stripe.com/payments/au-becs-debit/set-up-payment
