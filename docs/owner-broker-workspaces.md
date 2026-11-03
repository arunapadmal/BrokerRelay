# Owner and BrokerDesk workspace update

## Deploy to Development

Extract the ZIP and upload its contents to the root of the development branch, replacing the existing files. Deploy Netlify. The Development database search functions have already been installed: do not rerun workspace-search.sql there. No environment variables, Stripe settings or billing automation changes are required. Testing/Demo/Production are unchanged.

## Platform Owner

The left navigation now expands Companies, Partners, Finance, Operations and Settings. Each subsection has its own URL. Company list, company invitations and onboarding history are separate. Company rows open the existing full company page. Billing settings are split into Pricing, Supplier details & fees, and Billing automation. Invoices & payments starts with a searchable company directory. Commissions, payout history and refund recoveries have their own destinations. Partner details open in a side panel. The attention queue has search, category filters and pagination; billing delivery history is a separate paginated page. The dashboard retains four tiles with a short attention preview.

## BrokerDesk

BrokerDesk and Company & staff are separate expandable groups. Company details, Staff & roles, Staff invitations, Mobile appearance, Delivery settings, Billing & invoices and Head Broker handover appear only for the applicable existing roles. Client team remains a daily-work item because it controls client service assignments, not company staff.

Clients, Applications, Messages and Document requests have server-side search and 20-row pagination. Applications search client name, application number, description and lender, with status filters. Document requests have pending/completed-related filters and direct links to client request history. Messages has an unread filter and a conversation list alongside the existing chat. New actions search for a client rather than loading an unbounded select menu. Client profiles retain greeting preferences and shortcuts. Staff directory and company lists are paginated. The BrokerDesk dashboard shows a five-client preview with View all.

The existing company palette, typography, cards, inputs and buttons are retained. Navigation groups use keyboard-accessible disclosure controls. Side panels have their own scrolling and a Close action. On narrower screens the navigation becomes a stacked disclosure menu and the message panes stack.

## Verification

- Next.js production build and TypeScript passed for the new routes.
- Navigation rendering checks passed for ordinary brokers, delegated staff, Head Brokers, owner active links and all owner menu destinations.
- Database searches tested under actual Head Broker and broker identities: result bounds, distinct pages, search filtering and visible-client row checks passed. An unrelated identity returned no records. Brokers cannot access owner delivery history; anonymous execution is denied.
- Search functions use SECURITY INVOKER and existing RLS. Broker/client access policies were not expanded. Owner-only billing delivery history adds read access to display metadata columns; tokens, destinations and delivery changes remain restricted.
- No messages, invitations, loan statuses, commissions or payment records were changed by testing.

## Browser checks after deployment

Sign in as owner, Head Broker and broker. Verify active navigation, company/partner list search, staff detail panel, application selection, document request links, new conversation creation, unread refresh and message sending. Check desktop and narrow-screen layouts. Signed-in browser interaction and visual QA remain to be completed after deployment.
