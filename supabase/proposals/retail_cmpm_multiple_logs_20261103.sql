-- Change approved 2026-11-03: allow repeated CM/PM call logs for each store.
-- Keep request_id UNIQUE so retries remain idempotent. CM/PM date windows,
-- actor/state scope, Store Master FK, audit inserts, and immutability remain unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.retail_maintenance_calls
  drop constraint if exists retail_maintenance_calls_retail_store_id_kind_report_month_key;
commit;
