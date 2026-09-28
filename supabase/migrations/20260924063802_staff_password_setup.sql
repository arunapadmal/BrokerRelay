begin;

-- Supabase can store a generated password hash for an invited user who has
-- never chosen a password. Record how our app created the Auth user instead.
alter table private.staff_invitations
  add column if not exists requires_password_setup boolean not null default false;

create or replace function public.service_create_staff_invitation_v2(
  p_actor_user_id uuid, p_organisation_id uuid, p_user_id uuid,
  p_email text, p_first_name text, p_last_name text,
  p_roles public.staff_role[], p_broker_code text, p_title text,
  p_requires_password_setup boolean
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_invitation_id uuid;
begin
  -- The existing routine retains its staff authorization, duplicate checks,
  -- tenant checks and audit event. Both writes are one database transaction.
  v_invitation_id := public.service_create_staff_invitation(
    p_actor_user_id, p_organisation_id, p_user_id, p_email,
    p_first_name, p_last_name, p_roles, p_broker_code, p_title
  );
  update private.staff_invitations
  set requires_password_setup = p_requires_password_setup
  where id = v_invitation_id and organisation_id = p_organisation_id
    and auth_user_id = p_user_id and status = 'pending';
  if not found then raise exception 'INVITATION_STATE_NOT_SAVED' using errcode='55000'; end if;
  return v_invitation_id;
end $$;

revoke all on function public.service_create_staff_invitation_v2(
  uuid,uuid,uuid,text,text,text,public.staff_role[],text,text,boolean
) from public, anon, authenticated;
grant execute on function public.service_create_staff_invitation_v2(
  uuid,uuid,uuid,text,text,text,public.staff_role[],text,text,boolean
) to service_role;

create or replace function public.get_my_staff_invitations()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'invitation_id', i.id,
    'organisation_id', i.organisation_id,
    'organisation_name', o.name,
    'first_name', i.first_name,
    'last_name', i.last_name,
    'email', i.email,
    'roles', to_jsonb(i.roles),
    'needs_password_setup', i.requires_password_setup
  ) order by o.name), '[]'::jsonb)
  from private.staff_invitations i
  join public.organisations o on o.id=i.organisation_id
  join auth.users u on u.id=(select auth.uid())
  where i.auth_user_id=u.id and lower(i.email)=lower(u.email)
    and i.status='pending' and i.expires_at>now();
$$;

revoke all on function public.get_my_staff_invitations() from public, anon;
grant execute on function public.get_my_staff_invitations() to authenticated;

notify pgrst,'reload schema';
commit;
