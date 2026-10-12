-- Fail-fast reliability guard for Migration 205 evidence persistence.
-- This migration changes no GPS policy, evidence eligibility, payable KM, or financial data.

begin;

do $migration$
declare
  v_rpc regprocedure := to_regprocedure('public.rpc_record_fo_final_leg_evidence_v1(jsonb,text)');
  v_definition text;
  v_original_fragment constant text :=
    '  perform pg_advisory_xact_lock(hashtextextended(v_attendance_id::text, 0));';
  v_replacement_fragment constant text :=
    '  if not pg_try_advisory_xact_lock(hashtextextended(v_attendance_id::text, 0)) then
    raise exception using
      errcode = ''55P03'',
      message = ''final_leg_evidence_already_running'';
  end if;';
begin
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'Migration 206 requires PostgreSQL 17 or newer';
  end if;
  if v_rpc is null then
    raise exception 'Migration 205 evidence RPC is missing';
  end if;
  if to_regclass('public.fo_final_leg_reconciliation_runs') is null then
    raise exception 'Migration 205 evidence table is missing';
  end if;

  v_definition := pg_get_functiondef(v_rpc);
  if md5(v_definition) <> '5902c207e2d6dd777be1f3d6dfefaea4' then
    raise exception 'Unexpected evidence RPC definition; refusing an unverified replacement';
  end if;
  if strpos(v_definition, v_original_fragment) = 0
     or strpos(replace(v_definition, v_original_fragment, ''), v_original_fragment) <> 0 then
    raise exception 'Evidence RPC advisory-lock fragment is missing or ambiguous';
  end if;

  execute replace(v_definition, v_original_fragment, v_replacement_fragment);
end
$migration$;

alter function public.rpc_record_fo_final_leg_evidence_v1(jsonb, text)
  set lock_timeout = '2s';
alter function public.rpc_record_fo_final_leg_evidence_v1(jsonb, text)
  set statement_timeout = '15s';

alter function public.rpc_record_fo_final_leg_evidence_v1(jsonb, text) owner to postgres;
revoke all on function public.rpc_record_fo_final_leg_evidence_v1(jsonb, text)
  from public, anon, authenticated;
grant execute on function public.rpc_record_fo_final_leg_evidence_v1(jsonb, text)
  to service_role;

do $verification$
declare
  v_rpc regprocedure := 'public.rpc_record_fo_final_leg_evidence_v1(jsonb,text)'::regprocedure;
  v_definition text := pg_get_functiondef(
    'public.rpc_record_fo_final_leg_evidence_v1(jsonb,text)'::regprocedure
  );
  v_config text[];
begin
  select proconfig into v_config from pg_proc where oid = v_rpc;
  if strpos(v_definition, 'pg_try_advisory_xact_lock') = 0
     or strpos(v_definition, 'final_leg_evidence_already_running') = 0
     or strpos(v_definition, 'pg_advisory_xact_lock(hashtextextended(v_attendance_id::text, 0))') <> 0 then
    raise exception 'Evidence RPC fail-fast advisory guard was not installed exactly';
  end if;
  if not ('lock_timeout=2s' = any(v_config))
     or not ('statement_timeout=15s' = any(v_config)) then
    raise exception 'Evidence RPC bounded timeout configuration is missing';
  end if;
  if has_function_privilege('anon', v_rpc, 'EXECUTE')
     or has_function_privilege('authenticated', v_rpc, 'EXECUTE')
     or not has_function_privilege('service_role', v_rpc, 'EXECUTE') then
    raise exception 'Evidence RPC grants changed unexpectedly';
  end if;
end
$verification$;

comment on function public.rpc_record_fo_final_leg_evidence_v1(jsonb, text) is
  'Records immutable, nonpayable final-leg evidence for exact authorized targets. Duplicate in-flight requests fail fast; financial state remains unchanged.';

commit;
