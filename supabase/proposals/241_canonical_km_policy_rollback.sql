-- Separate rollback approval. Preserve policy/credit history; disable instead after use.
begin;
set local lock_timeout='5s';
lock table public.fo_km_canonical_policy,public.fo_km_job_provenance,public.fo_km_policy_executions,public.fo_km_policy_audit in access exclusive mode;
do $$begin if exists(select 1 from public.fo_km_policy_executions) or exists(select 1 from public.fo_km_policy_audit) or exists(select 1 from public.fo_km_canonical_policy where enabled) then raise exception 'km241_rollback_preserve_history';end if;end $$;
create or replace function public.fo_enqueue_km_reconciliation() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.fo_attendance%rowtype; reason text;
begin
 if tg_table_name='fo_attendance' then
   if new.logout_time is null or (tg_op='UPDATE' and old.logout_time is not null) then return new;end if;
   a:=new;reason:=case when coalesce(new.metadata->>'auto_ended','false')='true' then 'auto_end_day' else 'manual_end_day' end;
 else
   -- Bounded late-sync follow-up, using original capture time and exact ownership.
   if new.captured_at is null then return new;end if;
   if new.attendance_id is null then
     if (select count(*) from public.fo_attendance x where x.logout_time is not null
       and x.employee_code=coalesce(new.employee_code,new.fo_user_id::text)
       and new.captured_at>=x.login_time and new.captured_at<=x.logout_time)<>1 then return new;end if;
     select * into a from public.fo_attendance x where x.logout_time is not null
       and x.employee_code=coalesce(new.employee_code,new.fo_user_id::text)
       and new.captured_at>=x.login_time and new.captured_at<=x.logout_time;
   else select * into a from public.fo_attendance where id=new.attendance_id;end if;
   if a.id is null or a.logout_time is null or new.captured_at<a.login_time
      or new.captured_at>a.logout_time or now()>a.logout_time+interval '7 days'
      or (new.employee_code is not null and new.employee_code<>a.employee_code) then return new;end if;
   reason:='late_gps';
 end if;
 insert into public.fo_km_reconciliation_jobs(attendance_id,trigger_source,not_before)
 values(a.id,reason,now()+interval '30 seconds') on conflict(attendance_id) do update
 set generation=fo_km_reconciliation_jobs.generation+1,state=case when fo_km_reconciliation_jobs.state='processing' then 'processing' else 'pending' end,
 trigger_source=excluded.trigger_source,attempts=0,not_before=excluded.not_before,updated_at=now();
 return new;
end $$;

create or replace function public.fo_km_scope_ledger_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.fo_km_financial_control where control_key='canonical_v2' and financial_writes_enabled) then return new;end if;
 if not exists(select 1 from public.fo_km_scope_executions e join public.fo_km_scope_authorizations s using(reference) join public.fo_km_scope_control c on c.control_key='admin_acceptance'
 where e.transaction_id=txid_current() and e.receipt_id is null and e.attendance_id=new.attendance_id and e.admin_auth_user_id=new.actor and e.input_digest=new.input_digest
 and s.revoked_at is null and clock_timestamp()>=s.starts_at and clock_timestamp()<s.expires_at and not c.emergency_pause and clock_timestamp()<c.release_until and new.trigger_source='admin_recalculation') then raise exception 'km_scope_ledger_denied' using errcode='42501';end if;
 return new;
end $$;

create or replace function public.fo_km_scope_financial_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.fo_km_financial_control where control_key='canonical_v2' and financial_writes_enabled) then return new;end if;
 if tg_op='INSERT' then
   if coalesce(new.total_approved_km,0)=0 and coalesce(new.eligible_km,0)=0 and coalesce(new.total_route_km,0)=0 and coalesce(new.petrol_amount,0)=0 then return new;end if;
 else
   if (new.total_approved_km,new.eligible_km,new.total_route_km,new.petrol_amount) is not distinct from (old.total_approved_km,old.eligible_km,old.total_route_km,old.petrol_amount) then return new;end if;
   if exists(select 1 from public.fo_km_scope_executions e join public.fo_km_incremental_credits c on c.attendance_id=e.attendance_id and c.input_digest=e.input_digest and c.transaction_id=e.transaction_id
    where e.transaction_id=txid_current() and e.receipt_id is null and e.attendance_id=new.id and c.applied_to_attendance and c.evidence->'canonical_after'=jsonb_build_object('total_approved_km',new.total_approved_km,'eligible_km',new.eligible_km,'total_route_km',new.total_route_km,'petrol_amount',new.petrol_amount)) then return new;end if;
 end if;
 raise exception 'km_scope_unrelated_financial_write_denied' using errcode='42501';
end $$;
drop trigger km_canonical_policy_audit on public.fo_km_canonical_policy;
drop function public.fo_km_require_canonical_policy(text);
drop function public.rpc_claim_fo_policy_km_v1();
drop function public.rpc_reconcile_fo_policy_km_v1(uuid,jsonb,text,uuid,uuid);
drop function public.fo_km_policy_credit_allowed(uuid,text,text,uuid);
drop function public.fo_km_policy_control_audit();
drop table public.fo_km_policy_audit,public.fo_km_policy_executions,public.fo_km_job_provenance,public.fo_km_canonical_policy;
commit;
