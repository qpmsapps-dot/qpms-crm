-- PROPOSAL ONLY. Requires separate production approval. No data changes.
-- Uses immutable committed upload payload, keyed to the active attendance row.
-- Existing commit RPC, daily cap, AOP, RLS and all mutation fences stay intact.
begin;
create or replace function public.rpc_retail_attendance_exception_source(
  p_store_ids uuid[], p_from date, p_to date, p_classes text[] default array['HK','MEPC']
) returns jsonb language plpgsql stable security definer set search_path = public,pg_temp as $$
declare result jsonb;
begin
  if p_from is null or p_to is null or p_from > p_to
    or date_trunc('month',p_from) <> date_trunc('month',p_to)
    or p_to > (now() at time zone 'Asia/Kolkata')::date
    or p_classes is null or cardinality(p_classes)=0
    or array_position(p_classes,null) is not null or not p_classes <@ array['HK','MEPC'] then
    raise exception using errcode='22023',message='Invalid attendance exception scope';
  end if;
  with active as materialized (
    select a.id,a.employee_code,a.employee_name,a.retail_store_id,a.store_code_snapshot,
      a.class,a.attendance_date,a.original_status,a.batch_id,a.source_row
    from public.retail_employee_daily_attendance a
    where a.superseded_at is null and a.retail_store_id=any(p_store_ids)
      and a.attendance_date between p_from and p_to and a.class=any(p_classes)
    order by a.attendance_date,a.employee_code,a.id limit 100001
  ), times as materialized (
    -- Expand each relevant batch only once, not once per attendance row.
    select b.id as batch_id,v->>'source_row' as source_row,v->'time_source' as time_source
    from public.retail_attendance_uploads b
    join (select distinct batch_id from active) x on x.batch_id=b.id
    cross join lateral jsonb_array_elements(b.payload) v
    where b.kind='attendance' and b.status='committed'
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.attendance_date,r.employee_code,r.id),'[]'::jsonb)
    into result from (
      select a.*,t.time_source from active a left join times t
        on t.batch_id=a.batch_id and t.source_row=a.source_row::text
    ) r;
  return result;
end; $$;
revoke all on function public.rpc_retail_attendance_exception_source(uuid[],date,date,text[]) from public,anon,authenticated;
grant execute on function public.rpc_retail_attendance_exception_source(uuid[],date,date,text[]) to service_role;
comment on function public.rpc_retail_attendance_exception_source(uuid[],date,date,text[]) is
  'Backend-only reporting. Backend supplies canonical authorized stores/classes. No attendance credit or AOP changes.';
commit;

-- Non-destructive recovery: roll back application first. Leave immutable payload
-- evidence intact. After approval, the new read-only RPC may be dropped; do not
-- rerun 232, delete uploads, restore superseded rows or modify historical credits.
