-- ISOLATED TEST FIXTURE ONLY. Never apply to production.
-- Column types/defaults and financial trigger bodies captured 2026-10-25.
-- External business-table FKs and unrelated authorization policies are omitted;
-- relevant internal FKs, checks, exact financial/attendance guards and 238 RPCs remain.
create role anon nologin;create role authenticated nologin;
create role service_role nologin bypassrls;create role authenticator login noinherit;
grant service_role,authenticated,anon to authenticator;
create schema auth;grant usage on schema public,auth to service_role,authenticated,anon;
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;
create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
create table public."fo_attendance" (
 "id" uuid default gen_random_uuid() not null,
 "fo_user_id" text not null,
 "employee_code" text,
 "username" text,
 "display_name" text,
 "attendance_date" date default CURRENT_DATE not null,
 "login_time" timestamp with time zone default now() not null,
 "logout_time" timestamp with time zone,
 "status" text default 'Active'::text not null,
 "start_latitude" numeric(10,7),
 "start_longitude" numeric(10,7),
 "end_latitude" numeric(10,7),
 "end_longitude" numeric(10,7),
 "start_battery_percentage" integer,
 "end_battery_percentage" integer,
 "battery_start" integer,
 "battery_end" integer,
 "actual_km" numeric(10,2) default 0 not null,
 "eligible_km" numeric(10,2) default 0 not null,
 "total_raw_km" numeric(10,2) default 0 not null,
 "total_route_km" numeric(10,2) default 0 not null,
 "total_approved_km" numeric(10,2) default 0 not null,
 "raw_gps_km" numeric(10,2) default 0 not null,
 "filtered_gps_km" numeric(10,2) default 0 not null,
 "actual_travel_km" numeric(10,2) default 0 not null,
 "actual_travel_updated_at" timestamp with time zone,
 "rate_per_km" numeric(10,2) default 4 not null,
 "petrol_amount" numeric(10,2) default 0 not null,
 "eligibility_status" text default 'Needs Review'::text not null,
 "route_sync_status" text default 'pending'::text not null,
 "sync_status" text default 'synced'::text not null,
 "local_id" text,
 "metadata" jsonb default '{}'::jsonb not null,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null,
 "travel_mode" text default 'bike'::text not null,
 "payable_km_allowed" boolean default true not null,
 "travel_mode_note" text
);
create table public."fo_km_financial_approvals" (
 "id" uuid default gen_random_uuid() not null,
 "attendance_id" uuid not null,
 "input_digest" text not null,
 "expected_attendance_updated_at" timestamp with time zone not null,
 "before_total_route_km" numeric(14,2) not null,
 "before_eligible_km" numeric(14,2) not null,
 "before_total_approved_km" numeric(14,2) not null,
 "before_petrol_amount" numeric(14,2) not null,
 "after_total_route_km" numeric(14,2) not null,
 "after_eligible_km" numeric(14,2) not null,
 "after_total_approved_km" numeric(14,2) not null,
 "after_petrol_amount" numeric(14,2) not null,
 "reviewer_user_id" uuid not null,
 "reviewer_identity" text not null,
 "approval_reason" text not null,
 "approved_at" timestamp with time zone default now() not null
);
create table public."fo_km_financial_control" (
 "control_key" text not null,
 "financial_writes_enabled" boolean default false not null,
 "changed_by" uuid,
 "changed_by_identity" text,
 "change_reason" text,
 "changed_at" timestamp with time zone default now() not null
);
create table public."fo_location_logs" (
 "id" uuid default gen_random_uuid() not null,
 "fo_user_id" text not null,
 "employee_code" text,
 "username" text,
 "attendance_id" uuid,
 "task_id" uuid,
 "site_visit_id" uuid,
 "latitude" numeric(10,7) not null,
 "longitude" numeric(10,7) not null,
 "accuracy" numeric(10,2),
 "speed" numeric(10,2),
 "heading" numeric(10,2),
 "bearing" numeric(10,2),
 "battery_percentage" integer,
 "is_mocked" boolean default false not null,
 "logged_at" timestamp with time zone default now() not null,
 "captured_at" timestamp with time zone default now() not null,
 "local_id" text,
 "source" text default 'mobile'::text not null,
 "sync_status" text default 'synced'::text not null,
 "metadata" jsonb default '{}'::jsonb not null,
 "created_at" timestamp with time zone default now() not null,
 "travel_leg_id" uuid
);
create table public."fo_monthly_travel_settlements" (
 "id" uuid default gen_random_uuid() not null,
 "profile_id" uuid not null,
 "employee_code" text not null,
 "state" text not null,
 "period_start" date not null,
 "period_end" date not null,
 "calculated_claim_amount" numeric(14,2) not null,
 "finance_reviewed_amount" numeric(14,2),
 "approved_payable_amount" numeric(14,2) not null,
 "adjustment_amount" numeric(14,2) not null,
 "adjustment_type" text not null,
 "adjustment_reason" text,
 "remarks" text,
 "source_reference" text not null,
 "approved_by" uuid,
 "approved_at" timestamp with time zone not null,
 "created_at" timestamp with time zone default timezone('utc'::text, now()) not null,
 "updated_at" timestamp with time zone default timezone('utc'::text, now()) not null
);
create table public."fo_october_km_recoveries" (
 "id" uuid default gen_random_uuid() not null,
 "employee_code" text not null,
 "employee_name" text not null,
 "attendance_date" date not null,
 "attendance_id" uuid,
 "journey_start" timestamp with time zone not null,
 "journey_end" timestamp with time zone not null,
 "journey_type" text not null,
 "start_location" text not null,
 "destination" text not null,
 "intermediate_stops" jsonb not null,
 "recovery_reason" text not null,
 "explanation" text not null,
 "evidence_refs" jsonb not null,
 "requested_km" numeric(10,2) not null,
 "journey_total_km" numeric(10,2) not null,
 "travel_mode" text not null,
 "travel_rate" numeric not null,
 "approved_additional_km" numeric(10,2) default 0 not null,
 "additional_amount" numeric(12,2) default 0 not null,
 "verified_included_km" numeric(10,2),
 "inclusion_resolution" text,
 "status" text default 'pending'::text not null,
 "submitted_by" uuid not null,
 "approved_by" uuid,
 "approved_at" timestamp with time zone,
 "approval_remarks" text,
 "original_payable_km" numeric(12,2),
 "resulting_payable_km" numeric(12,2),
 "original_claim_amount" numeric(12,2),
 "resulting_claim_amount" numeric(12,2),
 "before_state" jsonb not null,
 "request_key" text not null,
 "request_payload" jsonb not null,
 "decision_key" text,
 "decision_payload" jsonb,
 "journey_fingerprint" text not null,
 "version" integer default 1 not null,
 "created_at" timestamp with time zone default now() not null
);
create table public."fo_october_km_recovery_events" (
 "id" bigint generated always as identity not null,
 "recovery_id" uuid not null,
 "actor_id" uuid not null,
 "action" text not null,
 "snapshot" jsonb not null,
 "created_at" timestamp with time zone default now() not null
);
create table public."fo_october_recovery_activation" (
 "singleton" boolean default true not null,
 "requests_enabled" boolean default false not null,
 "approvals_enabled" boolean default false not null,
 "emergency_exception_approved" boolean default false not null,
 "allowed_admins" uuid[] default '{}'::uuid[] not null,
 "approval_reference" text,
 "expires_at" timestamp with time zone
);
create table public."fo_site_visits" (
 "id" uuid default gen_random_uuid() not null,
 "fo_user_id" text not null,
 "employee_code" text,
 "full_name" text,
 "fo_name" text,
 "display_name" text,
 "attendance_id" uuid,
 "fo_daily_task_id" uuid,
 "store_id" uuid,
 "site_id" uuid,
 "store_name" text,
 "site_name" text,
 "store_code" text,
 "site_code" text,
 "client_name" text,
 "state" text,
 "check_in_time" timestamp with time zone default now() not null,
 "check_out_time" timestamp with time zone,
 "checkout_time" timestamp with time zone,
 "check_in_latitude" numeric(10,7),
 "check_in_longitude" numeric(10,7),
 "check_out_latitude" numeric(10,7),
 "check_out_longitude" numeric(10,7),
 "current_latitude" numeric(10,7),
 "current_longitude" numeric(10,7),
 "current_gps_accuracy" numeric(10,2),
 "checkin_accuracy" numeric(10,2),
 "checkout_accuracy" numeric(10,2),
 "checkout_distance_meters" numeric(12,2),
 "checkout_location_status" text default 'valid'::text not null,
 "checkout_note" text,
 "petrol_eligible_after_checkout" boolean default true not null,
 "petrol_penalty_distance_meters" numeric(12,2) default 0 not null,
 "origin_lat" numeric(10,7),
 "origin_lng" numeric(10,7),
 "destination_lat" numeric(10,7),
 "destination_lng" numeric(10,7),
 "straight_line_km" numeric(10,2),
 "route_km" numeric(10,2),
 "route_duration_minutes" integer,
 "google_route_polyline" text,
 "distance_source" text,
 "visit_duration_minutes" integer,
 "status" text default 'Checked In'::text not null,
 "visit_status" text,
 "local_id" text,
 "sync_status" text default 'synced'::text not null,
 "metadata" jsonb default '{}'::jsonb not null,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null,
 "business" text,
 "travel_leg_id" uuid,
 "retail_store_id" uuid,
 "store_source" text default 'STORE_MASTER'::text not null
);
create table public."fo_travel_legs" (
 "id" uuid default gen_random_uuid() not null,
 "attendance_id" uuid not null,
 "employee_code" text not null,
 "fo_user_id" text,
 "travel_mode" text not null,
 "payable_km_allowed" boolean not null,
 "started_at" timestamp with time zone not null,
 "ended_at" timestamp with time zone,
 "start_lat" double precision,
 "start_lng" double precision,
 "end_lat" double precision,
 "end_lng" double precision,
 "calculated_km" numeric(10,2) default 0 not null,
 "payable_km" numeric(10,2) default 0 not null,
 "fare_amount" numeric(10,2) default 0 not null,
 "proof_file_url" text,
 "remarks" text,
 "status" text default 'active'::text not null,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null,
 "rate_per_km" numeric(10,2),
 "payable_amount" numeric(10,2),
 "calculation_version" text,
 "calculation_run_id" uuid,
 "canonical_calculated" boolean default false not null,
 "superseded_at" timestamp with time zone
);
create table public."fo_travel_reimbursement_corrections" (
 "id" uuid default gen_random_uuid() not null,
 "correction_key" text not null,
 "attendance_id" uuid not null,
 "employee_code" text not null,
 "attendance_date" date not null,
 "correction_confidence" text not null,
 "correction_reason" text not null,
 "status" text default 'previewed'::text not null,
 "before_state" jsonb not null,
 "proposed_state" jsonb not null,
 "applied_state" jsonb,
 "error_detail" jsonb,
 "created_at" timestamp with time zone default now() not null,
 "applied_at" timestamp with time zone,
 "updated_at" timestamp with time zone default now() not null
);
create table public."profiles" (
 "id" uuid default gen_random_uuid() not null,
 "auth_user_id" uuid,
 "employee_code" text,
 "username" text,
 "full_name" text,
 "display_name" text,
 "mobile" text,
 "email" text,
 "birth_date" date,
 "gender" text,
 "state" text,
 "role" text default 'FO'::text not null,
 "status" text default 'Active'::text not null,
 "is_active" boolean default true not null,
 "metadata" jsonb default '{}'::jsonb not null,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null,
 "department" text,
 "designation" text,
 "business" text,
 "requires_password_change" boolean default false not null,
 "deactivated_at" timestamp with time zone,
 "deactivated_by" uuid,
 "deactivation_reason" text,
 "mobile_access_enabled" boolean default true not null,
 "web_access_enabled" boolean default true not null,
 "auth_provisioning_status" text default 'unknown'::text not null,
 "auth_provisioning_error" text,
 "auth_provisioned_at" timestamp with time zone,
 "last_profile_sync_at" timestamp with time zone,
 "branch" text
);
alter table public."fo_attendance" add constraint "fo_attendance_pkey" PRIMARY KEY (id);
alter table public."fo_attendance" add constraint "fo_attendance_travel_mode_check" CHECK ((travel_mode = ANY (ARRAY['bike'::text, 'own_vehicle'::text, 'car'::text, 'auto'::text, 'bus'::text, 'train'::text, 'other'::text])));
alter table public."fo_attendance" add constraint "fo_attendance_v2_nonnegative_check" CHECK (((COALESCE(total_route_km, (0)::numeric) >= (0)::numeric) AND (COALESCE(eligible_km, (0)::numeric) >= (0)::numeric) AND (COALESCE(total_approved_km, (0)::numeric) >= (0)::numeric) AND (COALESCE(petrol_amount, (0)::numeric) >= (0)::numeric))) NOT VALID;
alter table public."fo_location_logs" add constraint "fo_location_logs_pkey" PRIMARY KEY (id);
alter table public."fo_october_km_recoveries" add constraint "fo_october_km_recoveries_additional_amount_check" CHECK ((additional_amount >= (0)::numeric));
alter table public."fo_october_km_recoveries" add constraint "fo_october_km_recoveries_attendance_date_check" CHECK (((attendance_date >= '2026-10-01'::date) AND (attendance_date <= '2026-10-31'::date)));
alter table public."fo_october_km_recoveries" add constraint "fo_october_km_recoveries_check" CHECK (((journey_total_km >= requested_km) AND (journey_total_km <= (1000)::numeric)));
alter table public."fo_october_km_recoveries" add constraint "fo_october_km_recoveries_check1" CHECK (((approved_additional_km >= (0)::numeric) AND (approved_additional_km <= requested_km)));
alter table public."fo_october_km_recoveries" add constraint "fo_october_km_recoveries_check2" CHECK (((journey_end > journey_start) AND (journey_end <= now())));
alter table public."fo_october_km_recoveries" add constraint "fo_october_km_recoveries_check3" CHECK ((((journey_start AT TIME ZONE 'Asia/Kolkata'::text))::date = attendance_date));
alter table public."fo_october_km_recoveries" add constraint "fo_october_km_recoveries_check4" CHECK ((journey_end <= (((attendance_date + 1))::timestamp without time zone AT TIME ZONE 'Asia/Kolkata'::text)));
alter table public."fo_october_km_recoveries" add constraint "fo_october_km_recoveries_check5" CHECK ((additional_amount = round((approved_additional_km * travel_rate), 2)));
alter table public."fo_october_km_recoveries" add constraint "fo_october_km_recoveries_check6" CHECK (((status <> 'approved'::text) OR ((travel_rate > (0)::numeric) AND (approved_additional_km > (0)::numeric) AND (approved_by IS NOT NULL) AND (approved_at IS NOT NULL) AND (verified_included_km IS NOT NULL) AND (verified_included_km >= (0)::numeric) AND (length(inclusion_resolution) >= 20) AND (approved_additional_km <= (journey_total_km - verified_included_km)))));
alter table public."fo_october_km_recoveries" add constraint "fo_october_km_recoveries_decision_key_key" UNIQUE (decision_key);
alter table public."fo_october_km_recoveries" add constraint "fo_october_km_recoveries_pkey" PRIMARY KEY (id);
alter table public."fo_october_km_recoveries" add constraint "fo_october_km_recoveries_recovery_reason_check" CHECK ((recovery_reason = ANY (ARRAY['Missing Check-Out'::text, 'Missing Check-In'::text, 'Missing End Day'::text, 'Sourcing / Recruitment'::text, 'Emergency Site Visit'::text, 'GPS Failure'::text, 'Offline Sync Failure'::text, 'Other Official Travel'::text])));
alter table public."fo_october_km_recoveries" add constraint "fo_october_km_recoveries_request_key_key" UNIQUE (request_key);
alter table public."fo_october_km_recoveries" add constraint "fo_october_km_recoveries_requested_km_check" CHECK (((requested_km > (0)::numeric) AND (requested_km <= (500)::numeric)));
alter table public."fo_october_km_recoveries" add constraint "fo_october_km_recoveries_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
alter table public."fo_october_km_recoveries" add constraint "fo_october_km_recoveries_travel_mode_check" CHECK ((travel_mode = ANY (ARRAY['bike'::text, 'own_vehicle'::text, 'car'::text, 'auto'::text, 'bus'::text, 'train'::text, 'other'::text])));
alter table public."fo_october_km_recoveries" add constraint "fo_october_km_recoveries_travel_rate_check" CHECK ((travel_rate >= (0)::numeric));
alter table public."fo_october_km_recovery_events" add constraint "fo_october_km_recovery_events_pkey" PRIMARY KEY (id);
alter table public."fo_october_recovery_activation" add constraint "fo_october_recovery_activation_check" CHECK (((NOT approvals_enabled) OR (emergency_exception_approved AND (COALESCE(length(approval_reference), 0) >= 10) AND (expires_at IS NOT NULL))));
alter table public."fo_october_recovery_activation" add constraint "fo_october_recovery_activation_pkey" PRIMARY KEY (singleton);
alter table public."fo_october_recovery_activation" add constraint "fo_october_recovery_activation_singleton_check" CHECK (singleton);
alter table public."fo_site_visits" add constraint "fo_site_visits_pkey" PRIMARY KEY (id);
alter table public."fo_site_visits" add constraint "fo_site_visits_store_identity_check" CHECK ((((store_source = 'STORE_MASTER'::text) AND (retail_store_id IS NULL)) OR ((store_source = 'RELIANCE_RETAIL'::text) AND (retail_store_id IS NOT NULL) AND (store_id IS NULL) AND (site_id IS NULL))));
alter table public."fo_site_visits" add constraint "fo_site_visits_store_source_check" CHECK ((store_source = ANY (ARRAY['STORE_MASTER'::text, 'RELIANCE_RETAIL'::text])));
alter table public."fo_travel_legs" add constraint "fo_travel_legs_mode_check" CHECK ((travel_mode = ANY (ARRAY['bike'::text, 'own_vehicle'::text, 'car'::text, 'auto'::text, 'bus'::text, 'train'::text, 'other'::text])));
alter table public."fo_travel_legs" add constraint "fo_travel_legs_pkey" PRIMARY KEY (id);
alter table public."fo_travel_legs" add constraint "fo_travel_legs_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'cancelled'::text, 'submitted'::text, 'approved'::text, 'rejected'::text])));
alter table public."fo_travel_legs" add constraint "fo_travel_legs_v2_nonnegative_check" CHECK (((COALESCE(calculated_km, (0)::numeric) >= (0)::numeric) AND (COALESCE(payable_km, (0)::numeric) >= (0)::numeric) AND (COALESCE(payable_amount, (0)::numeric) >= (0)::numeric) AND (COALESCE(rate_per_km, (0)::numeric) >= (0)::numeric))) NOT VALID;
alter table public."fo_travel_legs" add constraint "fo_travel_legs_v2_time_check" CHECK (((ended_at IS NULL) OR (started_at IS NULL) OR (ended_at >= started_at))) NOT VALID;
alter table public."fo_km_financial_approvals" add primary key("id");
alter table public."fo_km_financial_control" add primary key("control_key");
alter table public."fo_monthly_travel_settlements" add primary key("id");
alter table public."fo_travel_reimbursement_corrections" add primary key("id");
alter table public."profiles" add primary key("id");
alter table public."fo_location_logs" add constraint "fo_location_logs_travel_leg_id_fkey" FOREIGN KEY (travel_leg_id) REFERENCES fo_travel_legs(id) ON DELETE SET NULL;
alter table public."fo_october_km_recoveries" add constraint "fo_october_km_recoveries_attendance_id_fkey" FOREIGN KEY (attendance_id) REFERENCES fo_attendance(id);
alter table public."fo_october_km_recovery_events" add constraint "fo_october_km_recovery_events_recovery_id_fkey" FOREIGN KEY (recovery_id) REFERENCES fo_october_km_recoveries(id);
alter table public."fo_site_visits" add constraint "fo_site_visits_travel_leg_id_fkey" FOREIGN KEY (travel_leg_id) REFERENCES fo_travel_legs(id) ON DELETE SET NULL;
alter table public."fo_travel_legs" add constraint "fo_travel_legs_attendance_id_fkey" FOREIGN KEY (attendance_id) REFERENCES fo_attendance(id) ON DELETE CASCADE;
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

create function public.capture_fo_attendance_transition() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
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
create function public.fo_october_recovery_actor(p_actor uuid) returns public.profiles language plpgsql security definer set search_path = public, pg_temp as $$
declare actor public.profiles%rowtype;
begin
  if (select count(*) from public.profiles where auth_user_id=p_actor and is_active)<>1 then raise exception 'recovery_admin_ambiguous' using errcode='42501'; end if;
  select * into strict actor from public.profiles where auth_user_id=p_actor and is_active;
  if regexp_replace(upper(coalesce(actor.role,'')),'[^A-Z0-9]','','g') not in ('ADMIN','QPMSADMIN')
    or lower(coalesce(to_jsonb(actor)->>'status','active'))<>'active'
    or coalesce((to_jsonb(actor)->>'web_access_enabled')::boolean,true) is false then raise exception 'recovery_admin_required' using errcode='42501'; end if;
  return actor;
end $$;
create function public.fo_october_recovery_preserve_baseline() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare target jsonb; field text;
begin
 target:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if (target->>'attendance_date')::date between '2026-10-01' and '2026-10-31' then
  perform pg_advisory_xact_lock(hashtextextended('october_recovery:'||upper(target->>'employee_code')||':'||(target->>'attendance_date'),0));
 end if;
 if tg_op='UPDATE' and (old.employee_code is distinct from new.employee_code or old.attendance_date is distinct from new.attendance_date)
  and exists(select 1 from public.fo_october_km_recoveries where employee_code=upper(old.employee_code) and attendance_date=old.attendance_date and status='approved') then
  raise exception 'recovery_approved_baseline_protected' using errcode='55000';
 end if;
 if exists(select 1 from public.fo_october_km_recoveries where employee_code=upper(target->>'employee_code') and attendance_date=(target->>'attendance_date')::date and status='approved') then
  if tg_op='DELETE' then raise exception 'recovery_approved_baseline_protected' using errcode='55000'; end if;
  foreach field in array array['total_approved_km','eligible_km','total_route_km','petrol_amount','travel_mode','payable_km_allowed','rate_per_km'] loop
   if (tg_op='UPDATE' and to_jsonb(old)->field is distinct from target->field)
    or (tg_op='INSERT' and field in ('total_approved_km','eligible_km','total_route_km','petrol_amount') and coalesce((target->>field)::numeric,0)<>0) then
    raise exception 'recovery_approved_baseline_protected' using errcode='55000';
   end if;
  end loop;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create function public.fo_october_recovery_state(p_employee text, p_date date) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
select jsonb_build_object(
 'attendance',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'updated_at',a.updated_at,'payable',a.total_approved_km,'petrol',a.petrol_amount,'mode',a.travel_mode,'allowed',a.payable_km_allowed,'rate',a.rate_per_km) order by a.id) from public.fo_attendance a where upper(a.employee_code)=p_employee and a.attendance_date=p_date),'[]'::jsonb),
 'legs',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.fo_travel_legs l join public.fo_attendance a on a.id=l.attendance_id where upper(a.employee_code)=p_employee and a.attendance_date=p_date),'[]'::jsonb),
 'approvals',coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.fo_km_financial_approvals f join public.fo_attendance a on a.id=f.attendance_id where upper(a.employee_code)=p_employee and a.attendance_date=p_date),'[]'::jsonb),
 'corrections',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.fo_travel_reimbursement_corrections c where upper(c.employee_code)=p_employee and c.attendance_date=p_date),'[]'::jsonb),
 'settlements',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.fo_monthly_travel_settlements s where upper(s.employee_code)=p_employee and p_date between s.period_start and s.period_end),'[]'::jsonb)
);
$$;
create function public.rpc_decide_fo_october_recovery_v1(p_actor uuid, p_id uuid, p_version integer, p_action text, p_approved_km numeric, p_remarks text, p_included_km numeric, p_inclusion_resolution text, p_idempotency_key text) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor public.profiles%rowtype; gate public.fo_october_recovery_activation%rowtype; r public.fo_october_km_recoveries%rowtype;
 body jsonb; state jsonb; base_km numeric; base_amount numeric; credited_km numeric; credited_amount numeric; known_included numeric;
begin
 actor:=public.fo_october_recovery_actor(p_actor);
 select * into strict gate from public.fo_october_recovery_activation where singleton for share;
 -- Dedicated, explicit, expiring exception authorizes this ledger only. It does
 -- not open or change the emergency/maintenance/global canonical controls.
 if not gate.approvals_enabled or not gate.emergency_exception_approved or coalesce(length(gate.approval_reference),0)<10 or gate.expires_at is null or gate.expires_at<=now() or not coalesce(p_actor=any(gate.allowed_admins),false) then raise exception 'recovery_approval_inactive' using errcode='42501'; end if;
 perform 1 from public.fo_km_financial_control where control_key='canonical_v2' and financial_writes_enabled is false for share;
 if not found then raise exception 'recovery_global_gate_must_remain_closed' using errcode='55000'; end if;
 select * into strict r from public.fo_october_km_recoveries where id=p_id;
 if upper(actor.employee_code)=r.employee_code or exists(select 1 from public.profiles where upper(employee_code)=r.employee_code and auth_user_id=p_actor) then raise exception 'recovery_self_approval_forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('october_recovery:'||r.employee_code||':'||r.attendance_date::text,0));
 select * into strict r from public.fo_october_km_recoveries where id=p_id for update;
 body:=jsonb_build_array(p_actor,p_action,p_approved_km,p_remarks,p_included_km,p_inclusion_resolution);
 if coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9_-]{16,100}$' then raise exception 'recovery_decision_key_required' using errcode='22023'; end if;
 if r.status<>'pending' then
  if r.decision_key=p_idempotency_key and r.decision_payload=body then return to_jsonb(r); end if;
  raise exception 'recovery_decision_conflict' using errcode='40001';
 end if;
 if p_version is null or r.version<>p_version or p_action is null or p_action not in ('approve','reject') or coalesce(length(btrim(p_remarks)),0)<10 then raise exception 'recovery_decision_invalid' using errcode='22023'; end if;
 perform 1 from public.fo_attendance where upper(employee_code)=r.employee_code and attendance_date=r.attendance_date order by id for update;
 perform 1 from public.fo_travel_legs where attendance_id in(select id from public.fo_attendance where upper(employee_code)=r.employee_code and attendance_date=r.attendance_date) order by id for update;
 perform 1 from public.fo_monthly_travel_settlements where upper(employee_code)=r.employee_code and r.attendance_date between period_start and period_end order by id for share;
 state:=public.fo_october_recovery_state(r.employee_code,r.attendance_date);
 if p_action='approve' then
  if state is distinct from r.before_state then raise exception 'recovery_snapshot_stale' using errcode='40001'; end if;
  if r.travel_rate<=0 or p_approved_km is null or p_approved_km<=0 or p_approved_km>r.requested_km
   or p_approved_km<>round(p_approved_km,2) or p_included_km is null or p_included_km<0
   or p_approved_km>r.journey_total_km-p_included_km or coalesce(length(btrim(p_inclusion_resolution)),0)<20 then raise exception 'recovery_inclusion_or_mode_unverified' using errcode='22023'; end if;
  if exists(select 1 from public.fo_october_km_recoveries where employee_code=r.employee_code and attendance_date=r.attendance_date and status='approved' and journey_start<r.journey_end and journey_end>r.journey_start and id<>r.id) then raise exception 'recovery_overlapping_credit' using errcode='23505'; end if;
  select coalesce(sum(payable_km),0) into known_included from public.fo_travel_legs where attendance_id in(select id from public.fo_attendance where upper(employee_code)=r.employee_code and attendance_date=r.attendance_date)
   and superseded_at is null and status in ('completed','calculated') and started_at>=r.journey_start and ended_at<=r.journey_end and payable_km>0;
  if p_included_km<known_included then raise exception 'recovery_already_included_distance' using errcode='22023'; end if;
 end if;
 select case when count(*)=0 then 0 when count(total_approved_km)=count(*) then sum(total_approved_km) else null end,
   case when count(*)=0 then 0 when count(petrol_amount)=count(*) then sum(petrol_amount) else null end into base_km,base_amount
   from public.fo_attendance where upper(employee_code)=r.employee_code and attendance_date=r.attendance_date;
 if p_action='approve' and (base_km is null or base_amount is null) then raise exception 'recovery_saved_baseline_unknown' using errcode='22023'; end if;
 select coalesce(sum(approved_additional_km),0),coalesce(sum(additional_amount),0) into credited_km,credited_amount from public.fo_october_km_recoveries where employee_code=r.employee_code and attendance_date=r.attendance_date and status='approved';
 update public.fo_october_km_recoveries set status=case p_action when 'approve' then 'approved' else 'rejected' end,
 approved_additional_km=case p_action when 'approve' then p_approved_km else 0 end,
 additional_amount=case p_action when 'approve' then round(p_approved_km*travel_rate,2) else 0 end,
 verified_included_km=p_included_km,inclusion_resolution=p_inclusion_resolution,approved_by=p_actor,approved_at=now(),approval_remarks=p_remarks,
 original_payable_km=base_km+credited_km,resulting_payable_km=base_km+credited_km+case p_action when 'approve' then p_approved_km else 0 end,
 original_claim_amount=base_amount+credited_amount,resulting_claim_amount=base_amount+credited_amount+case p_action when 'approve' then round(p_approved_km*travel_rate,2) else 0 end,
 decision_key=p_idempotency_key,decision_payload=body,version=version+1 where id=p_id returning * into r;
 insert into public.fo_october_km_recovery_events(recovery_id,actor_id,action,snapshot) values(r.id,p_actor,p_action,to_jsonb(r));
 return to_jsonb(r);
end $$;
create function public.rpc_submit_fo_october_recovery_v1(p_actor uuid, p_request jsonb) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor public.profiles%rowtype; person public.profiles%rowtype; gate public.fo_october_recovery_activation%rowtype;
 r public.fo_october_km_recoveries%rowtype; code text:=upper(btrim(p_request->>'employee_code')); d date:=(p_request->>'date')::date;
 mode text:=p_request->>'travel_mode'; rate numeric; prior public.fo_october_km_recoveries%rowtype; existing_km numeric; existing_amount numeric;
begin
 actor:=public.fo_october_recovery_actor(p_actor);
 select * into strict gate from public.fo_october_recovery_activation where singleton for share;
 if not gate.requests_enabled or not coalesce(p_actor=any(gate.allowed_admins),false) then raise exception 'recovery_requests_inactive' using errcode='42501'; end if;
 if jsonb_typeof(p_request)<>'object' or d not between '2026-10-01' and '2026-10-31'
  or length(coalesce(p_request->>'start_location',''))<3 or length(coalesce(p_request->>'destination',''))<3
  or length(coalesce(p_request->>'explanation',''))<3 or length(coalesce(p_request->>'journey_type',''))<3
  or coalesce(p_request->>'idempotency_key','') !~ '^[A-Za-z0-9_-]{16,100}$'
  or jsonb_typeof(p_request->'intermediate_stops') is distinct from 'array' or jsonb_array_length(p_request->'intermediate_stops')>10
  or jsonb_typeof(p_request->'evidence_refs') is distinct from 'array' or jsonb_array_length(p_request->'evidence_refs')>10
  then raise exception 'recovery_request_invalid' using errcode='22023'; end if;
 if (select count(*) from public.profiles where upper(employee_code)=code and is_active)<>1 then raise exception 'recovery_employee_ambiguous' using errcode='42501'; end if;
 select * into strict person from public.profiles where upper(employee_code)=code and is_active;
 if person.auth_user_id=p_actor or upper(actor.employee_code)=code then raise exception 'recovery_self_approval_forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('october_recovery:'||code||':'||d::text,0));
 select * into prior from public.fo_october_km_recoveries where request_key=p_request->>'idempotency_key';
 if found then
  if prior.submitted_by<>p_actor or prior.request_payload is distinct from p_request then raise exception 'recovery_idempotency_conflict' using errcode='23505'; end if;
  return to_jsonb(prior);
 end if;
 -- Lock canonical parents without changing them. Existing 237 guards remain intact.
 perform 1 from public.fo_attendance where upper(employee_code)=code and attendance_date=d order by id for update;
 if exists(select 1 from public.fo_attendance where upper(employee_code)=code and attendance_date=d and ((nullif(btrim(travel_mode),'') is not null and lower(btrim(travel_mode)) is distinct from mode) or (payable_km_allowed is false and mode in ('bike','own_vehicle','car')))) then
  raise exception 'recovery_recorded_transport_mismatch_or_ineligible' using errcode='22023';
 end if;
 rate:=case mode when 'bike' then 4 when 'own_vehicle' then 4 when 'car' then 8 else 0 end;
 if mode in ('bike','own_vehicle','car') then
  if (select count(distinct rate_per_km) from public.fo_attendance where upper(employee_code)=code and attendance_date=d and rate_per_km is not null)>1 then raise exception 'recovery_rate_requires_review' using errcode='22023'; end if;
  select coalesce(min(rate_per_km),rate) into rate from public.fo_attendance where upper(employee_code)=code and attendance_date=d;
 end if;
 select case when count(*)=0 then 0 when count(total_approved_km)=count(*) then sum(total_approved_km) else null end,
   case when count(*)=0 then 0 when count(petrol_amount)=count(*) then sum(petrol_amount) else null end into existing_km,existing_amount
   from public.fo_attendance where upper(employee_code)=code and attendance_date=d;
 select existing_km+coalesce(sum(approved_additional_km),0),existing_amount+coalesce(sum(additional_amount),0) into existing_km,existing_amount from public.fo_october_km_recoveries where employee_code=code and attendance_date=d and status='approved';
 insert into public.fo_october_km_recoveries(employee_code,employee_name,attendance_date,attendance_id,journey_start,journey_end,journey_type,start_location,destination,intermediate_stops,recovery_reason,explanation,evidence_refs,requested_km,journey_total_km,travel_mode,travel_rate,submitted_by,before_state,request_key,request_payload,original_payable_km,resulting_payable_km,original_claim_amount,resulting_claim_amount,journey_fingerprint)
 values(code,coalesce(person.full_name,code),d,(select id from public.fo_attendance where upper(employee_code)=code and attendance_date=d order by id limit 1),
 (p_request->>'journey_start')::timestamptz,(p_request->>'journey_end')::timestamptz,p_request->>'journey_type',p_request->>'start_location',p_request->>'destination',p_request->'intermediate_stops',p_request->>'reason',p_request->>'explanation',p_request->'evidence_refs',
 (p_request->>'requested_km')::numeric,(p_request->>'journey_total_km')::numeric,mode,rate,p_actor,public.fo_october_recovery_state(code,d),p_request->>'idempotency_key',p_request,existing_km,existing_km,existing_amount,existing_amount,
 md5(jsonb_build_array((p_request->>'journey_start')::timestamptz,(p_request->>'journey_end')::timestamptz,lower(btrim(p_request->>'start_location')),lower(btrim(p_request->>'destination')))::text)) returning * into r;
 insert into public.fo_october_km_recovery_events(recovery_id,actor_id,action,snapshot) values(r.id,p_actor,'submitted',to_jsonb(r));
 return to_jsonb(r);
end $$;
create function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create function public.trg_protect_fo_canonical_km_v2_financials() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_request_role text := coalesce(
    current_setting('request.jwt.claim.role', true),
    (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'role'),
    ''
  );
  v_authorized_financial_write boolean :=
    coalesce(current_setting('app.km_v2_authorized_financial_write', true) = 'true', false);
  v_financial_changed boolean;
begin
  v_financial_changed :=
    new.total_route_km is distinct from old.total_route_km
    or new.eligible_km is distinct from old.eligible_km
    or new.total_approved_km is distinct from old.total_approved_km
    or new.petrol_amount is distinct from old.petrol_amount;

  if session_user <> 'postgres' and (
    coalesce(old.metadata ->> 'km_calculation_version', '') = 'KM_ENGINE_V2'
    or (
      new.logout_time is not null
      and lower(coalesce(new.status, '')) <> 'active'
    )
  ) then
    if v_request_role = 'service_role' and v_financial_changed and not v_authorized_financial_write then
      raise exception using errcode = '55000', message = 'km_v2_direct_financial_write_not_authorized';
    end if;
    if v_request_role <> 'service_role' then
      new.total_route_km := old.total_route_km;
      new.eligible_km := old.eligible_km;
      new.total_approved_km := old.total_approved_km;
      new.petrol_amount := old.petrol_amount;
      new.route_sync_status := case
        when coalesce(old.metadata ->> 'km_calculation_version', '') = 'KM_ENGINE_V2'
          then old.route_sync_status
        else 'pending_canonical_end_day_recalculation'
      end;
      new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
        'km_calculation_version', old.metadata ->> 'km_calculation_version',
        'km_calculation_run_id', old.metadata ->> 'km_calculation_run_id',
        'km_input_digest', old.metadata ->> 'km_input_digest',
        'financial_authority', old.metadata ->> 'financial_authority'
      ) || case
        when coalesce(old.metadata ->> 'km_calculation_version', '') = 'KM_ENGINE_V2' then '{}'::jsonb
        else jsonb_build_object(
          'canonical_recalculation_pending', true,
          'financial_authority', 'backend_canonical_v2_pending'
        )
      end;
    end if;
  end if;
  return new;
end
$$;
CREATE TRIGGER trg_capture_fo_attendance_transition AFTER INSERT OR UPDATE ON public.fo_attendance FOR EACH ROW EXECUTE FUNCTION capture_fo_attendance_transition();
CREATE TRIGGER trg_fo_attendance_updated_at BEFORE UPDATE ON public.fo_attendance FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_october_recovery_preserve_baseline BEFORE INSERT OR DELETE OR UPDATE ON public.fo_attendance FOR EACH ROW EXECUTE FUNCTION fo_october_recovery_preserve_baseline();
CREATE TRIGGER trg_protect_fo_canonical_km_v2_financials BEFORE UPDATE OF total_route_km, eligible_km, total_approved_km, petrol_amount, route_sync_status, metadata ON public.fo_attendance FOR EACH ROW EXECUTE FUNCTION trg_protect_fo_canonical_km_v2_financials();
alter table public.fo_attendance enable row level security;
alter table public.fo_location_logs enable row level security;
alter table public.fo_october_recovery_activation enable row level security;
alter table public.fo_october_km_recoveries enable row level security;
alter table public.fo_october_km_recovery_events enable row level security;
grant select on all tables in schema public to service_role;
grant update on public.fo_attendance to service_role,authenticated;
grant select on public.fo_attendance,public.profiles to authenticated;
create policy test_own_attendance on public.fo_attendance for all to authenticated using (employee_code='KM239_TEST_FO') with check(employee_code='KM239_TEST_FO');
revoke all on public.fo_october_recovery_activation,public.fo_october_km_recoveries,public.fo_october_km_recovery_events from public,anon,authenticated,service_role;
grant select on public.fo_october_recovery_activation,public.fo_october_km_recoveries,public.fo_october_km_recovery_events to service_role;
revoke all on function public.fo_october_recovery_actor(uuid),public.fo_october_recovery_state(text,date),public.rpc_submit_fo_october_recovery_v1(uuid,jsonb),public.rpc_decide_fo_october_recovery_v1(uuid,uuid,integer,text,numeric,text,numeric,text,text),public.fo_october_recovery_preserve_baseline() from public,anon,authenticated,service_role;
grant execute on function public.rpc_submit_fo_october_recovery_v1(uuid,jsonb),public.rpc_decide_fo_october_recovery_v1(uuid,uuid,integer,text,numeric,text,numeric,text,text) to service_role;
insert into public.fo_october_recovery_activation(singleton) values(true);
insert into public.fo_km_financial_control(control_key,financial_writes_enabled) values('canonical_v2',false);
create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);
insert into supabase_migrations.schema_migrations values('236','existing236',null),('237','existing237',null),('238','existing238',null);

-- Captured non-constraint238 indexes.
CREATE INDEX fo_october_recovery_reporting ON public.fo_october_km_recoveries USING btree (employee_code, attendance_date, status);
CREATE UNIQUE INDEX fo_october_recovery_unique_journey ON public.fo_october_km_recoveries USING btree (employee_code, attendance_date, journey_fingerprint) WHERE (status = ANY (ARRAY['pending'::text, 'approved'::text]));
