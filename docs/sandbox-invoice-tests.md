# Sandbox invoice payment tests

The development database table and both Edge Functions are already deployed.
Upload this archive's contents to the development GitHub branch, then redeploy
brokerrelaydev. No package installation is needed.

In the existing Stripe sandbox webhook, retain the three authorisation events
and add payment_intent.processing, payment_intent.succeeded,
payment_intent.payment_failed and payment_intent.canceled. Use Snapshot payload.
Keep the same endpoint and existing signing secret.

Sign in as Platform Owner, then visit /platform/billing-test.
Run each success and failure test once, wait briefly, and Refresh results.
Each run represents a fixed AUD $27.50 sandbox invoice fixture ($25 + $2.50 GST).
The success run should become paid and the failure run should become failed.
Webhook received must show Yes. Capture the displayed Stripe references when
reporting any issue. Repeated webhook deliveries cannot create another ledger row
or regress a terminal result. Buttons start a new test each time.

This page tests Stripe and a separate sandbox ledger only. It does not settle
company invoices, send receipts, accrue commissions or enable the live worker.
Real invoice reconciliation and commission/receipt integration remain separate
work after these tests pass. Do not run the SQL again; it was already applied.

If deploying the new function through the CLI later, disable gateway JWT
verification for billing-sandbox-test: the function authenticates the bearer token
with Supabase Auth and checks Platform Owner membership internally.

Validation: Next.js build and TypeScript pass; 11 environment/signature checks
pass. RLS is enabled, anonymous reads are denied, and authenticated clients have
no write privileges on the sandbox ledger. Stripe end-to-end runs are pending.
