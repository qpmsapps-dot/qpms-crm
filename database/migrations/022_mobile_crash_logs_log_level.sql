alter table if exists public.mobile_crash_logs
  add column if not exists log_level text not null default 'error';

do $$
begin
  if to_regclass('public.mobile_crash_logs') is not null
     and not exists (
       select 1
       from pg_constraint
       where conname = 'mobile_crash_logs_log_level_check'
         and conrelid = 'public.mobile_crash_logs'::regclass
     ) then
    alter table public.mobile_crash_logs
      add constraint mobile_crash_logs_log_level_check
      check (log_level in ('debug', 'info', 'warning', 'error'))
      not valid;
  end if;
end $$;

alter table if exists public.mobile_crash_logs
  validate constraint mobile_crash_logs_log_level_check;

create index if not exists idx_mobile_crash_logs_error_created
  on public.mobile_crash_logs(created_at desc)
  where log_level = 'error';
