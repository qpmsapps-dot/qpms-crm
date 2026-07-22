-- Grant backend service-role access to the unified access-control foundation.
-- Migration 030 intentionally revoked anon/authenticated direct table access,
-- but backend access APIs still need service_role privileges to read and manage
-- these tables through authorized server-side workflows.

grant usage on schema public to service_role;

grant select, insert, update, delete on
  public.access_business_verticals,
  public.access_clients,
  public.access_modules,
  public.access_business_vertical_modules,
  public.access_client_modules,
  public.access_roles,
  public.access_permissions,
  public.access_role_permissions,
  public.access_user_assignments,
  public.access_user_scopes,
  public.access_audit_logs
to service_role;

revoke all on
  public.access_business_verticals,
  public.access_clients,
  public.access_modules,
  public.access_business_vertical_modules,
  public.access_client_modules,
  public.access_roles,
  public.access_permissions,
  public.access_role_permissions,
  public.access_user_assignments,
  public.access_user_scopes,
  public.access_audit_logs
from anon, authenticated;
