begin;

alter table public.organisations
  add column if not exists mobile_background_color text not null default '#EFF6FF',
  add column if not exists mobile_button_color text not null default '#2563EB',
  add column if not exists mobile_notification_color text not null default '#EF4444';

alter table public.organisations
  add constraint organisations_mobile_background_hex check (mobile_background_color ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint organisations_mobile_button_hex check (mobile_button_color ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint organisations_mobile_notification_hex check (mobile_notification_color ~ '^#[0-9A-Fa-f]{6}$');

-- Existing company-admin UPDATE permissions must not allow colour/logo edits.
create function private.guard_company_mobile_branding()
returns trigger language plpgsql set search_path='' as $$
begin
  if (old.mobile_background_color,old.mobile_button_color,
      old.mobile_notification_color,old.logo_url) is distinct from
     (new.mobile_background_color,new.mobile_button_color,
      new.mobile_notification_color,new.logo_url)
     and (select auth.uid()) is distinct from old.head_broker_user_id then
    raise exception 'HEAD_BROKER_REQUIRED' using errcode='42501';
  end if;
  return new;
end $$;
create trigger guard_company_mobile_branding before update on public.organisations
  for each row execute function private.guard_company_mobile_branding();
revoke all on function private.guard_company_mobile_branding() from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('company-logos','company-logos',true,2097152,array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public=true,file_size_limit=2097152,
  allowed_mime_types=excluded.allowed_mime_types;

create policy company_logos_head_select on storage.objects for select to authenticated
  using (bucket_id='company-logos' and exists(
    select 1 from public.organisations o
    where o.id::text=split_part(name,'/',1) and o.head_broker_user_id=(select auth.uid())));
create policy company_logos_head_insert on storage.objects for insert to authenticated
  with check (bucket_id='company-logos' and name ~ '^[0-9a-f-]{36}/logo\.(png|jpg|webp)$'
    and exists(select 1 from public.organisations o
      where o.id::text=split_part(name,'/',1) and o.head_broker_user_id=(select auth.uid())));
create policy company_logos_head_update on storage.objects for update to authenticated
  using (bucket_id='company-logos' and exists(select 1 from public.organisations o
      where o.id::text=split_part(name,'/',1) and o.head_broker_user_id=(select auth.uid())))
  with check (bucket_id='company-logos' and name ~ '^[0-9a-f-]{36}/logo\.(png|jpg|webp)$'
    and exists(select 1 from public.organisations o
      where o.id::text=split_part(name,'/',1) and o.head_broker_user_id=(select auth.uid())));

create function public.accept_company_setup_with_branding(
  p_invitation_id uuid,p_name text,p_legal_name text,p_abn text,
  p_billing_email text,p_document_delivery_email text,p_phone text,p_website text,
  p_background_color text,p_button_color text,p_notification_color text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_org uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'UNAUTHENTICATED' using errcode='42501';
  end if;
  if p_background_color !~ '^#[0-9A-Fa-f]{6}$' or
     p_button_color !~ '^#[0-9A-Fa-f]{6}$' or
     p_notification_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'INVALID_BRANDING_COLOUR' using errcode='22023';
  end if;
  v_org := public.accept_company_setup_invitation(p_invitation_id,p_name,p_legal_name,p_abn,
    p_billing_email,p_document_delivery_email,p_phone,p_website);
  update public.organisations set mobile_background_color=upper(p_background_color),
    mobile_button_color=upper(p_button_color), mobile_notification_color=upper(p_notification_color)
    where id=v_org;
  return v_org;
end $$;

create function public.save_company_mobile_branding(
  p_organisation_id uuid,p_background_color text,p_button_color text,
  p_notification_color text,p_logo_path text
) returns void language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not exists(
    select 1 from public.organisations o where o.id=p_organisation_id
      and o.head_broker_user_id=(select auth.uid())) then
    raise exception 'HEAD_BROKER_REQUIRED' using errcode='42501';
  end if;
  if p_background_color !~ '^#[0-9A-Fa-f]{6}$' or
     p_button_color !~ '^#[0-9A-Fa-f]{6}$' or
     p_notification_color !~ '^#[0-9A-Fa-f]{6}$' or
     (p_logo_path is not null and p_logo_path !~
       ('^'||p_organisation_id::text||'/logo\.(png|jpg|webp)$')) then
    raise exception 'INVALID_BRANDING' using errcode='22023';
  end if;
  if p_logo_path is not null and not exists (
    select 1 from storage.objects where bucket_id='company-logos' and name=p_logo_path
  ) then
    raise exception 'LOGO_UPLOAD_REQUIRED' using errcode='22023';
  end if;
  update public.organisations set mobile_background_color=upper(p_background_color),
    mobile_button_color=upper(p_button_color),
    mobile_notification_color=upper(p_notification_color),
    logo_url=p_logo_path,updated_at=now()
    where id=p_organisation_id;
end $$;

revoke all on function public.accept_company_setup_with_branding(uuid,text,text,text,text,text,text,text,text,text,text) from public,anon;
revoke all on function public.save_company_mobile_branding(uuid,text,text,text,text) from public,anon;
grant execute on function public.accept_company_setup_with_branding(uuid,text,text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.save_company_mobile_branding(uuid,text,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
