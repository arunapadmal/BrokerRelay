# Development commission workflow

## Deployment

The Development database has already been updated. Upload the extracted folders to the root of the development branch and deploy Netlify. Do not rerun commissions.sql on Development. Testing, Demo and Production are unchanged.

## Owner and partner steps

1. Owner: Referral partners → Commissions & payouts → Commission activation and accepted terms.
2. Request activation for an active verified partner with an accepted offer.
3. Partner: Commissions → Commission activation and accepted terms → Accept commission tracking activation. This creates a separate versioned confirmation; existing accepted offers are not edited.
4. If subscription or settlement usage is not included in the offer, revise the partner offer, obtain fresh agreement acceptance and owner activation first. Request and accept commission tracking again for the new offer. Anjana's present offer is setup-only and therefore earns no recurring commission.
5. Future sandbox invoice payment registration freezes eligible per-line entitlements. For recurring commissions, the service month must start on or after both offer effectiveness and tracking activation. Past months and existing payment contexts are not backfilled.
6. Before payment, entries display Awaiting payment and cannot be approved. Signed payment confirmation makes them available for review.
7. Owner: approve entries with a review note. Select approved entries for one partner, then Record sandbox payout with a unique reference. This records a simulated manual payout; no bank or Stripe transfer is made.
8. The partner can view their own commission and payout history. The owner can view all partners.

## Calculation and safeguards

- Eligible setup, subscription and settlement usage fees follow the exact accepted categories and percentage; GST is excluded.
- Subscription lines must match the frozen billing cycle. Settlement usage must match cycle overage quantities, unit price and settlement records. Setup requires a typed source charge and is not inferred from a description.
- Recurring rights use the existing approved transfer history at the first day of the service month. Setup remains with the original referrer. Later collection does not move an earlier service period's entitlement.
- Repeated payment events and payout requests do not duplicate entries or payouts. One-time source charges cannot be counted twice. New setup entries are not also credited to the older sandbox ledger.
- Partial refunds are allocated proportionally over invoice commission amounts. Before payout, a refund removes approval and requires fresh review. A full refund reverses unpaid entries. Original invoices and receipts remain unchanged.
- After payout, a refund creates a recovery balance. Further payouts to that partner are blocked until the owner records reconciliation using a reference. No automatic bank debit, clawback or offset is performed.
- Suspended/unverified partners cannot receive approvals or payout records. Existing entitlement history is retained.
- The entire new ledger is sandbox-only. Existing historical setup records remain separate, and dashboard live income is unchanged. No accepted agreements, existing commissions or registered invoice contexts were rewritten.

## Validation

Next.js production build and TypeScript passed. SQL tests ran in rolled-back transactions: subscription and settlement accruals, duplicate payment events, unpaid approval rejection, approval invalidation after partial refund, idempotent payout recording, refund recovery, transfer dates, partner visibility and owner-only review. Sandbox environment/signature checks passed (11 checks). Test fixtures and synthetic terms were rolled back.

## Remaining release work

After deployment, test the owner/partner activation, new future-period invoice, approval and payout UI with development accounts. Real bank payouts require a separate reviewed implementation (for example Stripe Connect onboarding and transfers). Live accrual and payout release, payee tax/GST treatment and production migration are not enabled by this development package.
