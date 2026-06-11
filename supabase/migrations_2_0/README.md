# Mobile_FO_V2 Supabase Migration 2.0

This folder contains a clean, ordered, idempotent migration set for the Mobile_FO_V2 production schema. It does not migrate old test data and does not require or expose a service role key in the mobile app.

## Execution Order

Run these files in order:

1. `000_extensions_helpers.sql` - enables `pgcrypto`, creates shared update/RLS helper functions, and creates FO login/registration RPC helpers.
2. `001_profiles_auth.sql` - creates/patches `profiles`, registration fields, unique indexes, and update trigger.
3. `002_mobile_fo_tables.sql` - creates/patches FO mobile tables, required columns, indexes, and update triggers.
4. `003_km_recalculation.sql` - creates GPS trail recalculation functions, payable route-sum functions, and triggers.
5. `004_storage_rls_grants.sql` - creates the `fo-activity-uploads` bucket, grants, RLS policies, and storage policies.
6. `005_payable_route_km_correction.sql` - replaces any older payable-KM trigger/function and repairs existing attendance rows to route-sum totals.
7. `099_validation.sql` - read-only validation queries to run after migration.

## Existing Production Tables Reported

The new QPMS CRM Production database was reported to currently contain:

- `profiles`
- `fo_attendance`
- `fo_live_status`
- `fo_location_logs`
- `fo_site_visits`
- `fo_daily_tasks`
- `fo_activity_submissions`
- `fo_activity_uploads`
- `store_master`
- `mobile_crash_logs`

Because the live database schema was not introspected directly from this workspace, this migration treats those tables as existing-but-possibly-incomplete and uses `create table if not exists`, `alter table add column if not exists`, and `create index if not exists`.

## Migration Files Inspected

Project SQL inspected for this audit:

- `supabase/schema.sql`
- `database/migrations/000_fo_production_baseline.sql`
- `database/migrations/001_initial_schema.sql`
- `database/migrations/002_workflow_engine.sql`
- `database/migrations/003_approval_matrix.sql`
- `database/migrations/004_notifications.sql`
- `database/migrations/005_audit_logs.sql`
- `database/migrations/006_assessment_section_safety.sql`
- `database/migrations/007_proposal_foundation.sql`
- `database/migrations/008_safe_unique_constraints_indexes.sql`
- `database/migrations/009_workflow_rpc_functions.sql`
- `database/migrations/010_auth_role_foundation.sql`
- `database/migrations/011_postman_real_workflow_api_support.sql`
- `database/migrations/012_fo_operations_phase1.sql`
- `database/migrations/013_fo_route_segments_attachments.sql`
- `database/migrations/014_fo_live_status.sql`
- `database/migrations/015_fo_gps_test_users.sql`
- `database/migrations/016_mobile_fo_self_registration.sql`
- `database/migrations/017_profiles_employee_code.sql`
- `database/migrations/018_start_day_schema_guard.sql`
- `database/migrations/019_store_master_site_visit_fields.sql`
- `database/migrations/020_mobile_crash_logs.sql`
- `database/migrations/021_demo_stable_tracking_schema_guard.sql`
- `database/migrations/022_fo_safe_km_summary.sql`
- `database/migrations/023_fo_route_distance_origins.sql`
- `database/migrations/024_fo_actual_travel_km_engine.sql`
- `database/migrations/025_fo_wrong_location_checkout.sql`
- `database/schema/core_tables.sql`
- `database/schema/workflow_tables.sql`
- `database/schema/approval_tables.sql`
- `database/schema/audit_tables.sql`
- `database/schema/notification_tables.sql`
- `database/policies/rls_policies.sql`
- `database/policies/role_access_policies.sql`
- `database/backup/pre_migration_checks.sql`
- `database/backup/post_migration_validation.sql`
- `database/admin_identify_mock_fo_users.sql`
- `database/seed/demo_roles.sql`
- `database/seed/demo_users.sql`
- `database/seed/wage_master_seed.sql`
- `database/seed/workflow_stages_seed.sql`

## Missing Objects This Migration Adds Or Guards

Likely missing or partial objects in the new DB:

- `profiles.auth_user_id` unique index required by `upsert(... onConflict: 'auth_user_id')`.
- `profiles.employee_code`, `username`, `display_name`, `mobile`, `birth_date`, `gender`, `state`, `role`, `status`, `is_active`, `metadata`.
- FO registration/login RPCs: `rpc_resolve_fo_login_email` and `rpc_check_fo_registration_unique`.
- Start Day columns on `fo_attendance`: `username`, `display_name`, `attendance_date`, `login_time`, `logout_time`, `status`, start/end GPS, battery, `actual_km`, `eligible_km`, `total_raw_km`, `total_route_km`, `total_approved_km`, `rate_per_km`, `petrol_amount`, `local_id`.
- Active attendance index: `idx_fo_attendance_active_today`.
- Store search/add-site columns on `store_master`: store/client/code/state, GPS fields, creator fields, `attendance_id`, `captured_at`, `status`, `metadata`.
- Check-in/check-out fields on `fo_site_visits`: employee/profile fields, attendance/store IDs, store/client/state fields, check-in/out timestamps, GPS accuracy, route origin/destination, route KM, checkout-distance metadata, petrol eligibility metadata, `local_id`.
- GPS log fields on `fo_location_logs`: `username`, `attendance_id`, `latitude`, `longitude`, `accuracy`, `speed`, `battery_percentage`, `logged_at`, `captured_at`, `local_id`, `source`, `sync_status`, `metadata`.
- One-row live status constraint/index on `fo_live_status.fo_user_id`.
- Activity tables and upload metadata for future/hidden activity upload flows.
- `mobile_crash_logs` compatibility columns: `fo_user_id`, `employee_code`, `stage`, `screen`, `action`, `error_message`, `stack_trace`.
- KM recalculation functions and triggers. Payable KM is guarded as `SUM(fo_site_visits.route_km)`; GPS logs update only trail/verification fields.
- `fo-activity-uploads` storage bucket and authenticated storage policies.
- RLS policies and grants for authenticated mobile users, plus narrow anon profile read for current pre-signup duplicate check/login fallback and anon crash-log insert.

## Workflow Coverage

- Registration: Supabase Auth plus `profiles` insert/upsert by authenticated user; anon profile read remains available only for the app's current duplicate employee check.
- Login: `rpc_resolve_fo_login_email` plus limited anon profile read fallback by mobile.
- Start Day: `fo_attendance` insert/select/update, local ID uniqueness, active-day index.
- My Tasks active attendance detection: `fo_attendance` select by `fo_user_id`, `attendance_date`, `status = 'Active'`, `logout_time is null`.
- Store search/add site: authenticated select/insert on `store_master`.
- Check-in: authenticated insert/select/update on `fo_site_visits`, plus live status update.
- Activity upload: `fo_activity_submissions`, `fo_activity_uploads`, and private `fo-activity-uploads` bucket.
- Check-out: `fo_site_visits` checkout and wrong-location columns.
- End Day: `fo_attendance` completion/KM columns and end-day live status update. `total_route_km`, `eligible_km`, `actual_km`, `total_approved_km`, and `petrol_amount` are payable route totals derived only from `fo_site_visits.route_km`.
- Live status: authenticated upsert on `fo_live_status` with unique `fo_user_id`.
- Location logs: authenticated insert/select on `fo_location_logs`, local ID unique index, KM trigger.
- Crash/debug logs: anon/authenticated insert on `mobile_crash_logs`.

## Post-Migration Validation

Run `099_validation.sql` after the migration. At minimum, confirm:

- All 10 required public tables appear.
- `profiles` has `auth_user_id`, `employee_code`, and `mobile`.
- `fo_attendance` has `attendance_date`, `status`, `logout_time`, and `local_id`.
- `fo_site_visits` has `checkout_time`, `checkout_distance_meters`, `petrol_eligible_after_checkout`, and route origin/destination columns.
- RLS is enabled for all 10 public tables.
- Policies exist for public tables and `storage.objects`.
- Bucket `fo-activity-uploads` exists and is private.
- Indexes `ux_profiles_auth_user_id`, `ux_profiles_employee_code`, `idx_fo_attendance_active_today`, `ux_fo_live_status_user`, and `ux_fo_location_logs_local_id` exist.

Useful quick check:

```sql
select *
from public.fo_attendance
where status = 'Active'
  and logout_time is null
  and attendance_date = current_date
order by login_time desc;
```

If Mobile_FO_V2 still cannot detect active attendance after this migration, check the app debug actions `ATTENDANCE_CREATED`, `ATTENDANCE_SAVED_LOCAL`, `ATTENDANCE_LOADED_MYTASKS`, and `ATTENDANCE_ACTIVE_CHECK` in `mobile_crash_logs`.

Payable KM correction check:

```sql
with route_totals as (
  select
    attendance_id,
    round(coalesce(sum(route_km) filter (where route_km is not null and route_km > 0), 0)::numeric, 2) as route_km_sum
  from public.fo_site_visits
  group by attendance_id
)
select
  a.id,
  a.total_route_km,
  a.eligible_km,
  a.petrol_amount,
  coalesce(r.route_km_sum, 0) as expected_route_km,
  round((coalesce(r.route_km_sum, 0) * 4)::numeric, 2) as expected_petrol_amount
from public.fo_attendance a
left join route_totals r on r.attendance_id = a.id
where a.id = '<attendance_uuid>';
```
