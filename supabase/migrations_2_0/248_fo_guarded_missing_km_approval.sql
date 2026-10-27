-- Exact reviewed increments only. No ordinary gate, emergency or worker changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if session_user<>'postgres' then raise exception 'km248_owner_required';end if;
 if (select md5(replace(prosrc,E'\r','')) from pg_proc where oid='public.fo_km_scope_ledger_guard()'::regprocedure) is distinct from '7cde129f0f70195652eaa5c418157f38'
 or (select md5(replace(prosrc,E'\r','')) from pg_proc where oid='public.fo_km_scope_financial_guard()'::regprocedure) is distinct from '5fb97145695a5c693cfe7a30cf7e6e75'
 or to_regclass('public.fo_km_automatic_control') is null then raise exception 'km248_dependency_drift';end if;
end $$;

create table public.fo_km_missing_approval_control(
 control_key text primary key check(control_key='checkout_exception'),
 enabled boolean not null default false,
 reason text not null default 'Installed disabled', updated_at timestamptz not null default clock_timestamp()
);
insert into public.fo_km_missing_approval_control(control_key) values('checkout_exception');
alter table public.fo_km_missing_approval_control enable row level security;
revoke all on public.fo_km_missing_approval_control from public,anon,authenticated,service_role;
alter table public.fo_km_policy_executions add column missing_review_id uuid references public.fo_missing_km_reviews(id);
create unique index fo_km_missing_review_execution on public.fo_km_policy_executions(missing_review_id) where missing_review_id is not null;

create function public.fo_km_missing_approval_audit() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$begin
 if tg_table_name='fo_km_policy_executions' then
  if old.missing_review_id is not null and (tg_op='DELETE' or old.result is not null) then raise exception 'km_missing_receipt_immutable' using errcode='55000';end if;
 elsif tg_table_name='fo_missing_km_reviews' then
  if exists(select 1 from public.fo_km_policy_executions where missing_review_id=old.id and result is not null) then raise exception 'km_missing_decision_immutable' using errcode='55000';end if;
 else
  if tg_op='DELETE' then raise exception 'km_missing_control_delete_denied';end if;
  if nullif(btrim(new.reason),'') is null then raise exception 'km_missing_control_reason_required';end if;
  new.updated_at:=clock_timestamp();
  insert into public.fo_km_policy_audit(event,detail) values('missing_approval_control',jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(new),'session_user',session_user));
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger km_missing_execution_immutable before update or delete on public.fo_km_policy_executions for each row execute function public.fo_km_missing_approval_audit();
create trigger km_missing_decision_immutable before update or delete on public.fo_missing_km_reviews for each row execute function public.fo_km_missing_approval_audit();
create trigger km_missing_control_audit before update or delete on public.fo_km_missing_approval_control for each row execute function public.fo_km_missing_approval_audit();

-- Private execution rows, never a client GUC, admit just one exact receipt/update.
create function public.fo_km_missing_credit_allowed(p_attendance uuid,p_digest text,p_actor uuid,p_evidence jsonb) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.fo_km_policy_executions e join public.fo_km_missing_approval_control c on c.enabled
 where e.transaction_id=txid_current() and e.attendance_id=p_attendance and e.missing_review_id is not null
 and e.trigger_source='missing_km_approval' and e.result is null and e.admin_id=p_actor and e.input_digest=p_digest and e.calculation=p_evidence);
$$;
do $patch$declare body text;begin
 body:=replace(pg_get_functiondef('public.fo_km_scope_ledger_guard()'::regprocedure),E'\r','');
 if (length(body)-length(replace(body,E'begin\n','')))<>length(E'begin\n') then raise exception 'km248_ledger_anchor_drift';end if;
 body:=replace(body,E'begin\n',E'begin\n if new.trigger_source=''missing_km_approval'' and public.fo_km_missing_credit_allowed(new.attendance_id,new.input_digest,new.actor,new.evidence) then return new;end if;\n');execute body;
 body:=replace(pg_get_functiondef('public.fo_km_scope_financial_guard()'::regprocedure),E'\r','');
 if (length(body)-length(replace(body,E'begin\n','')))<>length(E'begin\n') then raise exception 'km248_financial_anchor_drift';end if;
 body:=replace(body,E'begin\n',E'begin\n if tg_op=''UPDATE'' and exists(select 1 from public.fo_km_incremental_credits credit where credit.attendance_id=new.id and credit.transaction_id=txid_current() and credit.trigger_source=''missing_km_approval'' and credit.applied_to_attendance and public.fo_km_missing_credit_allowed(credit.attendance_id,credit.input_digest,credit.actor,credit.evidence) and credit.evidence->''canonical_after''=jsonb_build_object(''total_approved_km'',new.total_approved_km,''eligible_km'',new.eligible_km,''total_route_km'',new.total_route_km,''petrol_amount'',new.petrol_amount)) then return new;end if;\n');execute body;
end $patch$;

create function public.rpc_approve_fo_missing_km_v1(p_review_id uuid,p_expected_review_updated_at timestamptz,
 p_admin_user_id uuid,p_approved_km numeric,p_reason text,p_manual_override boolean default false,p_elevated_override boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.fo_missing_km_reviews%rowtype;a public.fo_attendance%rowtype;v public.fo_site_visits%rowtype;
 actor public.profiles%rowtype;prior public.fo_km_policy_executions%rowtype;exec_id uuid;receipt uuid;
 window_start timestamptz;window_end timestamptz;included numeric;reviewed_included numeric;delta numeric;amount numeric;rate numeric;bound numeric;
 credit_km numeric;credit_amount numeric;digest text;evidence jsonb;v_result jsonb;previous_context text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'km_missing_service_required' using errcode='42501';end if;
 select * into strict actor from public.profiles where auth_user_id=p_admin_user_id for share;
 if actor.is_active is not true or actor.web_access_enabled is false or lower(coalesce(actor.status,'')) in('inactive','disabled','deactivated')
 or regexp_replace(upper(actor.role),'[^A-Z0-9]','','g') not in('ADMIN','QPMSADMIN','SUPERADMIN','DEVELOPER') or nullif(btrim(actor.employee_code),'') is null
 then raise exception 'km_missing_admin_required' using errcode='42501';end if;
 if p_approved_km is null or p_approved_km<0 or p_approved_km>='Infinity'::numeric or p_approved_km<>round(p_approved_km,2)
 or nullif(btrim(p_reason),'') is null then raise exception 'km_missing_input_invalid' using errcode='22023';end if;
 -- Locate only; lock order matches the ordinary worker: attendance, then review.
 select * into strict r from public.fo_missing_km_reviews where id=p_review_id;
 perform pg_advisory_xact_lock(hashtextextended(r.attendance_id::text,0));
 select * into strict a from public.fo_attendance where id=r.attendance_id for update;
 select * into strict r from public.fo_missing_km_reviews where id=p_review_id for update;
 if a.id<>r.attendance_id or upper(btrim(actor.employee_code))=upper(btrim(a.employee_code))
 or a.fo_user_id::text in(actor.id::text,actor.auth_user_id::text,actor.employee_code) then raise exception 'km_missing_self_or_identity_denied' using errcode='42501';end if;
 select * into prior from public.fo_km_policy_executions where missing_review_id=r.id;
 if found then
  if prior.result is null or (prior.result->>'requested_km')::numeric is distinct from p_approved_km then raise exception 'km_missing_approved_value_protected' using errcode='40001';end if;
  return prior.result||jsonb_build_object('idempotent_replay',true,'additionalKm',0,'additionalAmount',0,'payable_km',a.total_approved_km,'reimbursement',a.petrol_amount,'total_route_km',a.total_route_km);
 end if;
 perform 1 from public.fo_km_missing_approval_control where enabled for share;
 if not found then raise exception 'km_missing_approval_paused' using errcode='55000';end if;
 perform 1 from public.fo_km_financial_control where control_key='canonical_v2' and not financial_writes_enabled for share;
 if not found then raise exception 'km_missing_requires_closed_general_gate' using errcode='55000';end if;
 if r.status not in('pending','clarification_required') or r.updated_at is distinct from p_expected_review_updated_at then raise exception 'km_missing_review_stale_or_protected' using errcode='40001';end if;
 select * into strict v from public.fo_site_visits where id=r.site_visit_id for update;
 window_start:=v.check_in_time;window_end:=coalesce(v.check_out_time,v.checkout_time);
 if v.attendance_id is distinct from a.id or r.employee_code is distinct from a.employee_code or v.employee_code is distinct from a.employee_code
 or a.employee_code!~'^[A-Z0-9_-]+$' or r.review_type<>'checkout_exception'
 or a.logout_time is null or a.logout_time>clock_timestamp() or lower(a.status) not in('completed','ended','ended day','closed','auto ended','stale auto ended')
 or window_start is null or window_end is null or window_end<=window_start or window_start<a.login_time or window_end>a.logout_time
 or date_trunc('milliseconds',r.window_start_time) is distinct from date_trunc('milliseconds',window_start)
 or date_trunc('milliseconds',r.window_end_time) is distinct from date_trunc('milliseconds',window_end)
 or (select count(*) from public.profiles p where p.employee_code=a.employee_code and p.is_active and lower(coalesce(p.status,'')) not in('inactive','disabled','deactivated') and a.fo_user_id::text in(p.id::text,p.auth_user_id::text,p.employee_code))<>1
 then raise exception 'km_missing_evidence_binding_invalid' using errcode='42501';end if;
 -- Settlement locks prevent concurrent approval from racing this additive write.
 lock table public.fo_monthly_travel_settlements,public.fo_october_km_recoveries,public.fo_travel_reimbursement_corrections in share mode;
 if exists(select 1 from public.fo_monthly_travel_settlements s where s.employee_code=a.employee_code and a.attendance_date between s.period_start and s.period_end)
 or exists(select 1 from public.fo_october_km_recoveries s where s.employee_code=a.employee_code and s.attendance_date=a.attendance_date and s.status='approved')
 or exists(select 1 from public.fo_travel_reimbursement_corrections s where s.attendance_id=a.id and s.status='applied')
 then raise exception 'km_missing_settled_or_corrected_protected' using errcode='55000';end if;
 select coalesce(sum(added_km),0),coalesce(sum(credit.amount),0) into credit_km,credit_amount from public.fo_km_incremental_credits credit where attendance_id=a.id and applied_to_attendance;
 if credit_km>='Infinity'::numeric or credit_amount>='Infinity'::numeric or
 (a.total_approved_km,a.eligible_km,a.total_route_km,a.petrol_amount) is distinct from (credit_km,credit_km,credit_km,credit_amount)
 then raise exception 'km_missing_financial_baseline_unknown' using errcode='55000';end if;
 if not a.payable_km_allowed or a.travel_mode not in('bike','own_vehicle','car') then raise exception 'km_missing_nonpayable_mode' using errcode='22023';end if;
 rate:=case when a.travel_mode='car' then 8 else 4 end;
 if a.rate_per_km<>rate or r.rate_per_km is distinct from rate or exists(select 1 from public.fo_travel_legs l where l.attendance_id=a.id and l.status<>'cancelled' and l.superseded_at is null and l.started_at<window_end and l.ended_at>window_start and (l.travel_mode<>a.travel_mode or l.payable_km_allowed is false))
 then raise exception 'km_missing_rate_or_mode_requires_review' using errcode='22023';end if;
 if r.metadata->>'incremental_determination'='requires_review' and not coalesce(p_manual_override,false) then raise exception 'km_missing_clarification_required' using errcode='22023';end if;
 reviewed_included:=coalesce((r.metadata->>'already_included_km')::numeric,0);
 bound:=greatest((r.metadata->>'detected_missing_km')::numeric,r.filtered_gps_km,r.google_route_km);
 if bound is null or bound<0 or bound>='Infinity'::numeric or reviewed_included<0 or reviewed_included>='Infinity'::numeric
 or (coalesce(p_manual_override,false) and p_approved_km>greatest(0,bound-reviewed_included)+0.001)
 or (not coalesce(p_manual_override,false) and p_approved_km>r.suggested_missing_km+0.01 and not coalesce(p_elevated_override,false))
 or p_approved_km>greatest(0,bound-reviewed_included)+0.001 then raise exception 'km_missing_evidence_ceiling' using errcode='22023';end if;
 -- Only whole recorded windows can establish inclusion. Partial overlap is ambiguous.
 if exists(select 1 from public.fo_km_incremental_credits c where c.attendance_id=a.id and c.started_at<window_end and c.ended_at>window_start and (c.started_at<window_start or c.ended_at>window_end))
 or exists(select 1 from public.fo_travel_legs l where l.attendance_id=a.id and l.superseded_at is null and l.status in('completed','calculated') and coalesce(l.payable_km,0)>0 and l.started_at<window_end and l.ended_at>window_start and (l.started_at<window_start or l.ended_at>window_end))
 then raise exception 'km_missing_partial_overlap_requires_review' using errcode='55000';end if;
 select coalesce(sum(c.added_km),0) into included from public.fo_km_incremental_credits c where c.attendance_id=a.id and c.started_at>=window_start and c.ended_at<=window_end;
 -- Saved leg values may describe those same receipt-backed KM: never count twice.
 included:=greatest(included,coalesce((select sum(l.payable_km) from public.fo_travel_legs l where l.attendance_id=a.id and l.superseded_at is null and l.status in('completed','calculated') and l.started_at>=window_start and l.ended_at<=window_end),0));
 if reviewed_included>included+0.001 then raise exception 'km_missing_inclusion_evidence_changed' using errcode='40001';end if;
 delta:=round(greatest(0,p_approved_km-greatest(0,included-reviewed_included)),2);amount:=round(delta*rate,2);
 digest:=encode(sha256(convert_to(jsonb_build_object('review',to_jsonb(r),'visit',to_jsonb(v),'attendance',to_jsonb(a),'requested',p_approved_km,'included',included,'actor',p_admin_user_id,'reason',p_reason)::text,'UTF8')),'hex');
 evidence:=jsonb_build_object('type','checkout_exception_approval','review_id',r.id,'requested_km',p_approved_km,'already_included_km',included,'reviewed_included_km',reviewed_included,'reason',btrim(p_reason),'approver_user_id',p_admin_user_id,'approver_identity',actor.employee_code,'before',jsonb_build_object('total_approved_km',a.total_approved_km,'eligible_km',a.eligible_km,'total_route_km',a.total_route_km,'petrol_amount',a.petrol_amount),'canonical_after',jsonb_build_object('total_approved_km',a.total_approved_km+delta,'eligible_km',a.eligible_km+delta,'total_route_km',a.total_route_km+delta,'petrol_amount',a.petrol_amount+amount));
 insert into public.fo_km_policy_executions(attendance_id,trigger_source,admin_id,input_digest,calculation,missing_review_id) values(a.id,'missing_km_approval',p_admin_user_id,digest,evidence,r.id) returning id into exec_id;
 receipt:=exec_id;
 if delta>0 then
  insert into public.fo_km_incremental_credits(attendance_id,employee_code,attendance_date,leg_key,input_digest,started_at,ended_at,baseline_km,added_km,rate,amount,applied_to_attendance,actor,trigger_source,evidence)
  values(a.id,a.employee_code,a.attendance_date,encode(sha256(convert_to(a.id::text||':checkout_exception:'||v.id::text,'UTF8')),'hex'),digest,window_start,window_end,included,delta,rate,amount,true,p_admin_user_id,'missing_km_approval',evidence) returning id into receipt;
  previous_context:=current_setting('app.km_v2_authorized_financial_write',true);
  perform set_config('app.km_v2_authorized_financial_write','true',true);
  update public.fo_attendance set eligible_km=eligible_km+delta,total_approved_km=total_approved_km+delta,total_route_km=total_route_km+delta,petrol_amount=petrol_amount+amount,route_sync_status='canonical_v2_incremental_persisted',metadata=metadata||jsonb_build_object('shared_km_last_receipt',receipt),updated_at=clock_timestamp() where id=a.id returning * into a;
  perform set_config('app.km_v2_authorized_financial_write',coalesce(previous_context,''),true);
 end if;
 update public.fo_missing_km_reviews set status='approved',approved_missing_km=delta,approved_amount=amount,reviewer_employee_code=actor.employee_code,reviewer_name=coalesce(actor.full_name,actor.display_name,actor.employee_code),reviewed_at=clock_timestamp(),review_remarks=btrim(p_reason),requested_clarification=null,updated_at=clock_timestamp(),metadata=metadata||jsonb_build_object('missing_km_approval_receipt_id',receipt,'missing_km_approval_requested_km',p_approved_km,'missing_km_approval_included_km',included,'reviewed_by_role',actor.role,'manual_override',p_manual_override) where id=r.id returning * into r;
 update public.fo_site_visits set metadata=coalesce(metadata,'{}')||jsonb_build_object('checkout_review_status','approved','checkout_review_id',r.id,'approved_missing_checkout_km',delta,'approved_missing_checkout_amount',amount,'checkout_review_last_action_at',r.reviewed_at,'checkout_review_remarks',r.review_remarks),updated_at=clock_timestamp() where id=v.id;
 v_result:=jsonb_build_object('ok',true,'receipt_id',receipt,'review',to_jsonb(r),'requested_km',p_approved_km,'additionalKm',delta,'additionalAmount',amount,'payable_km',a.total_approved_km,'reimbursement',a.petrol_amount,'total_route_km',a.total_route_km,'approved_missing_km',(select sum(approved_missing_km) from public.fo_missing_km_reviews where attendance_id=a.id and status='approved'),'approved_missing_review_count',(select count(*) from public.fo_missing_km_reviews where attendance_id=a.id and status='approved'));
 update public.fo_km_policy_executions set receipt_id=case when delta>0 then receipt end,result=v_result where id=exec_id;
 insert into public.fo_km_policy_audit(event,detail) values('missing_km_approved',v_result||jsonb_build_object('execution_id',exec_id,'approver_user_id',p_admin_user_id,'reason',btrim(p_reason)));
 return v_result;
end $$;
revoke all on function public.fo_km_missing_approval_audit(),public.fo_km_missing_credit_allowed(uuid,text,uuid,jsonb),public.rpc_approve_fo_missing_km_v1(uuid,timestamptz,uuid,numeric,text,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.rpc_approve_fo_missing_km_v1(uuid,timestamptz,uuid,numeric,text,boolean,boolean) to service_role;
commit;
