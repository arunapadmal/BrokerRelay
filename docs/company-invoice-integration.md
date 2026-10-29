# Company invoice reconciliation — development sandbox

Backend database changes and Edge Functions are already deployed to development.
Upload this archive's contents to the development GitHub branch and redeploy
brokerrelaydev. Do not run the SQL again. No secrets are included.

As Platform Owner, open Platform finance, select a company, and find Invoice
payment reconciliation below the direct-debit section. Select Test success or
Test failure on an unpaid development invoice. Confirm the sandbox acknowledgement.
This changes that selected invoice's development financial state, marking it as a
sandbox test. Use a disposable demo invoice; no real money will be collected.
Refresh financial results after Stripe confirms the payment. The normal invoice
list can be refreshed/reopened to update its paid/unpaid balance.

Success records the invoice as paid, creates one TEST-R receipt and records any
eligible test commission. Failure keeps the invoice unpaid and records a failed
payment status. The same invoice cannot be submitted for another test after its
PaymentIntent is recorded; choose another disposable invoice for the other test.

Receipts preserve the invoice snapshot, gross amount, GST and Stripe reference.
A receipt-email outbox entry is created but HELD for review in sandbox. This
release does not send receipt emails. The existing live worker stays disabled.
Actual email delivery and provider configuration need a separate controlled test.

Commission uses the agreement version accepted before the invoice was issued,
its fee categories and rate. Source charge IDs and categories are included on
new invoices. No description matching or retroactive commission guessing is used.
Anjana's current agreement covers setup fees at 20%, excluding GST. Monthly
subscriptions and settlement overages therefore generate no commission under
that agreement. Companies without an accepted active partner earn no commission.
Draft demo partners are not eligible. Historical untyped fees require review.
Test commission entries appear separately in the partner dashboard and are
excluded from real gross income and payouts. No commission approval or payout
is automated. Refund/reversal handling must be implemented and tested before
live commissions are enabled.

Checks passed: rolled-back database fixtures verify success, failure, duplicate
webhook delivery, no paid-status regression, live-mode rejection, amount mismatch,
one receipt, a held receipt-email entry, $100 setup at 20% = $20 commission
excluding GST, and zero commission for a direct company. Fixtures leave no
persisted invoices, receipts or commissions. Frontend build/TypeScript and 11
sandbox/signature checks passed. Signed Stripe end-to-end testing of actual
company invoices is pending this frontend deployment. The earlier independent
sandbox payment tests already passed.

Keep the existing Stripe Snapshot webhook and its seven selected events. No new
Stripe keys or webhook destination is needed. If using Supabase CLI later, the
billing-invoice-test function uses verify_jwt=false because it validates the bearer
token via Auth and checks Platform Owner membership inside the function.
