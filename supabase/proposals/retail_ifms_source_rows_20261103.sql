-- Deployed in production 2026-11-03. Source rows remain immutable historical imports.
-- The 5,565-row source Excel payload is deliberately NOT committed to GitHub.
create table if not exists public.retail_ifms_source_rows (
 id bigint generated always as identity primary key,
 source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
 source_filename text not null,
 snapshot_date date not null,
 snapshot_month date not null,
 module text not null check(module in ('cmpm','thermography','technical_training','soft_skill_training','deep_cleaning','shortage','manpower_vacancy','oos_historical')),
 source_row integer not null check(source_row>=1),
 reporting_state text not null check(reporting_state in ('TN','KA','KL','TG','AP-1','AP-2')),
 store_code text,
 record_date date,
 status text,
 data jsonb not null check(jsonb_typeof(data)='object'),
 retail_store_id uuid references public.reliance_retail_store_master(id) on delete restrict,
 match_status text not null default 'PENDING' check(match_status in ('PENDING','MATCHED','NOT_IN_MASTER','STATE_MISMATCH','NO_STORE_CODE')),
 imported_at timestamptz not null default now(),
 constraint retail_ifms_source_unique unique(source_sha256,module,source_row)
);
create index if not exists retail_ifms_source_module_date on public.retail_ifms_source_rows(module,snapshot_month,reporting_state,record_date);
create index if not exists retail_ifms_source_store on public.retail_ifms_source_rows(retail_store_id,module);
create index if not exists retail_ifms_source_match on public.retail_ifms_source_rows(match_status,reporting_state,module);
alter table public.retail_ifms_source_rows enable row level security;
revoke all on public.retail_ifms_source_rows from public,anon,authenticated;
grant select on public.retail_ifms_source_rows to service_role;
comment on table public.retail_ifms_source_rows is 'Unverified source Excel rows; never canonical FO, maintenance, evidence, training, OOS, or financial writes. Read only via authorized server API.';
