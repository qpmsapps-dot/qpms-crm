-- Production applied on 2026-11-03; do not replay the source rows blindly.
-- Historical, unverified Excel-reported state totals. No canonical operational writes.
create table if not exists public.retail_ifms_historical_summary (
 id uuid primary key default gen_random_uuid(),
 source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
 source_filename text not null,
 snapshot_date date not null,
 module text not null check(module in ('cmpm','thermography','technical_training','soft_skill_training','deep_cleaning','shortage','manpower_vacancy','oos_historical')),
 reporting_state text not null check(reporting_state in ('TN','KA','KL','TG','AP-1','AP-2')),
 source_rows integer not null check(source_rows>=0),
 distinct_store_codes integer not null check(distinct_store_codes>=0),
 metrics jsonb not null check(jsonb_typeof(metrics)='object'),
 source_class text not null default 'EXCEL_REPORTED_HISTORICAL_UNVERIFIED' check(source_class='EXCEL_REPORTED_HISTORICAL_UNVERIFIED'),
 imported_at timestamptz not null default now(),
 constraint retail_ifms_historical_summary_source_unique unique(source_sha256,module,reporting_state)
);
alter table public.retail_ifms_historical_summary enable row level security;
revoke all on public.retail_ifms_historical_summary from public,anon,authenticated;
grant select on public.retail_ifms_historical_summary to service_role;
comment on table public.retail_ifms_historical_summary is
 'Read-only Excel-reported historical state aggregates, NOT verified FO completion, live OOS, payments, attendance or financial ledger. Exposed only by role-scoped backend.';
-- Source workbook SHA-256:
-- 18bb0fd237dd3151ad119f9aa97dce21da08c2f748e3f0f4a29f3b880ec722a5
-- 42 state-level rows imported and verified in production; no per-store records.
