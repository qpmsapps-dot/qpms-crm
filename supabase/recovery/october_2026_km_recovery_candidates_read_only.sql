-- October 2026 historical recovery: read-only per-attendance eligibility manifest.
-- No authorization, ledger writes, financial updates, or release controls.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create or replace function public.fo_october_km_recovery_candidates_2026()
returns table(attendance_id uuid, attendance_date date, employee_code text,
                 has_logout boolean, has_job boolean, has_provenance boolean,
                 has_live_authorization boolean, disposition text)
language sql stable security invoker set search_path = pg_catalog, public
as $$
 select a.id, a.attendance_date, a.employee_code,
        a.logout_time is not null,
        exists(select 1 from public.fo_km_reconciliation_jobs j where j.attendance_id=a.id),
        exists(select 1 from public.fo_km_job_provenance v where v.attendance_id=a.id),
        exists(select 1 from public.fo_km_attendance_authorizations u
               where u.attendance_id=a.id and u.revoked_at is null
                 and clock_timestamp() >= u.starts_at and clock_timestamp() < u.expires_at),
        case
          when a.logout_time is null then 'NOT_ENDED'
          when not exists(select 1 from public.fo_km_reconciliation_jobs j where j.attendance_id=a.id) then 'MISSING_JOB'
          when not exists(select 1 from public.fo_km_job_provenance v where v.attendance_id=a.id) then 'MISSING_PROVENANCE'
          when not exists(select 1 from public.fo_km_attendance_authorizations u
               where u.attendance_id=a.id and u.revoked_at is null
                 and clock_timestamp() >= u.starts_at and clock_timestamp() < u.expires_at) then 'NEEDS_OWNER_AUTHORIZATION'
          else 'AUTHORIZATION_PRESENT_REQUIRES_EVIDENCE_RECHECK'
        end
 from public.fo_attendance a
 where a.attendance_date between date '2026-10-01' and date '2026-10-31';
$$;
revoke all on function public.fo_october_km_recovery_candidates_2026() from public,anon,authenticated,service_role;
grant execute on function public.fo_october_km_recovery_candidates_2026() to postgres;
commit;
