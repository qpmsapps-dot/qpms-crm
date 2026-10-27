-- Bounded final-only historical repair through the existing worker/ledger.
-- No activation or financial writes on installation; protected baselines stay excluded.
begin;set local lock_timeout='5s';set local statement_timeout='30s';
do $$declare f record;begin
 if session_user<>'postgres' then raise exception 'km251_owner_required';end if;
 for f in select * from(values('public.fo_km_require_automatic(uuid,text,uuid)','098050d5453d00f8408815f08da06512'),('public.rpc_claim_fo_automatic_km_v1()','89e8c6a88adb968d1c1400385cb89467'),('public.rpc_reconcile_fo_automatic_km_v1(uuid,jsonb,text,uuid,uuid)','424bbb0b40fbb6fe149c58bca1cde763'))x(signature,hash) loop
 if (select md5(replace(prosrc,E'\r','')) from pg_proc where oid=to_regprocedure(f.signature)) is distinct from f.hash then raise exception 'km251_dependency_drift: %',f.signature;end if;end loop;
end $$;
alter table public.fo_km_reconciliation_jobs add column final_leg_only boolean not null default false;
do $patch$declare body text;old text;begin
 body:=replace(pg_get_functiondef('public.fo_km_require_automatic(uuid,text,uuid)'::regprocedure),E'\r','');old:='a.attendance_date<c.effective_from';if strpos(body,old)=0 then raise exception 'km251_require_anchor';end if;
 execute replace(body,old,'(a.attendance_date<c.effective_from and not j.final_leg_only)');
 body:=replace(pg_get_functiondef('public.rpc_claim_fo_automatic_km_v1()'::regprocedure),E'\r','');old:='a.attendance_date>=c.effective_from';if strpos(body,old)=0 then raise exception 'km251_claim_anchor';end if;execute replace(body,old,'(a.attendance_date>=c.effective_from or(q.final_leg_only and a.logout_time is not null))');
 body:=replace(pg_get_functiondef('public.rpc_reconcile_fo_automatic_km_v1(uuid,jsonb,text,uuid,uuid)'::regprocedure),E'\r','');old:='c:=public.fo_km_require_automatic(p_attendance_id,p_trigger,p_lease);';if strpos(body,old)=0 then raise exception 'km251_reconcile_anchor';end if;
 execute replace(body,old,old||E'\n if j.final_leg_only and (p_calculation->>''finalLegOnly'' is distinct from ''true'' or exists(select 1 from jsonb_array_elements(p_calculation->''legs'') l where coalesce((l->>''new_eligible_km'')::numeric,0)>0 and l->>''type'' is distinct from ''last_checkout_to_end_day'')) then raise exception ''km_final_only_plan_required'' using errcode=''42501'';end if;');
 body:=replace(pg_get_functiondef('public.fo_enqueue_km_reconciliation()'::regprocedure),E'\r','');old:='trigger_source=excluded.trigger_source,attempts=0,';if strpos(body,old)=0 then raise exception 'km251_enqueue_anchor';end if;execute replace(body,old,'trigger_source=excluded.trigger_source,attempts=0,final_leg_only=false,');
 body:=replace(pg_get_functiondef('public.fo_km_preserve_incremental_baseline()'::regprocedure),E'\r','');
 old:='where key in(''shared_km_last_receipt'',''km_calculation_version'',''financial_authority'',''km_recalculation_status'',''shared_km_final_leg'')';
 if strpos(body,old)=0 then raise exception 'km251_final_metadata_anchor';end if;
 execute replace(body,old,old||' and not(key=''shared_km_final_leg'' and exists(select 1 from public.fo_km_policy_audit audit where audit.transaction_id=txid_current() and audit.event=''final_leg_evidence_result'' and audit.detail->>''attendance_id''=new.id::text and audit.detail->''final''=new.metadata->''shared_km_final_leg''))');
end $patch$;

create function public.fo_queue_final_leg_reconciliation_v251(p_attendances uuid[],p_reason text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid;a public.fo_attendance%rowtype;j public.fo_km_reconciliation_jobs%rowtype;queued jsonb:='[]';
begin
 if session_user<>'postgres' then raise exception 'km_final_queue_owner_required' using errcode='42501';end if;
 if p_attendances is null or cardinality(p_attendances) not between 1 and 10 or nullif(btrim(p_reason),'') is null then raise exception 'km_final_queue_bounded_batch_required';end if;
 perform 1 from public.fo_km_automatic_control where enabled and canary is null for share;if not found or exists(select 1 from public.fo_km_financial_control where financial_writes_enabled) then raise exception 'km_final_queue_controls_held';end if;
 foreach target in array p_attendances loop
 perform pg_advisory_xact_lock(hashtextextended(target::text,0));select * into strict a from public.fo_attendance where id=target for update;
 if a.logout_time is null or not public.fo_km_automatic_eligible(a) then raise exception 'km_final_queue_baseline_or_settlement_ineligible: %',target;end if;
 select * into j from public.fo_km_reconciliation_jobs where attendance_id=target for update;
 if j.state='processing' and j.lease_until>clock_timestamp() then raise exception 'km_final_queue_conflicting_lease';end if;
 insert into public.fo_km_reconciliation_jobs(attendance_id,trigger_source,not_before,final_leg_only) values(target,'manual_end_day',clock_timestamp()+interval '30 seconds',true)
 on conflict(attendance_id) do update set generation=fo_km_reconciliation_jobs.generation+1,trigger_source='manual_end_day',state='pending',attempts=0,not_before=excluded.not_before,lease=null,lease_until=null,claimed_generation=null,claimed_evidence_digest=null,last_error=null,final_leg_only=true,updated_at=clock_timestamp() returning * into j;
 insert into public.fo_km_job_provenance(attendance_id,generation,trigger_source,source_table,source_id) values(target,j.generation,'manual_end_day','fo_attendance',target)
 on conflict(attendance_id) do update set generation=excluded.generation,trigger_source=excluded.trigger_source,source_table=excluded.source_table,source_id=excluded.source_id,created_at=clock_timestamp();
 queued:=queued||jsonb_build_array(jsonb_build_object('attendance_id',target,'generation',j.generation));end loop;
 insert into public.fo_km_policy_audit(event,detail) values('bounded_final_leg_reconciliation',jsonb_build_object('reason',btrim(p_reason),'queued',queued,'session_user',session_user));return queued;
end $$;
revoke all on function public.fo_queue_final_leg_reconciliation_v251(uuid[],text) from public,anon,authenticated,service_role;
create function public.rpc_record_final_leg_evidence_v251(p_attendance uuid,p_lease uuid,p_final jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.fo_attendance%rowtype;j public.fo_km_reconciliation_jobs%rowtype;receipt record;recorded jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'km_service_required' using errcode='42501';end if;
 select * into strict a from public.fo_attendance where id=p_attendance for update;select * into strict j from public.fo_km_reconciliation_jobs where attendance_id=a.id for update;
 perform public.fo_km_require_automatic(a.id,j.trigger_source,p_lease);
 if not j.final_leg_only or a.logout_time is null or j.generation<>j.claimed_generation or p_final->>'type' is distinct from 'last_checkout_to_end_day' then raise exception 'km_final_evidence_context_required' using errcode='42501';end if;
 recorded:=p_final;
 select c.id,c.evidence into receipt from public.fo_km_incremental_credits c where c.attendance_id=a.id and c.evidence->>'type'='last_checkout_to_end_day' order by c.created_at desc,c.id desc limit 1;
 if receipt.id is not null then recorded:=receipt.evidence||jsonb_build_object('financial_receipt_id',receipt.id,'last_reconciliation_additional_km',coalesce((p_final->>'new_eligible_km')::numeric,0));
 elsif p_final->>'evidence_status' is distinct from 'supported' then recorded:=recorded||jsonb_build_object('new_eligible_km',null,'payable_km',null);end if;
 insert into public.fo_km_policy_audit(event,detail) values('final_leg_evidence_result',jsonb_build_object('attendance_id',a.id,'generation',j.generation,'final',recorded));
 update public.fo_attendance set metadata=coalesce(metadata,'{}')||jsonb_build_object('shared_km_final_leg',recorded,'final_return_leg_km',case when receipt.id is not null or recorded->>'evidence_status'='supported' then (recorded->>'payable_km')::numeric else null end,'final_return_leg_provider',recorded->>'source','final_return_leg_reason',recorded->>'evidence_status','final_leg_last_verified_at',clock_timestamp()),updated_at=clock_timestamp() where id=a.id;
end $$;
revoke all on function public.rpc_record_final_leg_evidence_v251(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.rpc_record_final_leg_evidence_v251(uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';commit;
