-- ACTIVATION ONLY: separate reviewed production release approval required.
-- Execute AFTER the matching backend/frontend are healthy. No historical backfill.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $activation$
BEGIN
 IF coalesce((SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('qpms_cleaning_plan.verified_client_source_v2(public.client_deep_cleaning_submissions)')),'')<>'13a41c8250ba0455dc8c8e44e2e29088' THEN RAISE EXCEPTION 'Activation contract drift: qpms_cleaning_plan.verified_client_source_v2(public.client_deep_cleaning_submissions)'; END IF;
 IF coalesce((SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('qpms_cleaning_plan.match_verified_submission_v2()')),'')<>'94223a1f8f49d0fe0592565b5f62c609' THEN RAISE EXCEPTION 'Activation contract drift: qpms_cleaning_plan.match_verified_submission_v2()'; END IF;
 IF coalesce((SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.rpc_retail_cleaning_manual_link_v2(uuid,uuid,text,jsonb)')),'')<>'866bd1b485a2f87f4da27dfee149a9c9' THEN RAISE EXCEPTION 'Activation manual contract drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.client_deep_cleaning_submissions'::regclass AND tgname='z90_cleaning_verified_match_v2' AND pg_get_triggerdef(oid)='CREATE TRIGGER z90_cleaning_verified_match_v2 AFTER INSERT OR UPDATE OF status ON public.client_deep_cleaning_submissions FOR EACH ROW EXECUTE FUNCTION qpms_cleaning_plan.match_verified_submission_v2()' AND tgenabled IN ('O','D')) THEN RAISE EXCEPTION 'Activation trigger drift'; END IF;
END $activation$;
ALTER TABLE public.client_deep_cleaning_submissions ENABLE TRIGGER z90_cleaning_verified_match_v2;
GRANT EXECUTE ON FUNCTION public.rpc_retail_cleaning_manual_link_v2(uuid,uuid,text,jsonb) TO service_role;
COMMIT;
