-- Attendance transition event foundation for the released mobile compatibility window.
--
-- The current mobile app continues to write public.fo_attendance directly. This
-- migration observes those existing writes and preserves detected transitions in
-- an append-only ledger without changing the fo_attendance summary contract.
-- Historical transitions are intentionally not backfilled because overwritten
-- Restart Day / End Day boundaries cannot be reconstructed safely.

create table if not exists public.fo_attendance_events (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.fo_attendance(id) on delete restrict,
  fo_user_id text,
  employee_code text,
  attendance_date date,
  event_type text not null,
  event_at timestamptz not null,
  session_sequence integer not null default 1,
  event_source text not null,
  capture_mode text not null default 'legacy_compatibility_trigger',
  idempotency_key text not null,
  actor_auth_user_id uuid,
  from_status text,
  to_status text,
  prior_logout_time timestamptz,
  resulting_logout_time timestamptz,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  battery_percentage integer,
  travel_mode text,
  payable_km_allowed boolean,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint fo_attendance_events_type_check
    check (event_type in ('start_day', 'restart_day', 'end_day', 'auto_end_day')),
  constraint fo_attendance_events_session_sequence_check
    check (session_sequence >= 1),
  constraint fo_attendance_events_idempotency_unique
    unique (attendance_id, idempotency_key)
);

create index if not exists idx_fo_attendance_events_attendance_time
  on public.fo_attendance_events(attendance_id, event_at, created_at);

create index if not exists idx_fo_attendance_events_employee_time
  on public.fo_attendance_events(employee_code, event_at desc);

create index if not exists idx_fo_attendance_events_type_time
  on public.fo_attendance_events(event_type, event_at desc);

create or replace function public.capture_fo_attendance_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_metadata jsonb := coalesce(new.metadata, '{}'::jsonb);
  v_source text := 'legacy_write_compat';
  v_event_at timestamptz;
  v_event_type text;
  v_session_sequence integer := 1;
  v_idempotency_key text;
  v_capture_quality text;
  v_end_boundary_replaced boolean := false;
begin
  if coalesce(v_metadata ->> 'cleanup_source', '') = 'backend_midnight_cleanup'
     or coalesce(v_metadata ->> 'stale_auto_ended', '') = 'true' then
    v_source := 'backend_stale_cleanup';
  elsif nullif(btrim(v_metadata ->> 'admin_support_source'), '') is not null then
    v_source := 'admin_support_compat';
  end if;

  if tg_op = 'INSERT' then
    v_event_at := coalesce(new.login_time, new.created_at, now());
    v_idempotency_key := 'legacy:start_day:' || new.id::text || ':' ||
      to_char(v_event_at at time zone 'UTC', 'YYYYMMDDHH24MISS.US');

    insert into public.fo_attendance_events (
      attendance_id, fo_user_id, employee_code, attendance_date,
      event_type, event_at, session_sequence, event_source, idempotency_key,
      actor_auth_user_id, from_status, to_status, resulting_logout_time,
      latitude, longitude, battery_percentage, travel_mode,
      payable_km_allowed, metadata
    ) values (
      new.id, new.fo_user_id, new.employee_code, new.attendance_date,
      'start_day', v_event_at, 1, v_source, v_idempotency_key,
      auth.uid(), null, new.status, new.logout_time,
      new.start_latitude, new.start_longitude,
      coalesce(new.start_battery_percentage, new.battery_start),
      new.travel_mode, new.payable_km_allowed,
      jsonb_build_object(
        'legacy_compatibility_path', true,
        'capture_quality', 'attendance_insert_boundary',
        'authoritative_mobile_event_metadata_available', false
      )
    ) on conflict (attendance_id, idempotency_key) do nothing;

    -- A completed row inserted by an import or an existing administrative path
    -- represents two observable summary boundaries. Record both without claiming
    -- that intermediate session history is known.
    if new.logout_time is not null then
      v_event_type := case
        when v_source = 'backend_stale_cleanup' then 'auto_end_day'
        else 'end_day'
      end;
      v_event_at := new.logout_time;
      v_idempotency_key := 'legacy:' || v_event_type || ':' || new.id::text || ':' ||
        to_char(v_event_at at time zone 'UTC', 'YYYYMMDDHH24MISS.US');
      insert into public.fo_attendance_events (
        attendance_id, fo_user_id, employee_code, attendance_date,
        event_type, event_at, session_sequence, event_source, idempotency_key,
        actor_auth_user_id, from_status, to_status, resulting_logout_time,
        latitude, longitude, battery_percentage, travel_mode,
        payable_km_allowed, metadata
      ) values (
        new.id, new.fo_user_id, new.employee_code, new.attendance_date,
        v_event_type, v_event_at, 1, v_source, v_idempotency_key,
        auth.uid(), null, new.status, new.logout_time,
        new.end_latitude, new.end_longitude,
        coalesce(new.end_battery_percentage, new.battery_end),
        new.travel_mode, new.payable_km_allowed,
        jsonb_build_object(
          'legacy_compatibility_path', true,
          'capture_quality', 'completed_attendance_insert_boundaries_only',
          'intermediate_session_history_known', false,
          'authoritative_mobile_event_metadata_available', false
        )
      ) on conflict (attendance_id, idempotency_key) do nothing;
    end if;
    return new;
  end if;

  if old.logout_time is not null
     and new.logout_time is null
     and lower(coalesce(new.status, '')) = 'active' then
    v_event_type := 'restart_day';
    v_event_at := coalesce(new.updated_at, now());
    select coalesce(max(e.session_sequence), 1) + 1
      into v_session_sequence
    from public.fo_attendance_events e
    where e.attendance_id = new.id;
    v_capture_quality := 'previous_end_preserved_restart_location_unavailable';
  elsif new.logout_time is not null
        and (
          old.logout_time is null
          or old.logout_time is distinct from new.logout_time
        ) then
    v_event_type := case
      when v_source = 'backend_stale_cleanup' then 'auto_end_day'
      else 'end_day'
    end;
    v_event_at := new.logout_time;
    select coalesce(max(e.session_sequence), 1)
      into v_session_sequence
    from public.fo_attendance_events e
    where e.attendance_id = new.id;
    v_capture_quality := 'attendance_end_summary_boundary';
    v_end_boundary_replaced := old.logout_time is not null;
  else
    -- KM recalculations, metadata refreshes and other non-transition updates are
    -- intentionally ignored.
    return new;
  end if;

  v_idempotency_key := 'legacy:' || v_event_type || ':' || new.id::text || ':' ||
    to_char(v_event_at at time zone 'UTC', 'YYYYMMDDHH24MISS.US');

  insert into public.fo_attendance_events (
    attendance_id, fo_user_id, employee_code, attendance_date,
    event_type, event_at, session_sequence, event_source, idempotency_key,
    actor_auth_user_id, from_status, to_status, prior_logout_time,
    resulting_logout_time, latitude, longitude, battery_percentage,
    travel_mode, payable_km_allowed, metadata
  ) values (
    new.id, new.fo_user_id, new.employee_code, new.attendance_date,
    v_event_type, v_event_at, v_session_sequence, v_source, v_idempotency_key,
    auth.uid(), old.status, new.status, old.logout_time, new.logout_time,
    case when v_event_type = 'restart_day' then null else new.end_latitude end,
    case when v_event_type = 'restart_day' then null else new.end_longitude end,
    case when v_event_type = 'restart_day' then null
      else coalesce(new.end_battery_percentage, new.battery_end) end,
    new.travel_mode, new.payable_km_allowed,
    jsonb_build_object(
      'legacy_compatibility_path', true,
      'capture_quality', v_capture_quality,
      'restart_location_available', false,
      'end_boundary_replaced', v_end_boundary_replaced,
      'authoritative_mobile_event_metadata_available', false,
      'travel_mode_event_capture_deferred', true,
      'admin_support_action', nullif(v_metadata ->> 'admin_support_last_action', ''),
      'cleanup_reason', nullif(v_metadata ->> 'cleanup_reason', '')
    )
  ) on conflict (attendance_id, idempotency_key) do nothing;

  return new;
end;
$$;

revoke all on function public.capture_fo_attendance_transition() from public;

drop trigger if exists trg_capture_fo_attendance_transition
  on public.fo_attendance;

create trigger trg_capture_fo_attendance_transition
after insert or update on public.fo_attendance
for each row execute function public.capture_fo_attendance_transition();

create or replace function public.prevent_fo_attendance_event_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'fo_attendance_events is append-only';
end;
$$;

revoke all on function public.prevent_fo_attendance_event_mutation() from public;

drop trigger if exists trg_prevent_fo_attendance_event_mutation
  on public.fo_attendance_events;

create trigger trg_prevent_fo_attendance_event_mutation
before update or delete on public.fo_attendance_events
for each row execute function public.prevent_fo_attendance_event_mutation();

alter table public.fo_attendance_events enable row level security;

revoke all on public.fo_attendance_events from anon;
revoke insert, update, delete on public.fo_attendance_events from authenticated;
grant select on public.fo_attendance_events to authenticated;

drop policy if exists "fo_attendance_events own select"
  on public.fo_attendance_events;

create policy "fo_attendance_events own select"
on public.fo_attendance_events
for select
to authenticated
using (
  public.is_current_fo(fo_user_id)
  or public.is_current_fo(employee_code)
  or public.is_qpms_admin()
);

comment on table public.fo_attendance_events is
  'Append-only attendance transition ledger captured from legacy fo_attendance writes during the mobile compatibility window.';

comment on column public.fo_attendance_events.capture_mode is
  'legacy_compatibility_trigger until a future mobile transition contract supplies authoritative event metadata.';
