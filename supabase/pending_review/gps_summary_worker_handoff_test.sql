BEGIN;
DO $test$
DECLARE e bigint; o uuid:='00000000-0000-0000-0000-000000000001'; t uuid:='00000000-0000-0000-0000-000000000002';
BEGIN
 IF public.rpc_worker_claim_v1('gps_summary',o,t) THEN RAISE EXCEPTION 'GPS admitted before handoff'; END IF;
 BEGIN
 UPDATE qpms_workers.control SET allowed_jobs=array['end_day_km','gps_summary'];
 RAISE EXCEPTION 'expected admission rejection';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'change_admission_only_while_closed_and_drained' THEN RAISE; END IF; END;
 e:=public.rpc_worker_close_v1('isolated test incident reason');
 BEGIN
 UPDATE qpms_workers.control SET allowed_jobs=array['end_day_km','gps_summary'];
 RAISE EXCEPTION 'expected active claim rejection';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'change_admission_only_while_closed_and_drained' THEN RAISE; END IF; END;
 PERFORM public.rpc_worker_reconcile_v1(e,'end_day_km',o,t,'isolated fixture proof of retired process and no side effects');
 UPDATE qpms_workers.control SET allowed_jobs=array['end_day_km','fo_stale_cleanup','gps_summary'];
 PERFORM public.rpc_worker_open_v1(e,'isolated fixture reviewed retirement evidence',repeat('a',64));
 IF NOT public.rpc_worker_claim_v1('gps_summary',o,t) THEN RAISE EXCEPTION 'GPS claim rejected'; END IF;
 IF public.rpc_worker_claim_v1('gps_summary',o,gen_random_uuid()) THEN RAISE EXCEPTION 'duplicate claim accepted'; END IF;
 IF NOT public.rpc_worker_release_v1('gps_summary',o,t) THEN RAISE EXCEPTION 'release failed'; END IF;
 IF public.rpc_worker_claim_v1('unknown',o,t) THEN RAISE EXCEPTION 'unknown worker admitted'; END IF;
 IF NOT public.rpc_worker_claim_v1('end_day_km',o,t) THEN RAISE EXCEPTION 'end day claim regression'; END IF;
 IF NOT public.rpc_worker_release_v1('end_day_km',o,t) THEN RAISE EXCEPTION 'end day release regression'; END IF;
 IF NOT public.rpc_worker_claim_v1('fo_stale_cleanup',o,t) THEN RAISE EXCEPTION 'cleanup claim regression'; END IF;
 IF NOT public.rpc_worker_release_v1('fo_stale_cleanup',o,t) THEN RAISE EXCEPTION 'cleanup release regression'; END IF;
 IF (SELECT count(*) FROM qpms_workers.audit)<>4 THEN RAISE EXCEPTION 'audit missing'; END IF;
END $test$;
ROLLBACK;
