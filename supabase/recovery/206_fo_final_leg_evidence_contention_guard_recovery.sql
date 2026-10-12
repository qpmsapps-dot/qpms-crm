-- Recovery for Migration 206. Restores the exact Migration 205 RPC behavior.
-- Existing immutable evidence and all financial records are preserved.

begin;

do $recovery$
declare
  v_rpc regprocedure := to_regprocedure('public.rpc_record_fo_final_leg_evidence_v1(jsonb,text)');
  v_definition text;
  v_guarded_fragment constant text :=
    '  if not pg_try_advisory_xact_lock(hashtextextended(v_attendance_id::text, 0)) then
    raise exception using
      errcode = ''55P03'',
      message = ''final_leg_evidence_already_running'';
  end if;';
  v_original_fragment constant text :=
    '  perform pg_advisory_xact_lock(hashtextextended(v_attendance_id::text, 0));';
begin
  if v_rpc is null then
    raise exception 'Migration 206 recovery cannot find the evidence RPC';
  end if;
  v_definition := pg_get_functiondef(v_rpc);
  if md5(v_definition) <> 'b21d2a6088f9e1a66ec523296ab6ed2d' then
    raise exception 'Unexpected guarded evidence RPC definition; refusing recovery';
  end if;
  if strpos(v_definition, v_guarded_fragment) = 0
     or strpos(replace(v_definition, v_guarded_fragment, ''), v_guarded_fragment) <> 0 then
    raise exception 'Guarded advisory-lock fragment is missing or ambiguous';
  end if;
  execute replace(v_definition, v_guarded_fragment, v_original_fragment);
end
$recovery$;

alter function public.rpc_record_fo_final_leg_evidence_v1(jsonb, text)
  reset lock_timeout;
alter function public.rpc_record_fo_final_leg_evidence_v1(jsonb, text)
  reset statement_timeout;

do $verification$
declare
  v_rpc regprocedure := 'public.rpc_record_fo_final_leg_evidence_v1(jsonb,text)'::regprocedure;
  v_definition text := pg_get_functiondef(
    'public.rpc_record_fo_final_leg_evidence_v1(jsonb,text)'::regprocedure
  );
begin
  if md5(v_definition) <> '5902c207e2d6dd777be1f3d6dfefaea4' then
    raise exception 'Migration 206 recovery did not restore the exact Migration 205 RPC';
  end if;
  if has_function_privilege('anon', v_rpc, 'EXECUTE')
     or has_function_privilege('authenticated', v_rpc, 'EXECUTE')
     or not has_function_privilege('service_role', v_rpc, 'EXECUTE') then
    raise exception 'Evidence RPC grants changed unexpectedly during recovery';
  end if;
end
$verification$;

commit;
