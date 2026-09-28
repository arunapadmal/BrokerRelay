-- Applied to aidezconnect-dev on 25 September 2026.
-- The client_assignments and document_delivery_endpoints SELECT policies call
-- this private RLS helper. Revoking its EXECUTE from authenticated users caused
-- client-home to return ASSIGNMENT_LOOKUP_FAILED (HTTP 500).
grant execute on function private.is_head_broker(uuid, uuid) to authenticated;
