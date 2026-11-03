-- Installed in production 2026-11-03. Additive source-row archive only.
-- Source workbook SHA256: 18bb0fd237dd3151ad119f9aa97dce21da08c2f748e3f0f4a29f3b880ec722a5
-- Data: 5,565 valid-state rows; 5,086 matched to canonical Store Master,
-- 479 preserved as unresolved (including 268 technician-training rows with no store).
-- Import is idempotent on (source_sha256,module,source_row).
-- No canonical FO evidence, attendance, OOS12, financial or live operational rows modified.
begin;
create table if not exists public.retail_ifms_excel_module_rows (
 id bigint generated always as identity primary key,
 source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
 source_filename text not null,
 snapshot_date date not null,
 snapshot_month date not null,
 module text not null check(module in ('cmpm','thermography','technical_training','soft_skill_training','deep_cleaning','shortage','manpower_vacancy','oos_historical')),
 source_row integer not null check(source_row>=2),
 state text not null check(state in ('TN','KA','KL','TG','AP-1','AP-2')),
 store_code text not null default '',
 retail_store_id uuid references public.reliance_retail_store_master(id) on delete restrict,
 match_status text not null default 'PENDING' check(match_status in ('PENDING','MATCHED','STORE_NOT_FOUND','STATE_MISMATCH','NO_STORE_CODE','MULTIPLE_STORE_CODES','AMBIGUOUS_STORE')),
 record_date date,
 status text,
 data jsonb not null check(jsonb_typeof(data)='object'),
 search_text text not null default '',
 imported_at timestamptz not null default now(),
 unique(source_sha256,module,source_row)
);
alter table public.retail_ifms_excel_module_rows add column if not exists search_text text not null default '';
create index if not exists retail_ifms_excel_module_rows_lookup_idx
 on public.retail_ifms_excel_module_rows(snapshot_month,module,state,source_row);
create index if not exists retail_ifms_excel_module_rows_store_idx
 on public.retail_ifms_excel_module_rows(retail_store_id,module,snapshot_month);
alter table public.retail_ifms_excel_module_rows enable row level security;
revoke all on public.retail_ifms_excel_module_rows from public,anon,authenticated;
grant select on public.retail_ifms_excel_module_rows to service_role;
comment on table public.retail_ifms_excel_module_rows is
 'Excel-reported source rows, read-only. Not verified FO work/evidence, live OOS12 orders, receipts, reimbursement or payments. Protected admin API only.';
commit;
