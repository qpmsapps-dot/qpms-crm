-- 019: Allow trusted backend service-role access to Fault Tracker persistence.
-- Backend endpoints authenticate/authorize users first, then use service role for DB IO.

grant usage on schema public to service_role;

grant select, insert, update, delete on public.fault_tracker_import_batches to service_role;
grant select, insert, update, delete on public.fault_tracker_tickets to service_role;
grant select, insert, update, delete on public.fault_tracker_ticket_updates to service_role;

grant execute on function public.fault_tracker_normalize_key(text) to service_role;
grant execute on function public.fault_tracker_state_code(text) to service_role;
grant execute on function public.fault_tracker_current_profile() to service_role;
grant execute on function public.fault_tracker_current_role_key() to service_role;
grant execute on function public.fault_tracker_current_state_code() to service_role;
grant execute on function public.fault_tracker_can_manage() to service_role;
grant execute on function public.fault_tracker_can_read_all() to service_role;
grant execute on function public.fault_tracker_can_access() to service_role;
