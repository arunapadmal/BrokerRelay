alter table public.organisations
  add column if not exists logo_display_width integer not null default 160
    check (logo_display_width between 80 and 240),
  add column if not exists logo_display_height integer not null default 72
    check (logo_display_height between 40 and 120);

grant update (logo_display_width, logo_display_height) on public.organisations to authenticated;

-- Keep direct updates limited to the platform owner and to a logo actually uploaded.
create or replace function private.enforce_company_logo_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_path text;
begin
  if new.logo_url is distinct from old.logo_url
    or new.logo_display_width is distinct from old.logo_display_width
    or new.logo_display_height is distinct from old.logo_display_height then
    if not private.is_platform_admin()
      or (select auth.jwt()->>'email') is distinct from 'aruna@aidez.com.au' then
      raise exception 'PLATFORM_OWNER_REQUIRED' using errcode = '42501';
    end if;
  end if;

  if new.logo_url is distinct from old.logo_url then
    v_path := split_part(new.logo_url, '/storage/v1/object/public/company-logos/', 2);
    if new.logo_url not like 'https://%/storage/v1/object/public/company-logos/' || old.id::text || '/%'
      or not exists (
        select 1 from storage.objects obj
        where obj.bucket_id = 'company-logos'
          and obj.name = v_path
          and obj.name like old.id::text || '/%'
      ) then
      raise exception 'INVALID_COMPANY_LOGO' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_enforce_company_logo_update on public.organisations;
create trigger trg_enforce_company_logo_update
before update of logo_url, logo_display_width, logo_display_height on public.organisations
for each row execute function private.enforce_company_logo_update();
