-- PREPARED ONLY. Owner export (9), SHA256
-- 6336bc0a619edffad0b32e07c7350534f24898457978b83f2771dcf33b2b2c02,
-- confirms the direct-write bypass. Not installed by this preparation task.
-- Keep existing SELECT/RLS and trusted backend imports intact.
-- Review ALL callable definer functions separately: table revokes do not revoke RPCs.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $gate$ declare t text;c record;r text;begin
 foreach t in array array['fault_tracker_import_batches','fault_tracker_tickets','fault_tracker_ticket_updates'] loop
  if to_regclass('public.'||t) is null then raise exception 'Required existing table missing: %',t;end if;
  foreach r in array array['SELECT','INSERT','UPDATE','DELETE'] loop
   if not has_table_privilege('service_role','public.'||t,r) then raise exception 'Existing backend % permission missing on %; stop, do not broaden it',r,t;end if;
  end loop;
  execute format('revoke insert,update,delete on table public.%I from public,anon,authenticated',t);
  -- Table-level REVOKE alone does not remove separately granted column writes.
  for c in select attname from pg_attribute where attrelid=to_regclass('public.'||t) and attnum>0 and not attisdropped loop
   execute format('revoke insert (%I),update (%I) on table public.%I from public,anon,authenticated',c.attname,c.attname,t);
  end loop;
  foreach r in array array['anon','authenticated'] loop
   if has_table_privilege(r,'public.'||t,'INSERT,UPDATE,DELETE') or has_any_column_privilege(r,'public.'||t,'INSERT,UPDATE') then
    raise exception 'Inherited/owner direct-write privilege remains for % on %; entire correction rolled back',r,t;
   end if;
  end loop;
 end loop;
end;$gate$;
commit;
