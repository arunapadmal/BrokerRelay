begin;

create or replace function public.admin_get_company_snapshot(p_organisation_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_result jsonb;
begin
  v_org := coalesce(
    p_organisation_id,
    (
      select om.organisation_id
      from public.organisation_memberships om
      where om.user_id = (select auth.uid())
        and om.status = 'active'
      order by om.created_at, om.id
      limit 1
    )
  );

  if v_org is null or not private.has_staff_permission(v_org, 'manage_staff') then
    raise exception 'STAFF_MANAGEMENT_NOT_AUTHORISED' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'organisation', jsonb_build_object(
      'id', o.id, 'name', o.name, 'legal_name', o.legal_name, 'abn', o.abn,
      'billing_email', o.billing_email, 'contact_phone', o.contact_phone,
      'website', o.website, 'status', o.status
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'membership_id', om.id,
        'user_id', om.user_id,
        'email', au.email,
        'first_name', p.first_name,
        'last_name', p.last_name,
        'status', om.status,
        'disabled_reason', om.disabled_reason,
        'roles', coalesce((select jsonb_agg(mr.role order by mr.role)
                           from public.organisation_member_roles mr
                           where mr.membership_id = om.id), '[]'::jsonb),
        'permissions', coalesce((select jsonb_agg(mp.permission order by mp.permission)
                                 from public.organisation_member_permissions mp
                                 where mp.membership_id = om.id), '[]'::jsonb),
        'assigned_clients', (select count(*) from public.client_assignments ca
                             where ca.organisation_id = om.organisation_id
                               and ca.member_user_id = om.user_id)
      ) order by p.first_name, p.last_name, au.email)
      from public.organisation_memberships om
      join auth.users au on au.id = om.user_id
      left join public.profiles p on p.id = om.user_id
      where om.organisation_id = o.id
    ), '[]'::jsonb)
  ) into v_result
  from public.organisations o
  where o.id = v_org;

  return v_result;
end;
$$;

revoke all on function public.admin_get_company_snapshot(uuid) from public, anon;
grant execute on function public.admin_get_company_snapshot(uuid) to authenticated;

commit;
