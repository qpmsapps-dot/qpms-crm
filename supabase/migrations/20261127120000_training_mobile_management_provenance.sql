-- PROPOSED ONLY. Apply after Training V2, with its web admission gate still off.
-- Reuse the management authorization family; never manufacture FO context.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.training_assert_draft_editor(uuid,uuid)'::regprocedure
   AND md5(replace(prosrc,chr(13),''))='381dabc1fa6aa8154ed535c5283df519' AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, public'])
 THEN RAISE EXCEPTION 'training_mobile_management_baseline_drift';END IF;
END $$;
ALTER TABLE training_v2_private.release_policy ADD COLUMN mobile_management_enabled boolean NOT NULL DEFAULT false;
CREATE FUNCTION training_v2_private.assert_mobile_management(p_actor uuid,p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM 1 FROM training_v2_private.release_policy WHERE singleton AND mobile_management_enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='42501',message='training_mobile_management_release_disabled';END IF;
 PERFORM 1 FROM public.profiles p WHERE p.id=p_actor AND p.is_active IS TRUE
   AND upper(coalesce(p.status,'Active'))='ACTIVE' AND p.mobile_access_enabled IS TRUE
   AND p.web_access_enabled IS TRUE AND (p.role='MIS_MEPC' OR public.training_role_v4(p.role)='OPERATIONSMANAGER') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='42501',message='training_mobile_management_forbidden';END IF;
 IF p_date IS DISTINCT FROM (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
 THEN RAISE EXCEPTION USING errcode='22023',message='training_mobile_date_not_allowed';END IF;
END $$;
CREATE FUNCTION public.rpc_training_mobile_management_setup_allowed_v3(p_actor uuid,p_store uuid,p_date date)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM training_v2_private.assert_mobile_management(p_actor,p_date);
 PERFORM public.training_v2_assert_web(p_actor,p_store,p_date);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.rpc_training_mobile_management_setup_allowed_v3(uuid,uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_training_mobile_management_setup_allowed_v3(uuid,uuid,date) TO service_role;
CREATE FUNCTION public.rpc_create_reliance_training_mobile_management_v3(
 p_actor uuid,p_store uuid,p_date date,p_type uuid,p_trainer uuid,p_key text,p_remarks text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE sid uuid;existing_id uuid;reserved_key text;marker jsonb;
BEGIN
 PERFORM public.training_v2_lock_actor(p_actor);
 PERFORM training_v2_private.assert_mobile_management(p_actor,p_date);
 IF length(btrim(coalesce(p_key,''))) NOT BETWEEN 1 AND 160
 THEN RAISE EXCEPTION USING errcode='22023',message='training_mobile_invalid_request';END IF;
 reserved_key:='mm3:'||md5(p_actor::text||':'||p_key);
 SELECT id INTO existing_id FROM public.training_sessions WHERE trainer_profile_id=p_actor AND mobile_creation_key='web:'||reserved_key;
 IF existing_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.training_events e
   WHERE e.training_session_id=existing_id AND e.actor_profile_id=p_actor
     AND e.event_type='management_mobile_created_v3' AND e.metadata->>'submission_channel'='Mobile Management')
 THEN RAISE EXCEPTION USING errcode='23505',message='training_creation_key_conflict';END IF;
 -- Original function enforces disabled release gate, assignment/store scope, active
 -- trainer and masters, immutable creator and durable payload-bound idempotency.
 sid:=public.rpc_create_reliance_training_web_v2(p_actor,p_store,p_date,p_type,p_trainer,reserved_key,p_remarks);
 IF existing_id IS NULL THEN
   marker:=jsonb_build_object('submission_channel','Mobile Management','contract_version',3,
     'actual_trainer_profile_id',p_trainer,'uploader_profile_id',p_actor,
     'training_date',p_date,'uploaded_at',clock_timestamp());
   INSERT INTO public.training_events(training_session_id,event_type,actor_profile_id,metadata)
   VALUES(sid,'management_mobile_created_v3',p_actor,marker);
 END IF;
 RETURN sid;
END $$;
REVOKE ALL ON FUNCTION public.rpc_create_reliance_training_mobile_management_v3(uuid,uuid,date,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_reliance_training_mobile_management_v3(uuid,uuid,date,uuid,uuid,text,text) TO service_role;
-- Preserve the exact verified V2 body privately. Replace the public body in place
-- to retain its OID and every existing dependency/cached caller's function target.
CREATE FUNCTION training_v2_private.management_v2_draft_editor(p_session_id uuid,p_actor_profile_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.training_sessions%rowtype;
BEGIN
 PERFORM public.training_v2_lock_actor(p_actor_profile_id);
 SELECT * INTO s FROM public.training_sessions WHERE id=p_session_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='P0002',message='training_session_not_found';END IF;
 IF s.submission_source IS DISTINCT FROM 'Web' THEN PERFORM training_v2_private.mobile_draft_editor(p_session_id,p_actor_profile_id);RETURN;END IF;
 IF s.trainer_profile_id IS DISTINCT FROM p_actor_profile_id THEN RAISE EXCEPTION USING errcode='42501',message='training_not_session_creator';END IF;
 IF s.status<>'draft' THEN RAISE EXCEPTION USING errcode='P0001',message='training_session_immutable';END IF;
 PERFORM public.training_v2_assert_web(p_actor_profile_id,s.retail_store_id,s.training_date);
END $$;
REVOKE ALL ON FUNCTION training_v2_private.management_v2_draft_editor(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.training_assert_draft_editor(p_session_id uuid,p_actor_profile_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM training_v2_private.management_v2_draft_editor(p_session_id,p_actor_profile_id);
 IF EXISTS(SELECT 1 FROM public.training_events e WHERE e.training_session_id=p_session_id
   AND e.event_type='management_mobile_created_v3') THEN
   PERFORM training_v2_private.assert_mobile_management(p_actor_profile_id,
     (SELECT training_date FROM public.training_sessions WHERE id=p_session_id));
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.training_assert_draft_editor(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.training_assert_draft_editor(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION training_v2_private.assert_mobile_management(uuid,date) FROM PUBLIC,anon,authenticated,service_role;
-- No category assignments, policy activation or historical rewrites.
COMMIT;
