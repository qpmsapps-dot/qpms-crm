-- October 2026 KM recovery read-only preflight; installed on production.
-- Does not grant financial posting authority or modify employee KM.
create or replace function public.fo_october_km_recovery_preflight_2026()
returns jsonb language sql stable security invoker
set search_path = pg_catalog, public as $$
select jsonb_build_object(
 'period_from','2026-10-01','period_to','2026-10-31',
 'attendance_total',(select count(*) from public.fo_attendance where attendance_date between date '2026-10-01' and date '2026-10-31'),
 'attendance_ended',(select count(*) from public.fo_attendance where attendance_date between date '2026-10-01' and date '2026-10-31' and logout_time is not null),
 'attendance_with_payable',(select count(*) from public.fo_attendance where attendance_date between date '2026-10-01' and date '2026-10-31' and total_approved_km>0),
 'attendance_with_provenance',(select count(*) from public.fo_attendance a where a.attendance_date between date '2026-10-01' and date '2026-10-31' and exists(select 1 from public.fo_km_job_provenance p where p.attendance_id=a.id)),
 'attendance_authorizations',(select count(*) from public.fo_km_attendance_authorizations where attendance_date between date '2026-10-01' and date '2026-10-31'),
 'scope_emergency_pause',(select emergency_pause from public.fo_km_scope_control where control_key='admin_acceptance'),
 'global_financial_gate',(select financial_writes_enabled from public.fo_km_financial_control where control_key='canonical_v2'),
 'ready_for_posting',false,
 'blocking_reason','Migration 246 requires owner-issued verified attendance authorization; no historical recovery posting route has been approved'
);
$$;
revoke all on function public.fo_october_km_recovery_preflight_2026() from public, anon, authenticated, service_role;
grant execute on function public.fo_october_km_recovery_preflight_2026() to postgres;
