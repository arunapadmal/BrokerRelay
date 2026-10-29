# Development billing follow-through

The backend schema and sandbox-actions, sandbox-worker and webhook functions
are deployed. Upload the archive contents to the development branch and deploy
brokerrelaydev. Do not rerun billing-follow-through.sql; it has already been
applied. The separate enable-sandbox-worker-cron.sql script has NOT been run.

## Stripe webhook events

Keep the existing seven Snapshot events, and add charge.refunded,
refund.created, refund.updated and refund.failed. Keep the same endpoint and
signing secret. These let successful partial/full refunds adjust the invoice
and test commission. Refund requests alone never mark an invoice refunded.
Original tax invoice/receipt snapshots remain intact; refunds are separate rows.

## Email testing

Platform finance -> select a company -> Invoice payment reconciliation -> Check
email configuration. This lists missing RESEND_API_KEY and BILLING_EMAIL_FROM
settings without revealing values. Add missing settings in the DEVELOPMENT
Supabase project's Edge Function secrets. The sender must be verified in Resend.
Never put keys in GitHub or chat. The Resend domain/sender setup and inbox delivery
have not yet been verified.

Email test receipt to me / Email failure test to me sends ONLY to the verified
signed-in Platform Owner, with a clear sandbox/no-money-collected label. No
company billing recipient, demo address, or arbitrary address can be supplied.
A provider-accepted response is not proof of inbox delivery. Check the owner's
inbox and spam folder. Repeated submission is blocked once accepted. Ambiguous
requests outside the 20-hour provider-idempotency window require review.

## Retry and refunds

Retry test payment reconfirms the same failed PaymentIntent with Stripe's success
test bank details. It cannot create another PaymentIntent or retry an already
successful/processing payment. Refund half remaining / Refund remaining test
amount submits an idempotent sandbox refund. Refresh after Stripe confirms it.
Refunds reduce the test commission proportionally, rounded to cents. Full refund
reverses the commission. Sandbox amounts never enter real gross income/payouts.
No commission approval, partner payout, or live bank debit is enabled.

## Positive commission fixture

XYZ invoice BR-000016 is a test-only $100 setup fee + $10 GST. Anjana's accepted
setup-only agreement should accrue $20 test commission after a successful Stripe
payment. The artificial 2199 period and far-future due date isolate it from normal
monthly cycles and overdue checks. This fixture is not a real fee. Its source
charge and invoice are clearly labelled sandbox. Select XYZ, run Test success,
then verify the receipt and Anjana's separate sandbox commission section.
A half refund should deduct $10 test commission; full refund should reverse it.
The fixture was created; its Stripe payment has NOT yet been run.

## Monthly generation and scheduled collection

Existing maintenance job brokerrelay-billing-daily is active at 20:15 UTC daily
(07:15 Melbourne during daylight saving; 06:15 during standard time). It creates
invoices for completed calendar months, including on the first day of a month.
The existing company start month and versioned plan/pricing rules remain in force.

The new sandbox worker is deployed but NOT scheduled. To enable it:
1. Generate a strong random token outside chat. Save it as BILLING_WORKER_TOKEN
   in development Edge Function secrets.
2. Save the same value in development Supabase Vault under the name
   brokerrelay_sandbox_worker_token. Keep the token out of SQL source and chat.
3. Run enable-sandbox-worker-cron.sql once in the development SQL editor. The
   command refers to Vault at runtime and never embeds the token in source.

Use a fresh unpaid invoice for a company whose Head Broker has saved a ready,
enabled test authorisation. Prepare seven-day collection, then Email test invoice
notice to me. Receipt of that provider-accepted notice starts the waiting period.
Only explicitly opted-in invoices with a matching unchanged test mandate/customer
can be claimed. Collection waits at least seven days AND until debit_at. The
worker only uses sk_test_ keys and the development project. A changed invoice,
changed/disabled mandate, duplicate lease or old ambiguous request blocks collection.
No seven-day wait is bypassed in the deployed worker. Tests simulate dates only
inside rolled-back SQL transactions, with no real provider requests.

## Verification and remaining work

Next.js build/TypeScript and 11 environment/signature checks pass. Database tests
run as service_role and roll back all fixtures: success, failure, duplicate events,
one receipt, correct setup/GST commission, partial/full refund, stale refund,
no duplicate email claim, seven-day notice, no early collection, due collection
lease, duplicate worker claim and old ambiguous request rejection. Anonymous and
browser roles cannot directly reconcile refunds, claim emails or claim collections.

Pending end-to-end checks: sender configuration and inbox delivery; Stripe retry
and refund events; positive Anjana commission fixture; live execution of the Cron
worker after secure token setup and notice waiting period. No emails/refunds/live
charges were sent by this implementation task. Live Stripe keys, production
configuration, real automatic billing and partner payout require a separate
reviewed release after sandbox checks pass. Dispute/chargeback handling and final
live readiness/security review remain outstanding.
