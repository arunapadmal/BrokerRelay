-- PL/pgSQL RETURNS TABLE columns are variables. Qualify auth.users columns to
-- prevent the output parameter "id" from shadowing an unqualified column.
create or replace function public.platform_list_companies()
returns table(id uuid,name text,legal_name text,abn text,status text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_platform_admin() or not exists
    (select 1 from auth.users u where u.id=(select auth.uid()) and lower(u.email)='aruna@aidez.com.au') then
    raise exception 'PLATFORM_OWNER_REQUIRED' using errcode='42501';
  end if;
  return query select o.id,o.name,o.legal_name,o.abn,o.status::text
    from public.organisations o order by o.created_at;
end $$;

create or replace function public.platform_list_company_invitations()
returns table(id uuid,head_name text,head_email text,head_mobile text,status text,created_at timestamptz,expires_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_platform_admin() or not exists
    (select 1 from auth.users u where u.id=(select auth.uid()) and lower(u.email)='aruna@aidez.com.au') then
    raise exception 'PLATFORM_OWNER_REQUIRED' using errcode='42501';
  end if;
  return query select i.id,i.head_name,i.head_email,i.head_mobile,i.status,i.created_at,i.expires_at
    from public.company_setup_invitations i order by i.created_at desc limit 100;
end $$;

revoke all on function public.platform_list_companies() from public, anon;
revoke all on function public.platform_list_company_invitations() from public, anon;
grant execute on function public.platform_list_companies() to authenticated;
grant execute on function public.platform_list_company_invitations() to authenticated;
