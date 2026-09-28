begin;

create or replace function public.get_my_portal_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
      'organisation_id', om.organisation_id,
      'organisation_name', o.name,
      'is_head_broker', o.head_broker_user_id = (select auth.uid()),
      'can_manage_company', private.has_staff_permission(om.organisation_id, 'manage_company'),
      'can_manage_staff', private.has_staff_permission(om.organisation_id, 'manage_staff'),
      'roles', coalesce((
        select jsonb_agg(mr.role order by mr.role)
        from public.organisation_member_roles mr
        where mr.membership_id = om.id
      ), '[]'::jsonb),
      'permissions', coalesce((
        select jsonb_agg(mp.permission order by mp.permission)
        from public.organisation_member_permissions mp
        where mp.membership_id = om.id
      ), '[]'::jsonb)
    )
    from public.organisation_memberships om
    join public.organisations o on o.id = om.organisation_id
    where om.user_id = (select auth.uid())
      and om.status = 'active'
      and om.removed_at is null
      and o.status in ('trial', 'active')
    order by om.created_at, om.id
    limit 1
  ), '{}'::jsonb);
$$;

revoke all on function public.get_my_portal_access() from public, anon;
grant execute on function public.get_my_portal_access() to authenticated;

notify pgrst, 'reload schema';

commit;
