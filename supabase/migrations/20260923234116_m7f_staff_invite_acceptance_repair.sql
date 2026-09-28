begin;

create or replace function public.get_my_staff_invitations()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'invitation_id', i.id,
        'organisation_id', i.organisation_id,
        'organisation_name', o.name,
        'first_name', i.first_name,
        'last_name', i.last_name,
        'email', i.email,
        'roles', to_jsonb(i.roles),
        'needs_password_setup', nullif(u.encrypted_password, '') is null
      ) order by o.name
    ),
    '[]'::jsonb
  )
  from private.staff_invitations i
  join public.organisations o on o.id = i.organisation_id
  join auth.users u on u.id = (select auth.uid())
  where lower(i.email) = lower(u.email)
    and i.status = 'pending'
    and i.expires_at > now();
$$;

revoke all on function public.get_my_staff_invitations() from public, anon;
grant execute on function public.get_my_staff_invitations() to authenticated;

notify pgrst, 'reload schema';

commit;
