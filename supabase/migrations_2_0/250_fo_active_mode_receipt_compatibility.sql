-- Nonfinancial mode changes remain available after a live receipt. No repricing.
begin;set local lock_timeout='5s';set local statement_timeout='30s';
do $$declare body text;expected text;begin
 if session_user<>'postgres' or to_regprocedure('public.fo_km_live_leg_v249(public.fo_attendance,jsonb)') is null then raise exception 'km250_owner_and_249_required';end if;
 select replace(prosrc,E'\r','') into body from pg_proc where oid='public.fo_km_preserve_incremental_baseline()'::regprocedure;
 if md5(body) is distinct from 'b6d14b44a5dc67cee6a2d49ee41cd1c5' then raise exception 'km250_baseline_fingerprint_drift';end if;
 expected:=E'if (new.employee_code,new.attendance_date,new.travel_mode,new.rate_per_km,new.payable_km_allowed) is distinct from (old.employee_code,old.attendance_date,old.travel_mode,old.rate_per_km,old.payable_km_allowed) then raise exception ''km_incremental_identity_mode_protected'' using errcode=''55000'';end if;';
 if strpos(body,expected)=0 or strpos(body,'km_incremental_baseline_protected')=0 or strpos(body,'transaction_id=txid_current()')=0 then raise exception 'km250_baseline_guard_drift';end if;
end $$;
create or replace function public.fo_km_preserve_incremental_baseline() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare target jsonb;financial_same boolean;mode_changed boolean;
begin
 if not exists(select 1 from public.fo_km_incremental_credits where attendance_id=old.id) then return case when tg_op='DELETE' then old else new end;end if;
 if tg_op='DELETE' then raise exception 'km_incremental_baseline_protected' using errcode='55000';end if;
 if (new.id,new.employee_code,new.fo_user_id,new.attendance_date) is distinct from (old.id,old.employee_code,old.fo_user_id,old.attendance_date) then raise exception 'km_incremental_identity_mode_protected' using errcode='55000';end if;
 financial_same:=(new.total_approved_km,new.eligible_km,new.total_route_km,new.petrol_amount) is not distinct from (old.total_approved_km,old.eligible_km,old.total_route_km,old.petrol_amount);
 mode_changed:=(new.travel_mode,new.rate_per_km,new.payable_km_allowed) is distinct from (old.travel_mode,old.rate_per_km,old.payable_km_allowed);
 if mode_changed then
  if not financial_same or old.logout_time is not null or new.logout_time is not null or lower(old.status)<>'active' or lower(new.status)<>'active'
  or coalesce(auth.role(),'')<>'authenticated' or not exists(select 1 from public.profiles p where p.auth_user_id=auth.uid() and p.is_active and lower(coalesce(p.status,'')) not in('inactive','disabled','deactivated') and p.employee_code=old.employee_code and old.fo_user_id::text in(p.id::text,p.auth_user_id::text,p.employee_code))
  or new.travel_mode not in('bike','own_vehicle','car','auto','bus','train','other')
  or new.payable_km_allowed is distinct from (new.travel_mode in('bike','own_vehicle','car'))
  or new.rate_per_km is distinct from (case when new.travel_mode='car' then 8 else 4 end)::numeric
  or exists(select 1 from public.fo_monthly_travel_settlements s where s.employee_code=old.employee_code and old.attendance_date between s.period_start and s.period_end)
  or exists(select 1 from public.fo_october_km_recoveries s where s.employee_code=old.employee_code and s.attendance_date=old.attendance_date and s.status='approved')
  or exists(select 1 from public.fo_travel_reimbursement_corrections s where s.attendance_id=old.id and s.status='applied')
  then raise exception 'km_incremental_identity_mode_protected' using errcode='55000';end if;
  insert into public.fo_km_policy_audit(event,detail) values('active_nonfinancial_mode_change',jsonb_build_object('attendance_id',old.id,'auth_user_id',auth.uid(),'old_mode',old.travel_mode,'new_mode',new.travel_mode,'saved_payable_unchanged',old.total_approved_km,'saved_petrol_unchanged',old.petrol_amount));
 end if;
 if financial_same then
  -- Stale mobile metadata must not erase the receipt that just paid this day.
  new.metadata:=coalesce(new.metadata,'{}')||coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(old.metadata,'{}')) where key in('shared_km_last_receipt','km_calculation_version','financial_authority','km_recalculation_status','shared_km_final_leg')),'{}');
  return new;
 end if;
 target:=jsonb_build_object('total_approved_km',new.total_approved_km,'eligible_km',new.eligible_km,'total_route_km',new.total_route_km,'petrol_amount',new.petrol_amount);
 if new.total_approved_km<old.total_approved_km or new.petrol_amount<old.petrol_amount or not exists(select 1 from public.fo_km_incremental_credits where attendance_id=old.id and applied_to_attendance and transaction_id=txid_current() and evidence->'canonical_after'=target) then raise exception 'km_incremental_baseline_protected' using errcode='55000';end if;
 return new;
end $$;
revoke all on function public.fo_km_preserve_incremental_baseline() from public,anon,authenticated,service_role;
commit;
