-- Independent evidence-only queue. No historical enqueue/backfill, payable
-- writes, or re-enabling of the disabled per-point distance trigger.
begin;
create table public.fo_gps_evidence_summary_queue (
  attendance_id uuid primary key references public.fo_attendance(id) on delete cascade,
  requested_at timestamptz not null default now(),
  not_before timestamptz not null default now() + interval '30 seconds',
  attempts integer not null default 0,
  last_error_code text
);
alter table public.fo_gps_evidence_summary_queue enable row level security;
revoke all on table public.fo_gps_evidence_summary_queue from public, anon, authenticated, service_role;
grant select on table public.fo_gps_evidence_summary_queue to service_role;

create function public.trg_queue_fo_gps_evidence_summary_v1() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  insert into public.fo_gps_evidence_summary_queue as q (attendance_id)
    select distinct attendance_id from inserted_gps_evidence where attendance_id is not null
    on conflict (attendance_id) do update set not_before = case when q.attempts > 0 then q.not_before
      else least(q.requested_at + interval '60 seconds', now() + interval '30 seconds') end;
  return null;
end
$function$;
create trigger trg_queue_fo_gps_evidence_summary_v1 after insert on public.fo_location_logs
  referencing new table as inserted_gps_evidence for each statement
  execute function public.trg_queue_fo_gps_evidence_summary_v1();

create function public.rpc_refresh_fo_gps_evidence_summaries_v1(p_limit integer default 5) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare
  item record;
  refreshed integer := 0;
  failed integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'gps_evidence_service_role_required';
  end if;
  for item in select attendance_id from public.fo_gps_evidence_summary_queue
    where not_before <= now() order by requested_at
    limit greatest(1, least(coalesce(p_limit,5),20)) for update skip locked
  loop
    -- Same lock order as canonical persistence. Avoid blocking another collector
    -- batch or financial transaction; the durable item remains queued.
    if not pg_try_advisory_xact_lock(hashtextextended(item.attendance_id::text, 0)) then continue; end if;
    begin
      perform 1 from public.fo_attendance where id = item.attendance_id for update nowait;
      perform public.refresh_fo_attendance_actual_travel_km(item.attendance_id);
      delete from public.fo_gps_evidence_summary_queue where attendance_id = item.attendance_id;
      refreshed := refreshed + 1;
    exception when others then
      update public.fo_gps_evidence_summary_queue set attempts = attempts + 1,
        not_before = now() + interval '5 minutes', last_error_code = sqlstate
        where attendance_id = item.attendance_id;
      failed := failed + 1;
    end;
  end loop;
  return jsonb_build_object('refreshed', refreshed, 'failed', failed);
end
$function$;
revoke all on function public.trg_queue_fo_gps_evidence_summary_v1() from public, anon, authenticated;
revoke all on function public.rpc_refresh_fo_gps_evidence_summaries_v1(integer) from public, anon, authenticated;
grant execute on function public.rpc_refresh_fo_gps_evidence_summaries_v1(integer) to service_role;
commit;
