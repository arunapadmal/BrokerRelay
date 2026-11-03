-- Only disclose whether the signed-in partner needs initial password setup.
create or replace function public.partner_password_setup_required() returns boolean
language plpgsql stable security definer set search_path='' as $$
declare me uuid:=private.partner_portal_identity();needs_setup boolean;
begin
 select length(coalesce(u.encrypted_password,''))=0 into strict needs_setup from auth.users u
 join public.m7_partner_accounts p on p.id=me and lower(p.contact_email)=lower(u.email)
 where u.id=auth.uid() and u.email_confirmed_at is not null;
 return needs_setup;
end $$;
revoke all on function public.partner_password_setup_required() from public,anon;
grant execute on function public.partner_password_setup_required() to authenticated;
