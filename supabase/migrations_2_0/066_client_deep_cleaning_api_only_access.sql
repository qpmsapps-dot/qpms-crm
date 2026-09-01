-- 066: API-only access for independent client Deep Cleaning tables.
-- The backend service role remains the trusted database execution path.
-- Keep RLS policies from 065 as defense-in-depth, but remove direct
-- PostgREST/table access for ordinary anon/authenticated clients.

revoke all privileges
on table public.client_deep_cleaning_submissions
from anon, authenticated;

revoke all privileges
on table public.client_deep_cleaning_uploads
from anon, authenticated;
