-- Isolated disposable PostgreSQL only, never production.
BEGIN;
CREATE SCHEMA qpms_workers;
CREATE TABLE qpms_workers.control(id boolean primary key check(id),mode text not null check(mode in ('legacy_handoff','owned','closed')),epoch bigint not null,allowed_jobs text[] not null,constraint control_allowed_jobs_check check(cardinality(allowed_jobs)<=2 and allowed_jobs <@ array['end_day_km','fo_stale_cleanup']::text[] and array_position(allowed_jobs,null::text) is null));
CREATE TABLE qpms_workers.jobs(job text primary key check(job in ('end_day_km','fo_stale_cleanup','gps_summary')),owner uuid,token uuid,started_at timestamptz,slot text,last_completed_slot text,check((owner is null)=(token is null)));
CREATE TABLE qpms_workers.audit(id bigint generated always as identity primary key,action text,epoch bigint,evidence jsonb);
CREATE OR REPLACE FUNCTION qpms_workers.audit_admission_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'qpms_workers'
AS $function$
BEGIN
 IF new.allowed_jobs IS DISTINCT FROM old.allowed_jobs THEN
  IF old.mode='owned' OR EXISTS(SELECT 1 FROM jobs WHERE token IS NOT NULL)
  THEN RAISE EXCEPTION 'change_admission_only_while_closed_and_drained'; END IF;
  INSERT INTO audit(action,epoch,evidence) VALUES('worker_admission',new.epoch,
   jsonb_build_object('before',old.allowed_jobs,'after',new.allowed_jobs));
 END IF;
 RETURN new;
END $function$
;
CREATE OR REPLACE FUNCTION public.rpc_worker_claim_v1(p_job text, p_owner uuid, p_token uuid, p_slot text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'qpms_workers'
AS $function$
DECLARE m text; admitted text[]; claimed uuid;
BEGIN
 SELECT mode,allowed_jobs INTO m,admitted FROM control WHERE id FOR SHARE;
 IF m IS DISTINCT FROM 'owned' OR NOT coalesce(p_job=ANY(admitted),false) THEN RETURN false; END IF;
 IF p_owner IS NULL OR p_token IS NULL OR length(coalesce(p_slot,''))>240 THEN RAISE EXCEPTION 'Invalid worker identity'; END IF;
 INSERT INTO jobs(job,owner,token,started_at,slot) VALUES(p_job,p_owner,p_token,clock_timestamp(),p_slot)
 ON CONFLICT(job) DO UPDATE SET owner=excluded.owner,token=excluded.token,started_at=excluded.started_at,slot=excluded.slot
 WHERE jobs.token IS NULL AND (excluded.slot IS NULL OR jobs.last_completed_slot IS DISTINCT FROM excluded.slot)
 RETURNING token INTO claimed;
 RETURN coalesce(claimed=p_token,false);
END $function$
;
CREATE OR REPLACE FUNCTION public.rpc_worker_close_v1(p_reason text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'qpms_workers'
AS $function$
declare e bigint;
begin
 if length(btrim(coalesce(p_reason,'')))<16 then raise exception 'Worker incident/change reference required';end if;
 update control set mode='closed',epoch=epoch+1 where id returning epoch into e;
 insert into audit(action,epoch,evidence) values('closed',e,jsonb_build_object('reason',p_reason));return e;
end $function$
;
CREATE OR REPLACE FUNCTION public.rpc_worker_open_v1(p_epoch bigint, p_retirement_proof text, p_artifact_sha256 text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'qpms_workers'
AS $function$
declare m text;e bigint;
begin
 select mode,epoch into m,e from control where id for update;
 if e is distinct from p_epoch or m not in ('legacy_handoff','closed') or exists(select 1 from jobs where token is not null)
 or length(btrim(coalesce(p_retirement_proof,'')))<24 or coalesce(p_artifact_sha256,'')!~'^[0-9a-f]{64}$' then raise exception 'Verified old-writer retirement, zero active jobs and reviewed artifact required'; end if;
 update control set mode='owned',epoch=epoch+1 where id;
 insert into audit(action,epoch,evidence) values('owned_handoff',e+1,jsonb_build_object('proof',p_retirement_proof,'artifact',p_artifact_sha256));
end $function$
;
CREATE OR REPLACE FUNCTION public.rpc_worker_reconcile_v1(p_epoch bigint, p_job text, p_owner uuid, p_token uuid, p_dead_process_proof text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'qpms_workers'
AS $function$
declare m text;e bigint;
begin
 select mode,epoch into m,e from control where id for update;
 if m is distinct from 'closed' or e is distinct from p_epoch or length(btrim(coalesce(p_dead_process_proof,'')))<32 then raise exception 'Closed mode, current epoch and independently verified process/side-effect proof required';end if;
 update jobs set owner=null,token=null,slot=null where job=p_job and owner=p_owner and token=p_token;
 if not found then raise exception 'Stale or unknown worker claim';end if;
 insert into audit(action,epoch,evidence) values('incident_reconciled',e,jsonb_build_object('job',p_job,'owner',p_owner,'token',p_token,'proof',p_dead_process_proof));
end $function$
;
CREATE OR REPLACE FUNCTION public.rpc_worker_release_v1(p_job text, p_owner uuid, p_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'qpms_workers'
AS $function$
begin
 update qpms_workers.jobs set owner=null,token=null,last_completed_slot=coalesce(slot,last_completed_slot),slot=null
 where job=p_job and owner=p_owner and token=p_token;
 return found;
end $function$
;
CREATE TRIGGER audit_admission BEFORE UPDATE ON qpms_workers.control FOR EACH ROW EXECUTE FUNCTION qpms_workers.audit_admission_v1();
INSERT INTO qpms_workers.control VALUES(true,'owned',7,array['end_day_km','fo_stale_cleanup']);
INSERT INTO qpms_workers.jobs(job,owner,token) VALUES('end_day_km','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
COMMIT;