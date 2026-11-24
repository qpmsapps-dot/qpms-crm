-- Allow early completion only in the existing report-managed verified PDF workflow.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $migration$
declare definition text; old_definition text; anchor text; replacement text; pair text[];
begin
 select pg_get_functiondef('public.rpc_retail_thermography_reports(uuid,text,jsonb)'::regprocedure) into definition;
 old_definition:=definition;
 foreach pair slice 1 in array array[
  array[' and today>=scheduled_date,',','],
  array['if today<t.scheduled_date then raise exception using errcode=''22023'',message=''Inspection is scheduled in the future'';end if;','-- Early verified inspection completion is permitted.'],
  array[' or today<t.scheduled_date',''],
  array['''scheduled_date'',scheduled_date,''report_date'',report_date','''scheduled_date'',scheduled_date,''completed_on'',completed_on,''report_date'',report_date']
 ] loop
  anchor:=pair[1];replacement:=pair[2];
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
   raise exception 'Thermography early completion anchor changed; review deployed function before migration';
  end if;
  definition:=replace(definition,anchor,replacement);
 end loop;
 if definition=old_definition then raise exception 'No function change';end if;
 execute definition;
end
$migration$;
-- Keep the legacy completion-date constraint for non-report-managed inspections.
alter table public.retail_thermography_inspections
 drop constraint retail_thermography_inspections_check1,
 add constraint retail_thermography_inspections_check1
 check (completed_on is null or completed_on>=scheduled_date or report_managed is true);
commit;
