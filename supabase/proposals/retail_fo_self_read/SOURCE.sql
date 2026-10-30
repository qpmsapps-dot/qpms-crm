create function public.rpc_retail_fo_self_snapshot(p_actor uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me jsonb; current_stores jsonb; own_days jsonb; own_zones jsonb; own_assignments jsonb;
begin
 select jsonb_build_object('id',p.id,'employee_code',p.employee_code,'full_name',p.full_name,'state',p.state)
 into me from public.profiles p where p.id=p_actor and p.is_active is true
 and upper(coalesce(p.status,'Active'))='ACTIVE'
 and regexp_replace(upper(coalesce(p.role,'')),'[^A-Z0-9]','','g') in ('FO','FIELDOFFICER')
 and regexp_replace(upper(coalesce(p.business,'')),'[^A-Z0-9]','','g') in ('RELIANCE','RELIANCERETAIL');
 if me is null then raise exception using errcode='42501',message='Active Reliance Retail FO profile required';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>92
 or p_to>(now() at time zone 'Asia/Kolkata')::date then
 raise exception using errcode='22023',message='Select a nonfuture reporting range of up to 93 days';end if;

 with current_owners as materialized (
  select s.id,s.store_code,s.store_name,s.state,s.status,public.retail_unified_owner(s.id,now()) as owner
  from public.reliance_retail_store_master s
 ) select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'store_code',s.store_code,'store_name',s.store_name,
 'state',s.state,'status',s.status,'current_owner',jsonb_build_object('known',true,'zone_id',s.owner->'zone_id','fo_profile_id',p_actor)) order by s.store_code),'[]'::jsonb)
 into current_stores from current_owners s where s.owner->>'known'='true' and s.owner->>'fo_profile_id'=p_actor::text;

 with dates as (select p_from+i as day from generate_series(0,p_to-p_from) i),
 owners as materialized (
  select s.id,s.store_code,s.store_name,s.state,d.day,
  public.retail_unified_owner(s.id,least(now(),(d.day::text||'T23:59:59+05:30')::timestamptz)) as owner
  from public.reliance_retail_store_master s cross join dates d
 ), owned as materialized (
  select * from owners where owner->>'known'='true' and owner->>'fo_profile_id'=p_actor::text
 ) select coalesce(jsonb_agg(jsonb_build_object('store_id',s.id,'store_code',s.store_code,'store_name',s.store_name,
 'state',s.state,'date',s.day,'class',k.kind,'zone_id',s.owner->>'zone_id','fo_id',p_actor,'ownership_known',true,
 'actual',actual.credit,'approved_aop',case when cfg.n=1 then cfg.aop else null end,
 'mepc_cycle_anchor',case when cfg.n=1 then cfg.anchor else null end) order by s.day,s.store_code,k.kind),'[]'::jsonb)
 into own_days from owned s cross join (values('HK'),('MEPC')) k(kind)
 cross join lateral (select sum(a.credit) as credit from public.retail_employee_daily_attendance a
  where a.retail_store_id=s.id and a.attendance_date=s.day and a.class=k.kind and a.superseded_at is null) actual
 cross join lateral (select count(*) as n,min(case when k.kind='HK' then a.hk_count else a.mepc_count end) as aop,
  min(a.mepc_cycle_anchor) as anchor from public.retail_attendance_aop_versions a
  where a.retail_store_id=s.id and a.superseded_at is null and (a.aop_class is null or a.aop_class=k.kind)
  and a.effective_from<=s.day and (a.effective_to is null or a.effective_to>=s.day)
  and case when k.kind='HK' then a.hk_count else a.mepc_count end is not null) cfg;

 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'zone_id',a.zone_id,'fo_profile_id',a.fo_profile_id,
 'effective_from',a.effective_from,'effective_to',a.effective_to,'status',a.status) order by a.effective_from),'[]'::jsonb)
 into own_assignments from public.reliance_retail_zone_fo_assignments a where a.fo_profile_id=p_actor
 and a.effective_from<=now() and ((a.effective_to is null or a.effective_to>now()) or
 (a.effective_from<(p_to::text||'T23:59:59+05:30')::timestamptz and
 (a.effective_to is null or a.effective_to>=(p_from::text||'T00:00:00+05:30')::timestamptz)));
 select coalesce(jsonb_agg(jsonb_build_object('id',z.id,'zone_name',z.zone_name,'state',z.state,'status',z.status)
 order by z.state,z.zone_name),'[]'::jsonb) into own_zones from public.reliance_retail_zones z
 where exists(select 1 from jsonb_array_elements(own_assignments) a where a->>'zone_id'=z.id::text)
 or exists(select 1 from jsonb_array_elements(own_days) d where d->>'zone_id'=z.id::text)
 or exists(select 1 from jsonb_array_elements(current_stores) s where s->'current_owner'->>'zone_id'=z.id::text);
 return jsonb_build_object('scope','FO_SELF','actor_id',p_actor,'admin',false,'from',p_from,'to',p_to,
 'fos',jsonb_build_array(me),'zones',own_zones,'assignments',own_assignments,
 'self_current_stores',current_stores,'self_days',own_days);
end; $$;
revoke all on function public.rpc_retail_fo_self_snapshot(uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function public.rpc_retail_fo_self_snapshot(uuid,date,date) to service_role;
