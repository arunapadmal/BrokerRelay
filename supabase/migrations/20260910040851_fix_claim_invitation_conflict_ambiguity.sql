do $$
declare
  v_oid oid;
  v_def text;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'claim_client_invitation'
    and pg_get_function_identity_arguments(p.oid) = 'p_token_hash text, p_user_id uuid, p_email text, p_first_name text, p_last_name text, p_mobile text';

  if v_oid is null then
    raise exception 'claim_client_invitation function not found';
  end if;

  v_def := pg_get_functiondef(v_oid);
  v_def := replace(
    v_def,
    'on conflict (client_id, member_user_id)',
    'on conflict on constraint client_assignments_client_id_member_user_id_key'
  );

  execute v_def;
end
$$;;
