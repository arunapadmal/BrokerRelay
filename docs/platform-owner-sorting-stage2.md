# Stage 2 — Platform Owner sorting verification

Branch: `feature/platform-owner-server-sorting-stage2`.

## Scope
- `platform_sorted_companies` and `platform_sorted_partners` return an ordered, paginated list of IDs plus the filtered total.
- Company list: 10 per page; partner list: 20 per page.
- Search, filters, direction, numeric client/application/settlement and referral/managed counts are computed **before** the page boundaries in PostgreSQL.
- Existing owner-only overview/dashboard RPCs remain the authority for access and detail data. Both new functions use SECURITY INVOKER and are not callable by anon.
- Existing dashboard data is still loaded for detail panels and auxiliary actions. Thus this is server-side **page selection and ordering**, but it does not yet eliminate the full dashboard data fetch.

## Database test completed (transaction rolled back)
Tested on brokerrelay-dev using temporary definitions inside BEGIN/ROLLBACK, with a simulated, valid platform-owner session:
- Companies: 20 total, first page 10 and second page 10, distinct IDs.
- Partners: six total; reverse name order changes row order.
- Month settlement ordering executes; manager + accepted-agreement filter returned one result.
- Anonymous EXECUTE denied for both functions; authenticated EXECUTE granted.
- Functions were absent after rollback, confirming no persistent DB changes.

## Deploy sequence
1. Keep development and production untouched until PR is reviewed.
2. Apply `supabase/migrations/20261121020000_platform_owner_server_sorting.sql` to the brokerrelay-dev environment only, following the established manual SQL + migration-history repair workflow; never run db push while other legacy migration history differences remain unresolved.
3. Manually confirm each RPC under the real Platform Owner account.
4. Build the Next.js development branch using `npm ci && npm run build`. A build was not possible in the agent environment because outbound GitHub DNS access was unavailable.
5. Verify search/filter/sort/page on desktop and mobile, all-time vs this-month performance, company/partner detail actions, CRM Import v5, and that non-owner accounts cannot use the RPC.
6. After passing, merge to development and deploy the verified branch via Netlify.

Do not copy this migration to production or modify Netlify settings without separate approval.
