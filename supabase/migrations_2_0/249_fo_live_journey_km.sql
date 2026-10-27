-- Restore receipt-backed closed-journey accumulation before End Day.
-- Existing calculator/outbox/ledger and kill switch; live admission installs OFF.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $$declare f record;begin
 if session_user<>'postgres' or to_regclass('public.fo_km_missing_approval_control') is null then raise exception 'km249_owner_and_248_required';end if;
 if exists(select 1 from public.fo_km_financial_control where financial_writes_enabled) then raise exception 'km249_general_gate_must_remain_closed';end if;
 for f in select * from(values
 ('public.fo_reconcile_km_239_core(uuid,jsonb,text,uuid,uuid)','1276ba9bd13168d01a47500583f0bd58'),
 ('public.fo_enqueue_km_reconciliation()','40272b31b28bf4f4f797d523ccc88938'),
 ('public.fo_km_attendance_evidence_v246(uuid)','4dfa6f19087d7f29c35dade1611e9278'),
 ('public.fo_km_attendance_provenance_v246(public.fo_attendance,public.fo_km_job_provenance,public.profiles)','c871f01262b69bf14b1d80e2b63a61da'),
 ('public.fo_km_automatic_eligible(public.fo_attendance)','7e42c50200ccf268867022215451f1d2'),
 ('public.fo_km_require_automatic(uuid,text,uuid)','98d8643df9f599edc82d44dadb03e0bd'),
 ('public.rpc_fo_km_reconciliation_state_v1(uuid)','7750bd8973c78f0735f91b1662e381d2')) expected(signature,digest) loop
 if (select md5(replace(prosrc,E'\r','')) from pg_proc where oid=to_regprocedure(f.signature)) is distinct from f.digest then raise exception 'km249_dependency_drift: %',f.signature;end if;
 end loop;
end $$;
alter table public.fo_km_automatic_control add column live_site_enabled boolean not null default false;
alter table public.fo_km_job_provenance drop constraint fo_km_job_provenance_trigger_source_check;
alter table public.fo_km_job_provenance add constraint fo_km_job_provenance_trigger_source_check check(trigger_source in('manual_end_day','auto_end_day','late_gps','site_visit'));
alter table public.fo_km_job_provenance drop constraint fo_km_job_provenance_source_table_check;
alter table public.fo_km_job_provenance add constraint fo_km_job_provenance_source_table_check check(source_table in('fo_attendance','fo_location_logs','fo_site_visits'));

create function public.fo_km_live_site_owned_v249(a public.fo_attendance,s public.fo_site_visits) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(s.attendance_id=a.id and s.check_in_time>=a.login_time and s.check_in_time<=clock_timestamp()
 and lower(coalesce(s.status,'')) not in('cancelled','rejected') and (s.employee_code is null or s.employee_code=a.employee_code)
 and exists(select 1 from public.profiles p where p.employee_code=a.employee_code and p.is_active and lower(coalesce(p.status,'')) not in('inactive','disabled','deactivated') and s.fo_user_id::text in(a.fo_user_id::text,a.employee_code,p.id::text,p.auth_user_id::text)),false);
$$;
create function public.fo_km_live_cutoff_v249(a public.fo_attendance) returns timestamptz language sql stable security definer set search_path=public,pg_temp as $$
 select max(s.check_in_time) from public.fo_site_visits s where s.attendance_id=a.id and public.fo_km_live_site_owned_v249(a,s);
$$;
-- Keep financial, identity, mode, approval and journey metadata. Exclude only
-- audit-summary output which the independent GPS summary worker refreshes.
create function public.fo_km_live_attendance_input_v249(a public.fo_attendance) returns jsonb language sql immutable security definer set search_path=public,pg_temp as $$
 select (to_jsonb(a)-array['updated_at','actual_km','total_raw_km','raw_gps_km','filtered_gps_km','actual_travel_km','actual_travel_updated_at'])
 ||jsonb_build_object('metadata',coalesce(a.metadata,'{}')-array['gps_trigger_role','gps_trigger_calculation_version']);
$$;
create function public.fo_km_live_state_v249(a public.fo_attendance) returns jsonb language sql volatile security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('attendance',public.fo_km_live_attendance_input_v249(a),
 'canonical',jsonb_set(public.fo_october_recovery_state(upper(a.employee_code),a.attendance_date),'{attendance}',
 coalesce((select jsonb_agg(case when item->>'id'=a.id::text then item-'updated_at' else item end order by item->>'id') from jsonb_array_elements(public.fo_october_recovery_state(upper(a.employee_code),a.attendance_date)->'attendance')item),'[]')),
 'credits',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.fo_km_incremental_credits c where c.attendance_id=a.id),
 'visits',(select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]') from public.fo_site_visits v where v.attendance_id=a.id),
 'recoveries',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from public.fo_october_km_recoveries r where r.employee_code=upper(a.employee_code) and r.attendance_date=a.attendance_date and r.status='approved'));
$$;

-- Site arrival closes an inbound journey. Checkout itself adds no invented
-- outgoing distance; its update may make an earlier arrival newly verifiable.
create or replace function public.fo_enqueue_km_reconciliation() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.fo_attendance%rowtype;reason text;cutoff timestamptz;
begin
 if tg_table_name='fo_attendance' then
  if new.logout_time is null or (tg_op='UPDATE' and old.logout_time is not null) then return new;end if;
  a:=new;reason:=case when coalesce(new.metadata->>'auto_ended','false')='true' then 'auto_end_day' else 'manual_end_day' end;
 elsif tg_table_name='fo_site_visits' then
  if tg_op='UPDATE' and (new.attendance_id,new.check_in_time,new.check_out_time,new.checkout_time,new.check_in_latitude,new.check_in_longitude,new.check_out_latitude,new.check_out_longitude,new.route_km,new.petrol_eligible_after_checkout,new.status) is not distinct from (old.attendance_id,old.check_in_time,old.check_out_time,old.checkout_time,old.check_in_latitude,old.check_in_longitude,old.check_out_latitude,old.check_out_longitude,old.route_km,old.petrol_eligible_after_checkout,old.status) then return new;end if;
  select * into a from public.fo_attendance where id=new.attendance_id;
  if a.id is null or a.logout_time is not null or lower(a.status)<>'active' or not public.fo_km_live_site_owned_v249(a,new) then return new;end if;
  reason:='site_visit';
 else
  if new.captured_at is null then return new;end if;
  if new.attendance_id is null then
   if (select count(*) from public.fo_attendance x where x.employee_code=coalesce(new.employee_code,new.fo_user_id::text) and new.captured_at>=x.login_time and new.captured_at<=coalesce(x.logout_time,public.fo_km_live_cutoff_v249(x)))<>1 then return new;end if;
   select * into a from public.fo_attendance x where x.employee_code=coalesce(new.employee_code,new.fo_user_id::text) and new.captured_at>=x.login_time and new.captured_at<=coalesce(x.logout_time,public.fo_km_live_cutoff_v249(x));
  else select * into a from public.fo_attendance where id=new.attendance_id;end if;
  cutoff:=coalesce(a.logout_time,public.fo_km_live_cutoff_v249(a));
  if a.id is null or cutoff is null or new.captured_at<a.login_time or new.captured_at>cutoff
  or (a.logout_time is not null and clock_timestamp()>a.logout_time+interval '7 days') or (a.logout_time is null and lower(a.status)<>'active')
  or (new.employee_code is not null and new.employee_code<>a.employee_code) then return new;end if;
  reason:='late_gps';
 end if;
 insert into public.fo_km_reconciliation_jobs(attendance_id,trigger_source,not_before) values(a.id,reason,clock_timestamp()+interval '30 seconds')
 on conflict(attendance_id) do update set generation=fo_km_reconciliation_jobs.generation+1,
 state=case when fo_km_reconciliation_jobs.state='processing' then 'processing' else 'pending' end,
 trigger_source=excluded.trigger_source,attempts=0,
 not_before=case when fo_km_reconciliation_jobs.state in('pending','processing') then least(fo_km_reconciliation_jobs.not_before,excluded.not_before) else excluded.not_before end,updated_at=clock_timestamp();
 insert into public.fo_km_job_provenance(attendance_id,generation,trigger_source,source_table,source_id)
 select a.id,j.generation,reason,tg_table_name,new.id from public.fo_km_reconciliation_jobs j where j.attendance_id=a.id
 on conflict(attendance_id) do update set generation=excluded.generation,trigger_source=excluded.trigger_source,source_table=excluded.source_table,source_id=excluded.source_id,created_at=clock_timestamp();
 return new;
end $$;
create trigger trg_fo_site_visits_canonical_km_queue after insert or update of attendance_id,check_in_time,check_out_time,checkout_time,check_in_latitude,check_in_longitude,check_out_latitude,check_out_longitude,route_km,petrol_eligible_after_checkout,status on public.fo_site_visits for each row execute function public.fo_enqueue_km_reconciliation();

create or replace function public.fo_km_attendance_provenance_v246(a public.fo_attendance,v public.fo_km_job_provenance,r public.profiles) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((v.trigger_source in('manual_end_day','auto_end_day') and v.source_table='fo_attendance' and v.source_id=a.id)
 or (v.trigger_source='site_visit' and v.source_table='fo_site_visits' and exists(select 1 from public.fo_site_visits s where s.id=v.source_id and public.fo_km_live_site_owned_v249(a,s)))
 or (v.trigger_source='late_gps' and v.source_table='fo_location_logs' and exists(select 1 from public.fo_location_logs g where g.id=v.source_id and g.captured_at>=a.login_time and g.captured_at<=coalesce(a.logout_time,public.fo_km_live_cutoff_v249(a))
 and (g.employee_code is null or upper(g.employee_code)=upper(a.employee_code))
 and (g.attendance_id=a.id or (g.attendance_id is null and g.fo_user_id::text in(a.fo_user_id::text,a.employee_code,r.id::text,r.auth_user_id::text)
 and (select count(*) from public.fo_attendance x where x.employee_code=a.employee_code and g.captured_at>=x.login_time and g.captured_at<=coalesce(x.logout_time,public.fo_km_live_cutoff_v249(x)))=1)))),false);
$$;

-- Validate a positive active leg against an actual closed inbound parent.
create function public.fo_km_live_leg_v249(a public.fo_attendance,leg jsonb) returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare destination public.fo_site_visits%rowtype;origin public.fo_site_visits%rowtype;start_at timestamptz;stop_at timestamptz;parent_start timestamptz;segmented boolean;
begin
 if coalesce(leg->>'type','') not in('start_to_first_checkin','site_checkout_to_next_checkin') or leg->>'to_visit_id' is null then return false;end if;
 select * into destination from public.fo_site_visits where id=(leg->>'to_visit_id')::uuid;
 if destination.id is null or not public.fo_km_live_site_owned_v249(a,destination) then return false;end if;
 start_at:=(leg->>'from_time')::timestamptz;stop_at:=(leg->>'to_time')::timestamptz;segmented:=coalesce((leg->>'mode_segment')::boolean,false);
 if segmented and nullif(leg->>'persisted_travel_leg_id','') is null then return false;end if;
 if start_at is null or stop_at is null or stop_at<=start_at or stop_at>destination.check_in_time or stop_at>clock_timestamp() then return false;end if;
 select * into origin from public.fo_site_visits s where s.attendance_id=a.id and (s.check_in_time,s.id)<(destination.check_in_time,destination.id) and public.fo_km_live_site_owned_v249(a,s) order by s.check_in_time desc,s.id desc limit 1;
 if leg->>'type'='start_to_first_checkin' then
  if origin.id is not null or leg->>'from_visit_id' is not null then return false;end if;parent_start:=a.login_time;
 else
  if origin.id is null or leg->>'from_visit_id' is distinct from origin.id::text then return false;end if;
  parent_start:=coalesce(origin.check_out_time,origin.checkout_time);
  if parent_start is null then
   if origin.metadata->>'requires_checkout_review'='true' or coalesce(origin.checkout_distance_meters,0)>1000 or leg->>'from_source' is distinct from 'corroborated_mobile_departure' then return false;end if;
   if not exists(select 1 from public.fo_location_logs g where g.attendance_id=a.id and g.captured_at=start_at and g.captured_at>=origin.check_in_time and g.captured_at<destination.check_in_time and lower(g.source)='mobile' and not coalesce(g.is_mocked,false) and g.accuracy<=50) then return false;end if;
   parent_start:=start_at;
  elsif origin.petrol_eligible_after_checkout is not true then return false;
  elsif not segmented and start_at<>parent_start and leg->>'from_source'='verified_mobile_near_checkout' and exists(select 1 from public.fo_location_logs g where g.attendance_id=a.id and g.captured_at=start_at and abs(extract(epoch from g.captured_at-parent_start))<=120 and lower(g.source)='mobile' and not coalesce(g.is_mocked,false) and g.accuracy<=50) then parent_start:=start_at;
  end if;
 end if;
 return coalesce(start_at>=parent_start and (segmented or (start_at=parent_start and stop_at=destination.check_in_time)),false);
end $$;

do $patch$
declare body text;old text;replacement text;
begin
 -- Exact deployed source anchors; unexpected bodies abort the entire migration.
 body:=replace(pg_get_functiondef('public.fo_km_automatic_eligible(public.fo_attendance)'::regprocedure),E'\r','');
 old:=E'a.logout_time is not null and a.logout_time<=clock_timestamp() and a.attendance_date<=(clock_timestamp() at time zone ''Asia/Kolkata'')::date\n and lower(a.status) in(''completed'',''ended'',''ended day'',''closed'',''auto ended'',''stale auto ended'')';
 replacement:=E'a.attendance_date<=(clock_timestamp() at time zone ''Asia/Kolkata'')::date and ((a.logout_time is not null and a.logout_time<=clock_timestamp() and lower(a.status) in(''completed'',''ended'',''ended day'',''closed'',''auto ended'',''stale auto ended'')) or (a.logout_time is null and lower(a.status)=''active'' and exists(select 1 from public.fo_km_automatic_control where live_site_enabled) and public.fo_km_live_cutoff_v249(a) is not null))';
 if strpos(body,old)=0 then raise exception 'km249_eligibility_anchor';end if;execute replace(body,old,replacement);
 body:=replace(pg_get_functiondef('public.fo_km_require_automatic(uuid,text,uuid)'::regprocedure),E'\r','');old:='p_source not in(''manual_end_day'',''auto_end_day'',''late_gps'')';
 if strpos(body,old)=0 then raise exception 'km249_source_anchor';end if;execute replace(body,old,'p_source not in(''manual_end_day'',''auto_end_day'',''late_gps'',''site_visit'')');
 body:=replace(pg_get_functiondef('public.rpc_fo_km_reconciliation_state_v1(uuid)'::regprocedure),E'\r','');old:='select * into strict a from public.fo_attendance where id=p_attendance_id;';
 if strpos(body,old)=0 then raise exception 'km249_state_anchor';end if;execute replace(body,old,old||E'\n if a.logout_time is null then s:=public.fo_km_live_state_v249(a);return jsonb_build_object(''digest'',md5(s::text),''credits'',s->''credits'');end if;');
 body:=replace(pg_get_functiondef('public.fo_km_attendance_evidence_v246(uuid)'::regprocedure),E'\r','');
 old:='with a as (select * from public.fo_attendance where id=p_attendance),';
 replacement:=E'with a as (select * from public.fo_attendance where id=p_attendance),';
 if strpos(body,old)=0 then raise exception 'km249_evidence_anchor';end if;
 -- Closed attendance executes the original SQL expression unchanged.
 execute replace(body,'FUNCTION public.fo_km_attendance_evidence_v246(', 'FUNCTION public.fo_km_attendance_evidence_closed_v249(');
 body:='CREATE OR REPLACE FUNCTION public.fo_km_attendance_evidence_v246(p_attendance uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $live$declare a public.fo_attendance%rowtype;s jsonb;e jsonb;begin select * into strict a from public.fo_attendance where id=p_attendance;if a.logout_time is null then s:=public.fo_km_live_state_v249(a);e:=jsonb_build_object(''state'',s,''profiles'',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),''[]'') from public.profiles p where upper(btrim(p.employee_code))=upper(btrim(a.employee_code))),''gps'',(select coalesce(jsonb_agg(to_jsonb(g) order by g.id),''[]'') from public.fo_location_logs g where g.captured_at>=a.login_time and g.captured_at<=public.fo_km_live_cutoff_v249(a) and (g.attendance_id=a.id or(g.attendance_id is null and (upper(g.employee_code)=upper(a.employee_code) or g.fo_user_id::text in(a.fo_user_id::text,a.employee_code) or exists(select 1 from public.profiles p where p.employee_code=a.employee_code and g.fo_user_id::text in(p.id::text,p.auth_user_id::text)))))));return jsonb_build_object(''evidence_digest'',encode(sha256(convert_to(e::text,''UTF8'')),''hex''),''snapshot'',md5(s::text),''credit_km'',(select coalesce(sum(added_km),0) from public.fo_km_incremental_credits where attendance_id=a.id),''credit_amount'',(select coalesce(sum(amount),0) from public.fo_km_incremental_credits where attendance_id=a.id));end if;return public.fo_km_attendance_evidence_closed_v249(p_attendance);end $live$';
 execute body;
 body:=replace(pg_get_functiondef('public.fo_reconcile_km_239_core(uuid,jsonb,text,uuid,uuid)'::regprocedure),E'\r','');
 old:='p_trigger not in(''admin_recalculation'',''manual_end_day'',''auto_end_day'',''late_gps'')';if strpos(body,old)=0 then raise exception 'km249_core_source_anchor';end if;body:=replace(body,old,'p_trigger not in(''admin_recalculation'',''manual_end_day'',''auto_end_day'',''late_gps'',''site_visit'')');
 old:='if a.logout_time is null then raise exception ''km_completed_attendance_required'' using errcode=''55000'';end if;';
 replacement:='if a.logout_time is null and not exists(select 1 from public.fo_km_policy_executions e where e.transaction_id=txid_current() and e.attendance_id=a.id and e.automatic and e.receipt_id is null and e.trigger_source=p_trigger and e.lease=p_lease and p_trigger in(''site_visit'',''late_gps'') and lower(a.status)=''active'' and exists(select 1 from public.fo_km_automatic_control where enabled and live_site_enabled)) then raise exception ''km_completed_attendance_required'' using errcode=''55000'';end if;';
 if strpos(body,old)=0 then raise exception 'km249_core_active_anchor';end if;body:=replace(body,old,replacement);
 old:='if coalesce((leg->>''new_eligible_km'')::numeric,0)<=0 then continue;end if;';if strpos(body,old)=0 then raise exception 'km249_core_leg_anchor';end if;
 body:=replace(body,old,old||E'\n if a.logout_time is null and not public.fo_km_live_leg_v249(a,leg) then raise exception ''km_live_closed_journey_required'' using errcode=''22023'';end if;');execute body;
 -- Retire only the unreceipted SUM writer while the general gate is closed.
 -- It must not roll back raw visit insertion merely because money is held.
 if to_regprocedure('public.trg_refresh_fo_attendance_payable_route_km()') is not null then
  if (select md5(replace(prosrc,E'\r','')) from pg_proc where oid='public.trg_refresh_fo_attendance_payable_route_km()'::regprocedure) is distinct from 'f4f29e61135f429280736e3167d6a6d7' then raise exception 'km249_legacy_trigger_drift';end if;
  body:=replace(pg_get_functiondef('public.trg_refresh_fo_attendance_payable_route_km()'::regprocedure),E'\r','');old:=E'begin\n';if strpos(body,old)=0 then raise exception 'km249_legacy_anchor';end if;
  execute replace(body,old,old||E' if not exists(select 1 from public.fo_km_financial_control where control_key=''canonical_v2'' and financial_writes_enabled) then return coalesce(new,old);end if;\n');
 end if;
end $patch$;
revoke all on function public.fo_km_attendance_evidence_closed_v249(uuid),public.fo_km_live_site_owned_v249(public.fo_attendance,public.fo_site_visits),public.fo_km_live_cutoff_v249(public.fo_attendance),public.fo_km_live_attendance_input_v249(public.fo_attendance),public.fo_km_live_state_v249(public.fo_attendance),public.fo_km_live_leg_v249(public.fo_attendance,jsonb) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
