-- Tender demo read-only foundation.
-- Forward-only and additive: this does not grant new write access and only
-- adds restrictive mutation guards for authenticated demo profiles.

create or replace function public.is_tender_demo_user()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.auth_user_id = auth.uid()
      and coalesce(p.is_active, false) = true
      and lower(coalesce(p.status, 'active')) = 'active'
      and (
        upper(regexp_replace(coalesce(p.role, ''), '[^A-Za-z0-9]+', '', 'g')) in ('DEMOADMIN', 'TENDERDEMO', 'READONLYADMIN')
        or lower(coalesce(p.metadata ->> 'is_demo', 'false')) in ('true', '1', 'yes')
        or lower(coalesce(p.email, p.username, '')) = 'admin@qpms.co.in'
      )
  );
$$;

create or replace function public.is_not_tender_demo_user()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select not public.is_tender_demo_user();
$$;

do $$
declare
  table_name text;
  rls_enabled boolean;
  guarded_tables text[] := array[
    'profiles',
    'fo_attendance',
    'fo_live_status',
    'fo_location_logs',
    'fo_site_visits',
    'fo_activity_submissions',
    'fo_activity_uploads',
    'fault_tracker_import_batches',
    'fault_tracker_tickets',
    'store_master',
    'hospital_clients',
    'hospital_blocks',
    'hospital_floors',
    'hospital_departments',
    'hospital_locations',
    'hospital_location_aliases',
    'hospital_tickets',
    'hospital_ticket_events',
    'hospital_ticket_comments',
    'hospital_ticket_attachments',
    'hospital_ticket_notifications'
  ];
begin
  foreach table_name in array guarded_tables loop
    if to_regclass(format('public.%I', table_name)) is null then
      continue;
    end if;

    execute format('grant select, insert, update, delete on public.%I to service_role', table_name);

    select c.relrowsecurity
      into rls_enabled
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = table_name;

    if coalesce(rls_enabled, false) = false then
      raise notice 'Skipping tender demo restrictive policies for public.% because RLS is not currently enabled', table_name;
      continue;
    end if;

    execute format('drop policy if exists tender_demo_read_only_no_insert on public.%I', table_name);
    execute format(
      'create policy tender_demo_read_only_no_insert on public.%I as restrictive for insert to authenticated with check (public.is_not_tender_demo_user())',
      table_name
    );

    execute format('drop policy if exists tender_demo_read_only_no_update on public.%I', table_name);
    execute format(
      'create policy tender_demo_read_only_no_update on public.%I as restrictive for update to authenticated using (public.is_not_tender_demo_user()) with check (public.is_not_tender_demo_user())',
      table_name
    );

    execute format('drop policy if exists tender_demo_read_only_no_delete on public.%I', table_name);
    execute format(
      'create policy tender_demo_read_only_no_delete on public.%I as restrictive for delete to authenticated using (public.is_not_tender_demo_user())',
      table_name
    );
  end loop;
end $$;

grant execute on function public.is_tender_demo_user() to authenticated;
grant execute on function public.is_not_tender_demo_user() to authenticated;
