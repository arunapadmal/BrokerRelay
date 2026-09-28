begin;

-- No schema change; this migration documents/tightens Milestone 1 visibility defaults.
-- Company admins and brokers remain tenant-scoped via private helper functions.

-- Ensure broker_profiles RLS remains enabled and anonymous access remains revoked.
alter table public.broker_profiles enable row level security;
revoke all on table public.broker_profiles from anon;

commit;;
