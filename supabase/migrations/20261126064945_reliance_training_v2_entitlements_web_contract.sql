-- PREPARED ONLY. No production execution authorized. Baseline eff30bf0, 2026-11-26.
BEGIN;
DO $preflight$ BEGIN
IF md5(replace(pg_get_functiondef(to_regprocedure('public.rpc_update_reliance_training_draft(uuid,uuid,uuid,uuid,date,text,text)')),chr(13),'')) IS DISTINCT FROM '501cbc51822cbb28ade2d885c8671c88' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.rpc_update_reliance_training_draft'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.rpc_add_reliance_training_attendee(uuid,uuid,uuid)')),chr(13),'')) IS DISTINCT FROM '6201d673e725863180491df28280fc80' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.rpc_add_reliance_training_attendee'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.rpc_remove_reliance_training_attendee(uuid,uuid,uuid)')),chr(13),'')) IS DISTINCT FROM '4632abda212a537cf26a2e0f56d9d04a' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.rpc_remove_reliance_training_attendee'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.rpc_set_reliance_training_topics(uuid,uuid,uuid[])')),chr(13),'')) IS DISTINCT FROM 'e9c474ea82ca743aa8b52f0e044f5b3c' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.rpc_set_reliance_training_topics'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.rpc_create_reliance_training_session(uuid,uuid,uuid,uuid,uuid,date,text,text)')),chr(13),'')) IS DISTINCT FROM '34eb966c61128587ff16db136327c33a' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.rpc_create_reliance_training_session'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.rpc_update_reliance_training_topic(uuid,uuid,uuid,boolean,text)')),chr(13),'')) IS DISTINCT FROM 'bf8aa3d66abc7761c0e0081e0fc32f30' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.rpc_update_reliance_training_topic'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.rpc_complete_reliance_training_evidence(uuid,uuid,uuid)')),chr(13),'')) IS DISTINCT FROM '215d534e2f5e66c010798fa6e436437d' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.rpc_complete_reliance_training_evidence'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.rpc_submit_reliance_training_session(uuid,uuid)')),chr(13),'')) IS DISTINCT FROM '0d05af8953c3277634778693f0121776' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.rpc_submit_reliance_training_session'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.rpc_delete_reliance_training_evidence(uuid,uuid,uuid)')),chr(13),'')) IS DISTINCT FROM '43defc5a34f0724e83909f4274d8b0ba' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.rpc_delete_reliance_training_evidence'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.rpc_cancel_reliance_training_session(uuid,uuid)')),chr(13),'')) IS DISTINCT FROM '1f6f07f36dd14f24a5735bcb90dc1697' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.rpc_cancel_reliance_training_session'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.training_session_write_guard()')),chr(13),'')) IS DISTINCT FROM '3d852e94d408cba24fa3982d3fa7e32f' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.training_session_write_guard'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.training_child_write_guard()')),chr(13),'')) IS DISTINCT FROM '1a1e7ee6709bb61fcfbbdf5ccf557908' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.training_child_write_guard'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.training_legacy_write_guard()')),chr(13),'')) IS DISTINCT FROM 'f1e4746190cd485725bf34452eb15659' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.training_legacy_write_guard'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.training_assert_active_context(uuid,uuid,uuid)')),chr(13),'')) IS DISTINCT FROM 'a9c403d8491cb7a80a51593847aba211' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.training_assert_active_context'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.rpc_create_reliance_training_session_v3(uuid,uuid,uuid,uuid,uuid,date,text,uuid,text)')),chr(13),'')) IS DISTINCT FROM '1fc949edd5c3ab0da893b38bb0fdb594' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.rpc_create_reliance_training_session_v3'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.rpc_submit_reliance_training_session_v2(uuid,uuid)')),chr(13),'')) IS DISTINCT FROM '32d1e66fab695ce98cf98241b54b6b23' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.rpc_submit_reliance_training_session_v2'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.training_assert_draft_editor(uuid,uuid)')),chr(13),'')) IS DISTINCT FROM '73cd4637fdb37e2b122dde1a96167b65' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.training_assert_draft_editor'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.rpc_create_reliance_training_session_v2(uuid,uuid,uuid,uuid,uuid,date,text,text)')),chr(13),'')) IS DISTINCT FROM '05cfcf1fca206df98211338a61a5c620' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.rpc_create_reliance_training_session_v2'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.training_role_v4(text)')),chr(13),'')) IS DISTINCT FROM '0ea464431109631332b91d48467594b1' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.training_role_v4'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.training_retail_actor_v4(uuid)')),chr(13),'')) IS DISTINCT FROM '03effe0f974701005d782b3e350d2c70' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.training_retail_actor_v4'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.training_category_allowed_v4(uuid,uuid)')),chr(13),'')) IS DISTINCT FROM '3cea9ac3aef505d58ac49bef7ba651df' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.training_category_allowed_v4'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.retail_mis_allowed(uuid,text,text,boolean)')),chr(13),'')) IS DISTINCT FROM '0e15875e98c6e57425644098fdd79133' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.retail_mis_allowed'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.training_retail_store_allowed(uuid,uuid,uuid)')),chr(13),'')) IS DISTINCT FROM '7172517a0deda3d32049f7953e10865f' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.training_retail_store_allowed'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.training_authorized_zones_v4(uuid)')),chr(13),'')) IS DISTINCT FROM '50177e75f1d01add101073a474cfc126' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.training_authorized_zones_v4'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.rpc_create_reliance_training_session_v4(uuid,uuid,uuid,uuid,uuid,date,text,uuid,text,text)')),chr(13),'')) IS DISTINCT FROM 'f84e8055390fd948acc605d1a3647376' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.rpc_create_reliance_training_session_v4'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('qpms_training_reports.allowed(uuid,uuid,text,text)')),chr(13),'')) IS DISTINCT FROM 'c5196de31021b86cb992051fb122fb87' THEN RAISE EXCEPTION 'training_v2_baseline_drift: qpms_training_reports.allowed'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.rpc_retail_mis_training_v4(uuid,uuid,text,date,date,text)')),chr(13),'')) IS DISTINCT FROM 'ccb906bba5d3b062d20b3febc93faa7e' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.rpc_retail_mis_training_v4'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.rpc_retail_mis_training_evidence_v4(uuid,uuid,text,uuid,uuid)')),chr(13),'')) IS DISTINCT FROM 'd1732310b76e36b22f816e362086da74' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.rpc_retail_mis_training_evidence_v4'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.retail_role_states(uuid)')),chr(13),'')) IS DISTINCT FROM '85ed8bf1ad43d47e51df82e7013748d6' THEN RAISE EXCEPTION 'training_v2_baseline_drift: public.retail_role_states'; END IF;
END $preflight$;
DO $privileges$ DECLARE p record;BEGIN
 FOR p IN SELECT oid,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('training_category_allowed_v4','training_retail_store_allowed','training_assert_draft_editor','rpc_create_reliance_training_session_v4','rpc_submit_reliance_training_session_v2','retail_mis_allowed','rpc_retail_mis_training_v4','rpc_retail_mis_training_evidence_v4') LOOP
  IF has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE') IS DISTINCT FROM (p.proname<>'retail_mis_allowed') THEN RAISE EXCEPTION 'training_v2_privilege_drift: %',p.proname;END IF;
 END LOOP;
END $privileges$;
-- Additive schema and compatibility backfill.
CREATE SCHEMA training_v2_private;
REVOKE ALL ON SCHEMA training_v2_private FROM PUBLIC,anon,authenticated;
CREATE TABLE training_v2_private.baseline_functions(signature text PRIMARY KEY, definition text NOT NULL);
ALTER TABLE training_v2_private.baseline_functions ENABLE ROW LEVEL SECURITY;
INSERT INTO training_v2_private.baseline_functions
SELECT p.oid::regprocedure::text,pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE (n.nspname='public' AND p.proname IN ('training_category_allowed_v4','training_retail_store_allowed','training_assert_draft_editor','training_session_write_guard','training_legacy_write_guard','rpc_submit_reliance_training_session','retail_mis_allowed','rpc_retail_mis_training_v4','rpc_retail_mis_training_evidence_v4')) OR (n.nspname='qpms_training_reports' AND p.proname='allowed');

CREATE TABLE public.training_category_entitlements(
 profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 category_id uuid NOT NULL REFERENCES public.training_categories(id) ON DELETE RESTRICT,
 active boolean NOT NULL DEFAULT false,
 effective_from timestamptz NOT NULL DEFAULT now(),effective_to timestamptz,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 changed_by uuid NOT NULL REFERENCES public.profiles(id),changed_at timestamptz NOT NULL DEFAULT now(),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 PRIMARY KEY(profile_id,category_id),CHECK(effective_to IS NULL OR effective_to>effective_from)
);
ALTER TABLE public.training_category_entitlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.training_category_entitlements FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.training_category_entitlements TO service_role;
CREATE TABLE training_v2_private.release_policy(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),web_enabled boolean NOT NULL DEFAULT false,web_backdate_days integer NOT NULL DEFAULT 0 CHECK(web_backdate_days BETWEEN 0 AND 365));
ALTER TABLE training_v2_private.release_policy ENABLE ROW LEVEL SECURITY;
INSERT INTO training_v2_private.release_policy DEFAULT VALUES;

CREATE FUNCTION public.training_v2_super_admin(p_actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_actor AND p.id='d40c2b3f-87f1-4c34-8798-cf9b0d9ca784' AND p.auth_user_id='79cd196c-c6f3-404a-b22a-d4683afefa3f' AND p.employee_code='QPMSADMIN' AND p.is_active AND upper(p.status)='ACTIVE' AND public.training_role_v4(p.role) IN ('ADMIN','QPMSADMIN') AND p.web_access_enabled);
$$;
CREATE FUNCTION public.training_v2_lock_actor(p_actor uuid) RETURNS void LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $$ SELECT pg_advisory_xact_lock(hashtextextended('training-entitlements:'||p_actor::text,0)); $$;
CREATE FUNCTION public.rpc_training_category_entitlements(p_actor uuid,p_target uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.training_v2_super_admin(p_actor) THEN RAISE EXCEPTION USING errcode='42501',message='training_entitlement_admin_required'; END IF;
 RETURN jsonb_build_object('can_administer',true,'eligible',EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_target AND public.training_role_v4(p.role)='FO' AND public.training_retail_actor_v4(p.id)),
 'categories',(SELECT coalesce(jsonb_agg(jsonb_build_object('code',c.code,'category_id',c.id,'active',coalesce(e.active,false),'effective',coalesce(e.active AND e.effective_from<=now() AND (e.effective_to IS NULL OR e.effective_to>now()),false),'revision',coalesce(e.revision,0),'effective_from',e.effective_from,'effective_to',e.effective_to,'changed_by',e.changed_by,'changed_at',e.changed_at,'reason',e.reason) ORDER BY c.sort_order),'[]') FROM public.training_categories c LEFT JOIN public.training_category_entitlements e ON e.category_id=c.id AND e.profile_id=p_target WHERE c.code IN ('hk','technical_mep') AND c.is_active),
 'history',(SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]') FROM (SELECT actor_user_id,action,before_state,after_state,metadata,created_at FROM public.access_audit_logs WHERE target_type='training_category_entitlement' AND target_id=p_target ORDER BY created_at DESC,id DESC LIMIT 100) h));
END $$;
CREATE FUNCTION public.rpc_set_training_category_entitlements(p_actor uuid,p_target uuid,p_changes jsonb,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE x jsonb;c public.training_categories%rowtype;e public.training_category_entitlements%rowtype;before_value jsonb;changed public.training_category_entitlements%rowtype;start_at timestamptz;end_at timestamptz;
BEGIN
 IF NOT public.training_v2_super_admin(p_actor) THEN RAISE EXCEPTION USING errcode='42501',message='training_entitlement_admin_required'; END IF;
 PERFORM public.training_v2_lock_actor(p_target);
 IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_target AND public.training_role_v4(p.role)='FO' AND public.training_retail_actor_v4(p.id)) THEN RAISE EXCEPTION USING errcode='42501',message='training_entitlement_target_ineligible'; END IF;
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 500 OR jsonb_typeof(p_changes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_changes) NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION USING errcode='22023',message='training_entitlement_invalid_request'; END IF;
 IF (SELECT count(DISTINCT v->>'code') FROM jsonb_array_elements(p_changes) v)<>jsonb_array_length(p_changes) THEN RAISE EXCEPTION USING errcode='22023',message='training_entitlement_duplicate_category'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
  IF jsonb_typeof(x->'active') IS DISTINCT FROM 'boolean' OR jsonb_typeof(x->'expected_revision') IS DISTINCT FROM 'number' OR (x->>'expected_revision') !~ '^[0-9]+$' THEN RAISE EXCEPTION USING errcode='22023',message='training_entitlement_invalid_request'; END IF;
  SELECT * INTO c FROM public.training_categories WHERE code=x->>'code' AND code IN ('hk','technical_mep') AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION USING errcode='22023',message='training_category_invalid'; END IF;
  SELECT * INTO e FROM public.training_category_entitlements WHERE profile_id=p_target AND category_id=c.id FOR UPDATE;
  IF coalesce(e.revision,0)<>(x->>'expected_revision')::integer THEN RAISE EXCEPTION USING errcode='40001',message='training_entitlement_revision_conflict'; END IF;
  before_value:=CASE WHEN e.profile_id IS NULL THEN NULL ELSE to_jsonb(e) END;
  start_at:=coalesce((x->>'effective_from')::timestamptz,now());end_at:=(x->>'effective_to')::timestamptz;
  IF end_at IS NOT NULL AND end_at<=start_at THEN RAISE EXCEPTION USING errcode='22023',message='training_entitlement_invalid_validity'; END IF;
  INSERT INTO public.training_category_entitlements(profile_id,category_id,active,effective_from,effective_to,revision,changed_by,reason)
  VALUES(p_target,c.id,(x->>'active')::boolean,start_at,end_at,coalesce(e.revision,0)+1,p_actor,btrim(p_reason))
  ON CONFLICT(profile_id,category_id) DO UPDATE SET active=excluded.active,effective_from=excluded.effective_from,effective_to=excluded.effective_to,revision=excluded.revision,changed_by=excluded.changed_by,changed_at=clock_timestamp(),reason=excluded.reason RETURNING * INTO changed;
  INSERT INTO public.access_audit_logs(actor_user_id,action,target_type,target_id,before_state,after_state,metadata)
  SELECT auth_user_id,'training_category_changed','training_category_entitlement',p_target,before_value,to_jsonb(changed),jsonb_build_object('category',c.code,'reason',btrim(p_reason)) FROM public.profiles WHERE id=p_actor;
 END LOOP;
 RETURN public.rpc_training_category_entitlements(p_actor,p_target);
END $$;
-- Compatibility backfill is HK-only, inside this migration transaction, before replacing the old category predicate.
DO $inventory$ BEGIN IF (SELECT count(*) FROM public.profiles p WHERE public.training_role_v4(p.role)='FO' AND public.training_category_allowed_v4(p.id,(SELECT id FROM public.training_categories WHERE code='hk')))<>27 THEN RAISE EXCEPTION 'training_hk_inventory_drift_reapprove_backfill';END IF;END $inventory$;
INSERT INTO public.training_category_entitlements(profile_id,category_id,active,changed_by,reason)
SELECT p.id,c.id,true,'d40c2b3f-87f1-4c34-8798-cf9b0d9ca784','HK compatibility preservation; approved Phase 2 inventory 2026-11-26'
FROM public.profiles p CROSS JOIN public.training_categories c WHERE c.code='hk' AND public.training_role_v4(p.role)='FO' AND public.training_category_allowed_v4(p.id,c.id);
INSERT INTO public.access_audit_logs(actor_user_id,action,target_type,target_id,before_state,after_state,metadata)
SELECT '79cd196c-c6f3-404a-b22a-d4683afefa3f','training_hk_compatibility_backfill','training_category_entitlement',e.profile_id,null,to_jsonb(e),jsonb_build_object('category','hk','reason',e.reason) FROM public.training_category_entitlements e;
CREATE OR REPLACE FUNCTION public.training_category_allowed_v4(p_actor_profile_id uuid,p_category_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.training_retail_actor_v4(p_actor_profile_id) AND EXISTS(SELECT 1 FROM public.profiles p JOIN public.training_category_entitlements e ON e.profile_id=p.id JOIN public.training_categories c ON c.id=e.category_id WHERE p.id=p_actor_profile_id AND public.training_role_v4(p.role)='FO' AND p.mobile_access_enabled AND c.id=p_category_id AND c.code IN ('hk','technical_mep') AND c.is_active AND e.active AND e.effective_from<=now() AND (e.effective_to IS NULL OR e.effective_to>now()));
$$;
CREATE FUNCTION public.training_v2_state(p_state text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE regexp_replace(upper(coalesce(p_state,'')),'[^A-Z0-9]','','g') WHEN 'TAMILNADU' THEN 'TN' WHEN 'PUDUCHERRY' THEN 'PY' WHEN 'PONDICHERRY' THEN 'PY' WHEN 'KARNATAKA' THEN 'KA' WHEN 'KN' THEN 'KA' WHEN 'KERALA' THEN 'KL' WHEN 'TELANGANA' THEN 'TG' WHEN 'TS' THEN 'TG' WHEN 'ANDHRAPRADESH' THEN 'AP' WHEN 'ANDHRAPRADESH1' THEN 'AP1' WHEN 'ANDHRAPRADESH2' THEN 'AP2' ELSE regexp_replace(upper(coalesce(p_state,'')),'[^A-Z0-9]','','g') END;
$$;
CREATE OR REPLACE FUNCTION public.training_retail_store_allowed(p_actor_profile_id uuid,p_store_id uuid,p_category_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.training_category_allowed_v4(p_actor_profile_id,p_category_id) AND EXISTS(SELECT 1 FROM public.profiles p JOIN public.reliance_retail_store_master s ON s.id=p_store_id AND s.status='Active' WHERE p.id=p_actor_profile_id AND public.training_v2_state(p.state) IN ('TN','PY','KA','KL','TG','AP','AP1','AP2') AND (public.training_v2_state(p.state)=public.training_v2_state(s.state) OR (public.training_v2_state(p.state)='AP' AND public.training_v2_state(s.state) IN ('AP1','AP2'))));
$$;

-- FO ownership stays in trainer_profile_id for API compatibility. Actual trainer is separate for Web.
-- Historical source provenance stays unknown; the default applies only to future inserts.
ALTER TABLE public.training_sessions ADD COLUMN submission_source text CHECK(submission_source IN ('Mobile','Web')),
 ADD COLUMN uploader_profile_id uuid REFERENCES public.profiles(id),ADD COLUMN actual_trainer_profile_id uuid REFERENCES public.profiles(id),
 ADD COLUMN completion_policy_version integer NOT NULL DEFAULT 1 CHECK(completion_policy_version IN (1,2));
ALTER TABLE public.training_sessions ALTER COLUMN submission_source SET DEFAULT 'Mobile',ALTER COLUMN attendance_id DROP NOT NULL,ALTER COLUMN site_visit_id DROP NOT NULL;
ALTER TABLE public.training_sessions ADD CONSTRAINT training_v2_source_context CHECK((coalesce(submission_source,'Mobile')='Mobile' AND attendance_id IS NOT NULL AND site_visit_id IS NOT NULL) OR (submission_source='Web' AND attendance_id IS NULL AND site_visit_id IS NULL AND retail_store_id IS NOT NULL AND uploader_profile_id IS NOT NULL AND actual_trainer_profile_id IS NOT NULL));

-- Explicit geographic states; reporting labels never create grants. Narrow scopes from the SAME assignment.
CREATE FUNCTION public.training_v2_assignment_store(p_actor uuid,p_store uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p JOIN public.access_user_assignments a ON a.profile_id=p.id AND a.auth_user_id=p.auth_user_id JOIN public.access_roles r ON r.id=a.role_id AND r.active JOIN public.access_modules am ON am.id=a.module_id AND am.active AND am.code IN ('training','fo_operations') JOIN public.access_clients ac ON ac.id=a.client_id AND ac.active AND ac.code='reliance_retail' JOIN public.reliance_retail_store_master s ON s.id=p_store AND s.status='Active'
 WHERE p.id=p_actor AND a.client_id='369d2d5f-396f-49f9-a47d-bfbc8f7cb922' AND a.active AND a.verification_status='verified' AND a.effective_from<=now() AND (a.effective_to IS NULL OR a.effective_to>now()) AND (public.training_role_v4(r.code)=public.training_role_v4(p.role) OR (public.training_role_v4(p.role)='SOUTHHEAD' AND r.code='gm'))
 AND EXISTS(SELECT 1 FROM public.access_user_scopes g WHERE g.user_assignment_id=a.id AND g.allowed AND g.scope_type='state' AND (g.effective_from IS NULL OR g.effective_from<=now()) AND (g.effective_to IS NULL OR g.effective_to>now()) AND (public.training_v2_state(coalesce(g.scope_code,g.scope_text))=public.training_v2_state(s.state) OR (public.training_v2_state(coalesce(g.scope_code,g.scope_text))='AP' AND public.training_v2_state(s.state) IN ('AP1','AP2'))))
 AND NOT EXISTS(SELECT 1 FROM public.access_user_scopes g WHERE g.user_assignment_id=a.id AND (g.scope_type NOT IN ('state','store','zone','client','business_vertical') OR NOT g.allowed))
 AND NOT EXISTS(SELECT 1 FROM (VALUES('store'),('zone')) kind(type) WHERE EXISTS(SELECT 1 FROM public.access_user_scopes g WHERE g.user_assignment_id=a.id AND g.scope_type=kind.type) AND NOT EXISTS(SELECT 1 FROM public.access_user_scopes g WHERE g.user_assignment_id=a.id AND g.allowed AND g.scope_type=kind.type AND g.scope_id=CASE kind.type WHEN 'store' THEN s.id ELSE s.zone_id END AND (g.effective_from IS NULL OR g.effective_from<=now()) AND (g.effective_to IS NULL OR g.effective_to>now()))));
$$;
CREATE FUNCTION public.training_v2_report_store(p_actor uuid,p_category text,p_store uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT (public.training_retail_actor_v4(p_actor) OR public.training_v2_super_admin(p_actor)) AND EXISTS(SELECT 1 FROM public.profiles p JOIN public.reliance_retail_store_master s ON s.id=p_store AND s.status='Active' WHERE p.id=p_actor AND p.web_access_enabled AND p_category IN ('hk','technical_mep') AND public.training_v2_state(s.state) IN ('TN','PY','KA','KL','TG','AP1','AP2') AND (
 public.training_v2_super_admin(p.id)
 OR (public.training_role_v4(p.role) IN ('BRANCHHEAD','SOUTHHEAD') AND public.training_v2_assignment_store(p.id,s.id))
 OR (p_category='hk' AND public.training_role_v4(p.role) IN ('MIS','HKMIS','HOUSEKEEPINGMIS') AND (public.training_role_v4(p.role) IN ('HKMIS','HOUSEKEEPINGMIS') OR public.training_role_v4(p.designation) IN ('HKMIS','HOUSEKEEPINGMIS') OR public.training_role_v4(p.department) IN ('HKMIS','HOUSEKEEPINGMIS')) AND public.training_v2_assignment_store(p.id,s.id))
 OR (public.training_role_v4(p.role) IN ('OPERATIONSMANAGER','KAM') AND p_category='technical_mep' AND public.training_v2_assignment_store(p.id,s.id))
 OR (p.role IN ('MIS_HK','MIS_MEPC','CENTRAL_MIS') AND EXISTS(SELECT 1 FROM public.retail_mis_assignments a WHERE a.profile_id=p.id AND a.auth_user_id=p.auth_user_id AND a.employee_code=p.employee_code AND a.role=p.role AND a.active AND (a.role='CENTRAL_MIS' OR s.state=ANY(a.states)) AND (a.role='CENTRAL_MIS' OR (a.role='MIS_HK' AND p_category='hk') OR (a.role='MIS_MEPC' AND p_category='technical_mep')))
 AND (NOT EXISTS(SELECT 1 FROM public.access_user_assignments a WHERE a.profile_id=p.id AND a.client_id='369d2d5f-396f-49f9-a47d-bfbc8f7cb922') OR public.training_v2_assignment_store(p.id,s.id)))));
$$;
CREATE FUNCTION public.training_v2_web_allowed(p_actor uuid,p_store uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.training_v2_report_store(p_actor,'technical_mep',p_store) AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_actor AND (p.role='MIS_MEPC' OR public.training_role_v4(p.role)='OPERATIONSMANAGER' OR public.training_v2_super_admin(p.id)));
$$;
CREATE FUNCTION public.training_v2_assert_web(p_actor uuid,p_store uuid,p_date date) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE policy training_v2_private.release_policy%rowtype;today date:=(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
 SELECT * INTO policy FROM training_v2_private.release_policy WHERE singleton FOR SHARE;
 IF policy.web_enabled IS DISTINCT FROM true THEN RAISE EXCEPTION USING errcode='42501',message='training_web_release_disabled'; END IF;
 IF NOT public.training_v2_web_allowed(p_actor,p_store) THEN RAISE EXCEPTION USING errcode='42501',message='training_web_scope_forbidden'; END IF;
 IF p_date IS NULL OR p_date>today OR p_date<today-policy.web_backdate_days THEN RAISE EXCEPTION USING errcode='22023',message='training_web_date_not_allowed'; END IF;
END $$;

CREATE FUNCTION public.training_v2_canonical_store(p_session uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN count(*)=1 THEN (array_agg(m.id))[1] ELSE null END FROM public.training_sessions s
 LEFT JOIN public.store_master legacy ON legacy.id=s.store_id
 JOIN public.reliance_retail_store_master m ON m.status='Active' AND ((s.retail_store_id IS NOT NULL AND m.id=s.retail_store_id) OR (s.retail_store_id IS NULL AND upper(btrim(m.store_code))=upper(btrim(coalesce(s.store_code_snapshot,legacy.store_code))) AND public.training_v2_state(m.state)=public.training_v2_state(coalesce(s.state_snapshot,legacy.state)))) WHERE s.id=p_session;
$$;
-- Preserve existing OM/KAM HK hierarchy reading, without granting creation or other FOs' drafts.
CREATE FUNCTION public.training_v2_existing_hk_read(p_actor uuid,p_session uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.training_sessions s JOIN public.profiles p ON p.id=p_actor JOIN public.profiles f ON f.id=s.trainer_profile_id JOIN public.employee_hierarchy h ON upper(btrim(h.employee_code))=upper(btrim(f.employee_code)) AND h.is_active
 WHERE s.id=p_session AND s.status='submitted' AND public.training_role_v4(p.role) IN ('OPERATIONSMANAGER','KAM') AND public.training_role_v4(f.role)='FO' AND public.training_retail_actor_v4(f.id)
 AND upper(btrim(p.employee_code)) IN (upper(btrim(h.manager_employee_code)),upper(btrim(h.managers_manager_employee_code)),upper(btrim(h.business_head_employee_code))) AND (
(EXISTS(SELECT 1 FROM public.access_user_assignments a WHERE a.profile_id=p_actor AND a.client_id='369d2d5f-396f-49f9-a47d-bfbc8f7cb922') AND public.training_v2_assignment_store(p_actor,public.training_v2_canonical_store(s.id)))
OR (NOT EXISTS(SELECT 1 FROM public.access_user_assignments a WHERE a.profile_id=p_actor AND a.client_id='369d2d5f-396f-49f9-a47d-bfbc8f7cb922') AND EXISTS(SELECT 1 FROM public.reliance_retail_store_master m WHERE m.id=public.training_v2_canonical_store(s.id) AND (public.training_v2_state(p.state)=public.training_v2_state(m.state) OR (public.training_v2_state(p.state)='AP' AND public.training_v2_state(m.state) IN ('AP1','AP2')))))
));
$$;
CREATE FUNCTION public.rpc_training_v2_read_allowed(p_actor uuid,p_session uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.training_sessions s JOIN public.training_categories c ON c.id=s.category_id JOIN public.profiles p ON p.id=p_actor WHERE s.id=p_session AND s.access_client_id='369d2d5f-396f-49f9-a47d-bfbc8f7cb922' AND s.access_client_code='reliance_retail' AND (public.training_retail_actor_v4(p.id) OR public.training_v2_super_admin(p.id)) AND ((public.training_role_v4(p.role)='FO' AND s.trainer_profile_id=p.id AND (public.training_v2_state(p.state)=public.training_v2_state(s.state_snapshot) OR (public.training_v2_state(p.state)='AP' AND public.training_v2_state(s.state_snapshot) IN ('AP1','AP2'))) AND (s.retail_store_id IS NULL OR EXISTS(SELECT 1 FROM public.reliance_retail_store_master m WHERE m.id=s.retail_store_id AND m.status='Active' AND (public.training_v2_state(p.state)=public.training_v2_state(m.state) OR (public.training_v2_state(p.state)='AP' AND public.training_v2_state(m.state) IN ('AP1','AP2')))))) OR (s.submission_source='Web' AND s.trainer_profile_id=p.id AND public.training_v2_web_allowed(p.id,s.retail_store_id)) OR (c.code='hk' AND public.training_v2_existing_hk_read(p.id,s.id)) OR (s.status='submitted' AND public.training_v2_report_store(p.id,c.code,public.training_v2_canonical_store(s.id)))));
$$;
CREATE FUNCTION public.rpc_training_v2_list(p_actor uuid,p_from date,p_to date,p_category uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>366 THEN RAISE EXCEPTION USING errcode='22023',message='training_report_dates_invalid';END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('canonical_store_id',public.training_v2_canonical_store(s.id)) ORDER BY s.training_date DESC,s.id),'[]') FROM public.training_sessions s WHERE s.training_date BETWEEN p_from AND p_to AND (p_category IS NULL OR s.category_id=p_category) AND public.rpc_training_v2_read_allowed(p_actor,s.id) );
END $$;

CREATE FUNCTION public.training_v2_assert_completion(p_session uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.training_evidence e JOIN public.training_sessions s ON s.id=e.training_session_id WHERE s.id=p_session AND e.evidence_type='additional_document' AND e.metadata->>'upload_status'='uploaded' AND e.uploaded_by=s.trainer_profile_id AND e.mime_type IN ('application/pdf','image/jpeg','image/png') AND e.file_size BETWEEN 1 AND 5242880 AND e.metadata->>'verified_sha256' ~ '^[a-f0-9]{64}$' AND e.storage_bucket='training-evidence' AND e.storage_path LIKE 'training/'||s.id::text||'/'||e.id::text||'/%' AND EXISTS(SELECT 1 FROM storage.buckets b WHERE b.id=e.storage_bucket AND NOT b.public) AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=e.storage_bucket AND o.name=e.storage_path AND (o.metadata->>'size')::bigint=e.file_size AND o.metadata->>'mimetype'=e.mime_type)) THEN RAISE EXCEPTION USING errcode='22023',message='training_completion_proof_required';END IF;
END $$;
CREATE OR REPLACE FUNCTION public.training_assert_draft_editor(p_session_id uuid,p_actor_profile_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
CREATE FUNCTION public.rpc_create_reliance_training_web_v2(p_actor uuid,p_store uuid,p_date date,p_type uuid,p_trainer uuid,p_key text,p_remarks text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.profiles%rowtype;trainer public.profiles%rowtype;m public.reliance_retail_store_master%rowtype;c public.training_categories%rowtype;s public.training_sessions%rowtype;sid uuid:=gen_random_uuid();uploader_code text;
BEGIN
 PERFORM public.training_v2_lock_actor(p_actor);
 PERFORM public.training_v2_assert_web(p_actor,p_store,p_date);
 IF length(btrim(coalesce(p_key,''))) NOT BETWEEN 1 AND 160 OR length(coalesce(p_remarks,''))>500 THEN RAISE EXCEPTION USING errcode='22023',message='training_web_invalid_request';END IF;
 SELECT * INTO s FROM public.training_sessions WHERE trainer_profile_id=p_actor AND mobile_creation_key='web:'||p_key;
 IF FOUND THEN
  IF s.submission_source<>'Web' OR s.retail_store_id IS DISTINCT FROM p_store OR s.training_date IS DISTINCT FROM p_date OR s.training_type_id IS DISTINCT FROM p_type OR s.actual_trainer_profile_id IS DISTINCT FROM p_trainer OR s.remarks IS DISTINCT FROM nullif(btrim(coalesce(p_remarks,'')),'') THEN RAISE EXCEPTION USING errcode='23505',message='training_creation_key_conflict';END IF;
  RETURN s.id;
 END IF;
 SELECT * INTO p FROM public.profiles WHERE id=p_actor;
 SELECT * INTO trainer FROM public.profiles WHERE id=p_trainer;
 SELECT * INTO m FROM public.reliance_retail_store_master WHERE id=p_store AND status='Active' FOR SHARE;
 SELECT * INTO c FROM public.training_categories WHERE code='technical_mep' AND is_active;
 IF c.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.training_types WHERE id=p_type AND is_active) OR NOT EXISTS(SELECT 1 FROM public.access_clients WHERE id='369d2d5f-396f-49f9-a47d-bfbc8f7cb922' AND code='reliance_retail' AND active) THEN RAISE EXCEPTION USING errcode='22023',message='training_master_inactive';END IF;
 IF NOT public.training_retail_actor_v4(p_trainer) THEN RAISE EXCEPTION USING errcode='42501',message='training_actual_trainer_invalid';END IF;
 uploader_code:=coalesce(nullif(p.employee_code,''),p.username);
 INSERT INTO public.fo_activity_submissions(id,fo_user_id,employee_code,retail_store_id,store_code,activity_type,status,remarks,submitted_at,metadata)
 VALUES(sid,uploader_code,uploader_code,m.id,m.store_code,'training','draft',p_remarks,now(),jsonb_build_object('training_schema','structured_v1','training_source','reliance_retail_master','structured_status','draft','submission_source','Web','training_date',p_date));
 INSERT INTO public.training_sessions(id,category_id,training_type_id,trainer_profile_id,trainer_name_snapshot,training_date,remarks,status,retail_store_id,access_client_id,access_client_code,business_code_snapshot,business_name_snapshot,state_snapshot,store_code_snapshot,store_name_snapshot,require_attendee_snapshot,require_selected_topic_snapshot,topic_evidence_policy_snapshot,require_group_photo_snapshot,require_attendance_sheet_snapshot,require_training_document_snapshot,max_group_photos_snapshot,mobile_creation_key,submission_source,uploader_profile_id,actual_trainer_profile_id,completion_policy_version)
 VALUES(sid,c.id,p_type,p.id,coalesce(nullif(trainer.full_name,''),trainer.employee_code),p_date,nullif(btrim(coalesce(p_remarks,'')),''),'draft',m.id,'369d2d5f-396f-49f9-a47d-bfbc8f7cb922','reliance_retail','reliance_retail','Reliance Retail',m.state,m.store_code,m.store_name,false,true,'required',false,false,false,c.max_group_photos,'web:'||p_key,'Web',p.id,trainer.id,2);
 INSERT INTO public.training_events(training_session_id,event_type,actor_profile_id,metadata) VALUES(sid,'session_created',p_actor,jsonb_build_object('submission_source','Web','actual_trainer_profile_id',p_trainer,'training_date',p_date,'uploaded_at',clock_timestamp()));
 RETURN sid;
END $$;
-- Similar sessions are warnings, never a store/date uniqueness rule.
CREATE FUNCTION public.rpc_training_v2_duplicate_candidates(p_actor uuid,p_store uuid,p_date date) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'status',s.status,'training_date',s.training_date,'submission_source',s.submission_source,'trainer_name',s.trainer_name_snapshot)),'[]') FROM public.training_sessions s JOIN public.training_categories c ON c.id=s.category_id WHERE s.retail_store_id=p_store AND s.training_date=p_date AND c.code='technical_mep' AND s.status<>'cancelled' AND public.rpc_training_v2_read_allowed(p_actor,s.id);
$$;

CREATE OR REPLACE FUNCTION training_v2_private.mobile_draft_editor(p_session_id uuid, p_actor_profile_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_profile public.profiles%rowtype;
  v_session public.training_sessions%rowtype;
  v_envelope public.fo_activity_submissions%rowtype;
  v_store public.store_master%rowtype;
  v_retail_store public.reliance_retail_store_master%rowtype;
begin
  select * into v_profile from public.profiles where id = p_actor_profile_id;
  if not public.training_retail_actor_v4(p_actor_profile_id) then
    raise exception using errcode = '42501', message = 'training_mutation_forbidden';
  end if;
  select * into v_session from public.training_sessions where id = p_session_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'training_session_not_found'; end if;
  if not public.training_category_allowed_v4(p_actor_profile_id,v_session.category_id) then
    raise exception using errcode='42501',message='training_category_forbidden';
  end if;
  if v_session.trainer_profile_id is distinct from p_actor_profile_id then
    raise exception using errcode='42501',message='training_not_session_creator';
  end if;
  if v_session.status <> 'draft' then raise exception using errcode = 'P0001', message = 'training_session_immutable'; end if;
  if v_session.access_client_id <> '369d2d5f-396f-49f9-a47d-bfbc8f7cb922'::uuid
     or v_session.access_client_code <> 'reliance_retail' then
    raise exception using errcode = '42501', message = 'training_non_reliance_session';
  end if;
  select * into v_envelope from public.fo_activity_submissions where id = p_session_id for update;
  if not found or v_envelope.activity_type <> 'training' then
    raise exception using errcode = 'P0001', message = 'training_envelope_invalid';
  end if;
  if upper(btrim(coalesce(v_envelope.employee_code, v_envelope.fo_user_id, '')))
     <> upper(btrim(coalesce(v_profile.employee_code, v_profile.username, ''))) then
    raise exception using errcode = '42501', message = 'training_not_session_creator';
  end if;
  perform public.training_assert_active_context(p_actor_profile_id, v_session.attendance_id, v_session.site_visit_id);
  if v_session.retail_store_id is not null then
    select * into v_retail_store from public.reliance_retail_store_master where id = v_session.retail_store_id;
    if not public.training_retail_store_allowed(p_actor_profile_id, v_session.retail_store_id, v_session.category_id) then
      raise exception using errcode = '42501', message = 'training_store_scope_forbidden';
    end if;
  else
    select * into v_store from public.store_master where id = v_session.store_id;
    if not found or not (
      regexp_replace(upper(coalesce(v_store.business, '')), '[^A-Z0-9]+', '', 'g') in ('RELIANCE','RELIANCERETAIL')
      or regexp_replace(upper(coalesce(v_store.client_name, '')), '[^A-Z0-9]+', '', 'g') in ('RELIANCE','RELIANCERETAIL')
    ) then
      raise exception using errcode = '42501', message = 'training_non_reliance_store';
    end if;
  end if;
end;
$function$;


CREATE OR REPLACE FUNCTION public.training_session_write_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.training_v2_lock_actor(new.trainer_profile_id);
  if tg_op='UPDATE' and (new.submission_source is distinct from old.submission_source or new.uploader_profile_id is distinct from old.uploader_profile_id or new.actual_trainer_profile_id is distinct from old.actual_trainer_profile_id or new.completion_policy_version is distinct from old.completion_policy_version) then raise exception 'training_source_immutable'; end if;
  if tg_op='INSERT' then
    new.uploader_profile_id:=new.trainer_profile_id;
    if new.submission_source='Mobile' then new.actual_trainer_profile_id:=new.trainer_profile_id;end if;
    if exists(select 1 from public.training_categories c where c.id=new.category_id and c.code='technical_mep') then new.completion_policy_version:=2;end if;
  end if;
  if new.submission_source='Web' then
    perform public.training_v2_assert_web(new.trainer_profile_id,new.retail_store_id,new.training_date);
    if not exists(select 1 from public.training_categories c where c.id=new.category_id and c.code='technical_mep' and c.is_active) or new.attendance_id is not null or new.site_visit_id is not null then raise exception 'training_web_context_invalid';end if;
    if tg_op='UPDATE' and (old.status<>'draft' or new.trainer_profile_id is distinct from old.trainer_profile_id or new.retail_store_id is distinct from old.retail_store_id or new.store_id is distinct from old.store_id or new.category_id is distinct from old.category_id or new.training_date is distinct from old.training_date or new.trainer_name_snapshot is distinct from old.trainer_name_snapshot) then raise exception 'training_session_immutable';end if;
    new.require_attendee_snapshot:=false;new.require_selected_topic_snapshot:=true;new.topic_evidence_policy_snapshot:='required';
    if new.status='submitted' then perform public.training_v2_assert_completion(new.id);end if;
    return new;
  end if;
  if new.status='submitted' and new.completion_policy_version=2 then perform public.training_v2_assert_completion(new.id);end if;
  if not public.training_category_allowed_v4(new.trainer_profile_id,new.category_id) then
    raise exception using errcode='42501',message='training_category_forbidden';
  end if;
  perform public.training_assert_active_context(new.trainer_profile_id, new.attendance_id, new.site_visit_id);
  if tg_op = 'INSERT' then
    if new.retail_store_id is null or not public.training_retail_store_allowed(new.trainer_profile_id, new.retail_store_id, new.category_id) then
      raise exception using errcode = '42501', message = 'training_store_scope_forbidden';
    end if;
    new.training_date := (clock_timestamp() at time zone 'Asia/Kolkata')::date;
  else
    if old.status <> 'draft' then raise exception using errcode = 'P0001', message = 'training_session_immutable'; end if;
    new.training_date := old.training_date;
    if new.category_id is distinct from old.category_id then
      raise exception using errcode='42501',message='training_category_change_forbidden';
    end if;
    if new.attendance_id is distinct from old.attendance_id or new.site_visit_id is distinct from old.site_visit_id
       or new.trainer_profile_id is distinct from old.trainer_profile_id or new.store_id is distinct from old.store_id
       or new.retail_store_id is distinct from old.retail_store_id then
      raise exception using errcode = '42501', message = 'training_session_context_immutable';
    end if;
    if new.retail_store_id is not null and not public.training_retail_store_allowed(new.trainer_profile_id, new.retail_store_id, new.category_id) then
      raise exception using errcode = '42501', message = 'training_store_scope_forbidden';
    end if;
  end if;
  -- Explicit mobile policy applies to new and edited drafts; terminal rows stay immutable.
  new.require_attendee_snapshot := false;
  new.require_selected_topic_snapshot := true;
  new.topic_evidence_policy_snapshot := 'required';
  new.require_group_photo_snapshot := false;
  new.require_attendance_sheet_snapshot := false;
  new.require_training_document_snapshot := false;
  return new;
end; $function$;


CREATE OR REPLACE FUNCTION public.training_legacy_write_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare code text; p public.profiles%rowtype; training_write boolean;
begin
  training_write := new.activity_type = 'training';
  if tg_op = 'UPDATE' then training_write := training_write or old.activity_type = 'training'; end if;
  if tg_table_name = 'fo_activity_uploads' then
    training_write := training_write or exists(select 1 from public.training_sessions where id = new.submission_id);
  end if;
  if not training_write then return new; end if;
  code := upper(btrim(coalesce(nullif(new.employee_code,''),new.fo_user_id,'')));
  if coalesce(auth.role(),'') = 'authenticated' then
    select * into p from public.profiles where auth_user_id = auth.uid();
  else
    select * into p from public.profiles where upper(btrim(coalesce(nullif(employee_code,''),username,''))) = code limit 1;
  end if;
  if not found then return new; end if;
  if regexp_replace(upper(coalesce(p.business,'')), '[^A-Z0-9]+','','g') not in ('RELIANCE','RELIANCERETAIL')
     and not exists (
       select 1 from public.fo_site_visits v left join public.store_master s on s.id = v.store_id
       where v.id = new.site_visit_id and (v.retail_store_id is not null
         or regexp_replace(upper(coalesce(s.business,'')), '[^A-Z0-9]+','','g') in ('RELIANCE','RELIANCERETAIL')
         or regexp_replace(upper(coalesce(s.client_name,'')), '[^A-Z0-9]+','','g') in ('RELIANCE','RELIANCERETAIL'))
     ) then return new; end if;
  if tg_table_name = 'fo_activity_uploads' or coalesce(auth.role(),'') = 'authenticated'
     or coalesce(new.metadata ->> 'training_schema','') <> 'structured_v1' then
    raise exception using errcode = '42501', message = 'training_legacy_read_only';
  end if;
  if new.metadata->>'submission_source'='Web' then
    if coalesce(auth.role(),'')='authenticated' or new.attendance_id is not null or new.site_visit_id is not null then raise exception 'training_web_context_invalid';end if;
    perform public.training_v2_assert_web(p.id,new.retail_store_id,(new.metadata->>'training_date')::date);
    return new;
  end if;
  perform public.training_assert_active_context(p.id,new.attendance_id,new.site_visit_id);
  return new;
end; $function$;


CREATE OR REPLACE FUNCTION public.rpc_submit_reliance_training_session_v2(p_session_id uuid, p_actor_profile_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare s public.training_sessions%rowtype;
begin
  perform public.training_v2_lock_actor(p_actor_profile_id);
  select * into s from public.training_sessions where id = p_session_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'training_session_not_found'; end if;
  if s.trainer_profile_id is distinct from p_actor_profile_id then raise exception using errcode = '42501', message = 'training_not_session_creator'; end if;
  -- Retry is a read, including after closure; it must not append a second submitted event.
  if s.status = 'submitted' then return s.id; end if;
  return public.rpc_submit_reliance_training_session(p_session_id,p_actor_profile_id);
end; $function$;


CREATE OR REPLACE FUNCTION public.rpc_retail_mis_training_v4(p_actor uuid, p_auth uuid, p_category text, p_from date, p_to date, p_state text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'qpms_training_reports'
AS $function$
declare stores jsonb; sessions jsonb; evidence jsonb;
begin
 if p_state is not null then p_state:=case regexp_replace(upper(btrim(p_state)),'[^A-Z0-9-]','','g') when 'KN' then 'KA' when 'KARNATAKA' then 'KA' when 'TAMILNADU' then 'TN' when 'PUDUCHERRY' then 'PY' else upper(btrim(p_state)) end;end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 or p_category not in ('hk','technical_mep') or p_category is null then raise exception using errcode='22023',message='Valid category and reporting dates required';end if;
 if p_state is not null and not qpms_training_reports.allowed(p_actor,p_auth,p_category,p_state) then raise exception using errcode='42501',message='Training state outside active MIS assignment';end if;
 if not exists(select 1 from unnest(array['AP-1','AP-2','KA','KL','TG','TN','PY']) s where qpms_training_reports.allowed(p_actor,p_auth,p_category,s)) then raise exception using errcode='42501',message='Verified category/module/state assignment required';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'store_code',m.store_code,'store_name',m.store_name,'state',m.state)),'[]') into stores
 from public.reliance_retail_store_master m where m.status='Active' and public.training_v2_report_store(p_actor,p_category,m.id) and qpms_training_reports.allowed(p_actor,p_auth,p_category,m.state) and (p_state is null or m.state=p_state)
 and (select count(*) from public.reliance_retail_store_master x where upper(btrim(x.store_code))=upper(btrim(m.store_code)))=1;
 select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object(
  'source_kind','existing_fo_training','training_class',case p_category when 'hk' then 'HK' else 'MEPC' end,
  'state',m.state,'reporting_state',case m.state when 'PY' then 'TN' else m.state end,
  'store_code',m.store_code,'store_name',m.store_name,
  'submitted_by_employee_code',coalesce(nullif(btrim(a.employee_code),''),nullif(btrim(a.fo_user_id),'')),
  'topic_names',coalesce((
   select jsonb_agg(topic.module_name order by topic.sort_order,topic.module_name,topic.id)
   from public.training_session_topics st join public.training_topics topic on topic.id=st.topic_id
   where st.training_session_id=t.id and topic.category_id=t.category_id
  ),'[]'::jsonb)
 )),'[]') into sessions
 from public.training_sessions t join public.training_categories c on c.id=t.category_id
 left join public.fo_activity_submissions a on a.id=t.id
 join public.reliance_retail_store_master m on (t.retail_store_id=m.id or (t.retail_store_id is null and upper(btrim(t.store_code_snapshot))=upper(btrim(m.store_code))))
 where m.id in (select (x->>'id')::uuid from jsonb_array_elements(stores) x)
 and upper(btrim(t.store_code_snapshot))=upper(btrim(m.store_code))
 and (t.state_snapshot is null or (case upper(t.state_snapshot) when 'KN' then 'KA' else upper(t.state_snapshot) end)=m.state)
 and t.access_client_code='reliance_retail' and c.code=p_category and t.training_date between p_from and p_to
 and t.status in ('submitted','completed');
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',e.id,'record_id',e.training_session_id,'status','uploaded','existing',true,
  'mime_type',e.mime_type,'topic_name',topic.module_name
 )),'[]') into evidence
 from public.training_evidence e
 left join public.training_session_topics st on st.id=e.training_session_topic_id and st.training_session_id=e.training_session_id
 left join public.training_topics topic on topic.id=st.topic_id
 where e.training_session_id in (select (x->>'id')::uuid from jsonb_array_elements(sessions) x)
 and e.metadata->>'upload_status'='uploaded' and e.storage_bucket='training-evidence'
 and exists(select 1 from storage.buckets b where b.id='training-evidence' and b.public=false)
 and exists(select 1 from storage.objects o where o.bucket_id=e.storage_bucket and o.name=e.storage_path)
 and e.storage_path like 'training/'||e.training_session_id::text||'/'||e.id::text||'/%';
 return jsonb_build_object('stores',stores,'rows',sessions,'evidence',evidence,'read_only',true,'from',p_from,'to',p_to,'category',p_category,'counts',jsonb_build_object('completed_sessions',jsonb_array_length(sessions)));
end $function$;


CREATE OR REPLACE FUNCTION training_v2_private.retail_mis_allowed_baseline(p_actor uuid, p_module text, p_state text, p_write boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 select (p_module='oos' and public.retail_oos_operator_allowed(p_actor,(case when p_module='oos' then public.retail_oos_state(p_state) else p_state end))) or exists(select 1 from public.retail_mis_assignments a join public.profiles p on p.id=a.profile_id
 where a.profile_id=p_actor and a.active and p.is_active is true and upper(coalesce(p.status,'Active'))='ACTIVE'
 and p.auth_user_id=a.auth_user_id and p.employee_code=a.employee_code and p.role=a.role
 and ((case when p_module='oos' then public.retail_oos_state(p_state) else p_state end) is null or ((case when p_module='oos' then public.retail_oos_state(p_state) else p_state end) in ('AP-1','AP-2','KA','KL','TG','TN','PY') and (a.role='CENTRAL_MIS' or (case when p_module='oos' then public.retail_oos_state(p_state) else p_state end)=any(a.states))))
 and case a.role when 'CENTRAL_MIS' then p_module=any(array['dashboard','stores','attendance-hk','attendance-mepc','cleaning','pest','training-hk','training-mepc','fault','maintenance','thermography','oos','imports'])
 when 'MIS_HK' then p_module=any(array['stores','attendance-hk','cleaning','pest','training-hk'])
 when 'MIS_MEPC' then p_module=any(array['stores','attendance-mepc','fault','maintenance','thermography']) when 'MIS_OOS' then p_module='oos' else false end);
$function$;

CREATE OR REPLACE FUNCTION public.rpc_retail_mis_training_evidence_v4(p_actor uuid, p_auth uuid, p_category text, p_session uuid, p_evidence uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'qpms_training_reports'
AS $function$
declare meta jsonb;
begin
 select jsonb_build_object('bucket',e.storage_bucket,'path',e.storage_path) into meta
 from public.training_evidence e join public.training_sessions t on t.id=e.training_session_id
 join public.training_categories c on c.id=t.category_id
 join public.reliance_retail_store_master m on (t.retail_store_id=m.id or (t.retail_store_id is null and upper(btrim(t.store_code_snapshot))=upper(btrim(m.store_code))))
 where e.id=p_evidence and t.id=p_session and c.code=p_category and t.access_client_code='reliance_retail'
 and t.status in ('submitted','completed') and e.metadata->>'upload_status'='uploaded'
 and upper(btrim(t.store_code_snapshot))=upper(btrim(m.store_code))
 and (t.state_snapshot is null or (case upper(t.state_snapshot) when 'KN' then 'KA' else upper(t.state_snapshot) end)=m.state)
 and (select count(*) from public.reliance_retail_store_master x where upper(btrim(x.store_code))=upper(btrim(m.store_code)))=1
 and public.training_v2_report_store(p_actor,p_category,m.id)
 and qpms_training_reports.allowed(p_actor,p_auth,p_category,m.state)
 and e.storage_bucket='training-evidence' and e.storage_path like 'training/'||t.id::text||'/'||e.id::text||'/%'
 and exists(select 1 from storage.buckets b where b.id='training-evidence' and b.public=false)
 and exists(select 1 from storage.objects o where o.bucket_id=e.storage_bucket and o.name=e.storage_path);
 if meta is null then raise exception using errcode='42501',message='Private Training evidence outside verified scope';end if;
 return meta;
end $function$;

CREATE OR REPLACE FUNCTION qpms_training_reports.allowed(p_actor uuid,p_auth uuid,p_category text,p_state text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p JOIN public.reliance_retail_store_master m ON public.training_v2_state(m.state)=public.training_v2_state(p_state) WHERE p.id=p_actor AND p.auth_user_id=p_auth AND public.training_v2_report_store(p_actor,p_category,m.id));
$$;
CREATE OR REPLACE FUNCTION public.retail_mis_allowed(p_actor uuid,p_module text,p_state text,p_write boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN p_module IN ('training-hk','training-mepc') THEN EXISTS(SELECT 1 FROM public.reliance_retail_store_master m WHERE (p_state IS NULL OR public.training_v2_state(m.state)=public.training_v2_state(p_state)) AND public.training_v2_report_store(p_actor,CASE p_module WHEN 'training-hk' THEN 'hk' ELSE 'technical_mep' END,m.id) AND (NOT p_write OR (p_module='training-mepc' AND public.training_v2_web_allowed(p_actor,m.id)))) ELSE training_v2_private.retail_mis_allowed_baseline(p_actor,p_module,p_state,p_write) END;
$$;
-- New functions are service-only. No new browser grants or RLS policies.
DO $acl$ DECLARE p record;BEGIN
 FOR p IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'training_v2_%' OR proname LIKE 'rpc_training_%' OR proname='rpc_set_training_category_entitlements' OR proname='rpc_create_reliance_training_web_v2') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',p.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',p.signature);
 END LOOP;
END $acl$;

COMMIT;
