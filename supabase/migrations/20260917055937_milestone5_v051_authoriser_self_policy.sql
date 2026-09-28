drop policy if exists announcement_company_authorisers_select_self on public.announcement_company_authorisers;
create policy announcement_company_authorisers_select_self
on public.announcement_company_authorisers
for select
to authenticated
using (user_id=(select auth.uid()));
-- Direct table grants remain revoked. Application access continues through authorised RPCs.;
