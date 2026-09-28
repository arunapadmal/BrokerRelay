-- Run once in the Supabase SQL Editor after the existing mobile branding migration.
begin;

alter table public.organisations
  add column if not exists mobile_text_color text not null default '#10245B';

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.organisations'::regclass
      and conname = 'organisations_mobile_text_hex'
  ) then
    alter table public.organisations
      add constraint organisations_mobile_text_hex
      check (mobile_text_color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end $$;

-- Continue to protect every branding field, including the new text colour.
create or replace function private.guard_company_mobile_branding()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (old.mobile_background_color, old.mobile_text_color, old.mobile_button_color,
      old.mobile_notification_color, old.logo_url) is distinct from
     (new.mobile_background_color, new.mobile_text_color, new.mobile_button_color,
      new.mobile_notification_color, new.logo_url)
     and (select auth.uid()) is distinct from old.head_broker_user_id then
    raise exception 'HEAD_BROKER_REQUIRED' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.guard_company_mobile_branding() from public, anon, authenticated;

-- Named six-argument overload preserves existing callers of the original RPC.
create or replace function public.save_company_mobile_branding(
  p_organisation_id uuid, p_background_color text, p_text_color text,
  p_button_color text, p_notification_color text, p_logo_path text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.organisations o
    where o.id = p_organisation_id and o.head_broker_user_id = (select auth.uid())
  ) then
    raise exception 'HEAD_BROKER_REQUIRED' using errcode = '42501';
  end if;
  if p_text_color is null or p_text_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'INVALID_BRANDING_TEXT_COLOUR' using errcode = '22023';
  end if;
  perform public.save_company_mobile_branding(
    p_organisation_id, p_background_color, p_button_color,
    p_notification_color, p_logo_path
  );
  update public.organisations
  set mobile_text_color = upper(p_text_color), updated_at = now()
  where id = p_organisation_id;
end $$;
revoke all on function public.save_company_mobile_branding(uuid,text,text,text,text,text)
  from public, anon;
grant execute on function public.save_company_mobile_branding(uuid,text,text,text,text,text)
  to authenticated;
notify pgrst, 'reload schema';
commit;
