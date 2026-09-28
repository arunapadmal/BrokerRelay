grant usage on schema private to authenticated;
grant execute on function private.can_view_broker_profile(uuid, uuid) to authenticated;
revoke execute on function private.can_view_broker_profile(uuid, uuid) from anon;;
