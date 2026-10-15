-- Repairs only authenticated profile resolution and V3 reporting provenance.
begin;
set local lock_timeout='2s';
do $repair$
declare definition text; original text;
begin
 original:=pg_get_functiondef('public.rpc_approve_fo_hist_20261015(text,text,text)'::regprocedure);
 if position('where p.id=v_user' in original)=0 then raise exception 'Unexpected historical approval definition'; end if;
 definition:=replace(original,'where p.id=v_user','where p.auth_user_id=v_user');
 definition:=replace(definition,
  'if v_user is null or not public.is_qpms_admin() then',
  'if v_user is null or public.is_qpms_admin() is distinct from true or not exists(select 1 from public.profiles where auth_user_id=v_user and role=''Admin'' and coalesce(is_active,true)) then');
 if definition=original or position('where p.id=v_user' in definition)>0 then raise exception 'Approval repair failed'; end if;
 execute definition;

 original:=pg_get_functiondef('public.rpc_apply_fo_hist_20261015(uuid,text)'::regprocedure);
 if position('if not exists(select 1 from public.profiles where id=v_auth.reviewer) then raise exception ''Reviewer no longer exists''; end if;' in original)=0 then
  raise exception 'Unexpected historical apply definition';
 end if;
 definition:=replace(original,
  'if not exists(select 1 from public.profiles where id=v_auth.reviewer) then raise exception ''Reviewer no longer exists''; end if;',
  'if not exists(select 1 from public.profiles where auth_user_id=v_auth.reviewer and role=''Admin'' and coalesce(is_active,true)) then raise exception ''Active authorized Admin reviewer no longer exists''; end if;
   if exists(select 1 from public.profiles p join jsonb_array_elements(v_auth.payload_text::jsonb->''rows'') approved_record on p.employee_code=approved_record->>''employee_code'' where p.auth_user_id=v_auth.reviewer) then raise exception ''Self-approval prohibited''; end if;');
 execute definition;
end $repair$;

create or replace function public.rpc_read_fo_hist_20261015(p_authorized_attendance_ids uuid[])
returns setof jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,fo_hist_20261015
as $fn$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Backend service role required'; end if;
 if p_authorized_attendance_ids is null or cardinality(p_authorized_attendance_ids)>174 then raise exception 'Bounded authorized attendance IDs required'; end if;
 return query select to_jsonb(d)||jsonb_build_object('reversed',false,
  'recovery_authorization',jsonb_build_object(
   'id',approval.id,'reviewer',approval.reviewer,'action',approval.action,'approved_at',approval.approved_at,
   'payload_sha256',approval.payload_sha256,
   'manifest_sha256',approval.payload_text::jsonb->>'original_manifest_sha256',
   'financial_projection_version',approval.payload_text::jsonb->>'financial_projection_version',
   'record_bound',exists(select 1 from jsonb_array_elements(approval.payload_text::jsonb->'rows') r where r=d.evidence)))
 from fo_hist_20261015.adjustments d
 join fo_hist_20261015.applications a on a.run_id=d.run_id
 join fo_hist_20261015.authorizations approval on approval.id=a.authorization_id
 where d.attendance_id=any(p_authorized_attendance_ids) and approval.action='APPLY'
 and a.payload_sha256=approval.payload_sha256
 and not exists(select 1 from fo_hist_20261015.reversals r where r.run_id=d.run_id)
 order by d.attendance_id;
end $fn$;
revoke all on function public.rpc_read_fo_hist_20261015(uuid[]) from public,anon,authenticated;
grant execute on function public.rpc_read_fo_hist_20261015(uuid[]) to service_role;
commit;
