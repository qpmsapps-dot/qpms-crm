-- ADDITIVE compatibility prerequisite. No shared business-table DDL.
begin;
set local lock_timeout='1s';
set local statement_timeout='15s';
set local idle_in_transaction_session_timeout='5s';
set local transaction_timeout='30s';
do $$ begin
 if not exists(select 1 from pg_roles where rolname='qpms_worker_operator') then create role qpms_worker_operator nologin;
 elsif exists(select 1 from pg_roles where rolname='qpms_worker_operator' and (rolcanlogin or rolsuper or rolcreaterole or rolcreatedb or rolbypassrls))
 or pg_has_role('service_role','qpms_worker_operator','MEMBER') or pg_has_role('authenticated','qpms_worker_operator','MEMBER') or pg_has_role('anon','qpms_worker_operator','MEMBER') then raise exception 'Unsafe worker operator role'; end if;
end $$;
create schema qpms_workers;
revoke all on schema qpms_workers from public,anon,authenticated,service_role,qpms_worker_operator;
create table qpms_workers.control(id boolean primary key default true check(id),mode text not null check(mode in ('legacy_handoff','owned','closed')),epoch bigint not null default 1);
insert into qpms_workers.control(id,mode) values(true,'legacy_handoff');
create table qpms_workers.jobs(
 job text primary key check(job in ('hospital_sla','smtp_verification','daily_operations_report','end_day_km','gps_summary','fo_stale_cleanup')),
 owner uuid,token uuid,started_at timestamptz,slot text,last_completed_slot text,
 check((owner is null)=(token is null))
);
create table qpms_workers.audit(id bigint generated always as identity primary key,at timestamptz not null default clock_timestamp(),principal text not null default session_user,action text not null,epoch bigint not null,evidence jsonb not null);
alter table qpms_workers.control enable row level security;
alter table qpms_workers.jobs enable row level security;
alter table qpms_workers.audit enable row level security;
revoke all on all tables in schema qpms_workers from public,anon,authenticated,service_role,qpms_worker_operator;
revoke all on all sequences in schema qpms_workers from public,anon,authenticated,service_role,qpms_worker_operator;

create function public.rpc_worker_claim_v1(p_job text,p_owner uuid,p_token uuid,p_slot text default null) returns boolean
language plpgsql security definer set search_path=pg_catalog,qpms_workers as $$
declare m text; claimed uuid;
begin
 select mode into m from qpms_workers.control where id for share;
 if m is distinct from 'owned' then return false; end if;
 if p_owner is null or p_token is null or length(coalesce(p_slot,''))>240 then raise exception 'Invalid worker identity'; end if;
 insert into qpms_workers.jobs(job,owner,token,started_at,slot) values(p_job,p_owner,p_token,clock_timestamp(),p_slot)
 on conflict(job) do update set owner=excluded.owner,token=excluded.token,started_at=excluded.started_at,slot=excluded.slot
 where jobs.token is null and (excluded.slot is null or jobs.last_completed_slot is distinct from excluded.slot)
 returning token into claimed;
 return coalesce(claimed=p_token,false);
end $$;
create function public.rpc_worker_release_v1(p_job text,p_owner uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,qpms_workers as $$
begin
 update qpms_workers.jobs set owner=null,token=null,last_completed_slot=coalesce(slot,last_completed_slot),slot=null
 where job=p_job and owner=p_owner and token=p_token;
 return found;
end $$;
create function public.rpc_worker_status_v1() returns jsonb language sql stable security definer set search_path=pg_catalog,qpms_workers as $$
 select jsonb_build_object('mode',mode,'epoch',epoch,'active_jobs',(select count(*) from jobs where token is not null)) from control where id
$$;
create function public.rpc_worker_inspect_v1() returns jsonb language sql stable security definer set search_path=pg_catalog,qpms_workers as $$
 select coalesce(jsonb_agg(jsonb_build_object('job',job,'owner',owner,'token',token,'started_at',started_at,'slot',slot)),'[]'::jsonb) from jobs where token is not null
$$;
create function public.rpc_worker_open_v1(p_epoch bigint,p_retirement_proof text,p_artifact_sha256 text) returns void
language plpgsql security definer set search_path=pg_catalog,qpms_workers as $$
declare m text;e bigint;
begin
 select mode,epoch into m,e from control where id for update;
 if e is distinct from p_epoch or m not in ('legacy_handoff','closed') or exists(select 1 from jobs where token is not null)
 or length(btrim(coalesce(p_retirement_proof,'')))<24 or coalesce(p_artifact_sha256,'')!~'^[0-9a-f]{64}$' then raise exception 'Verified old-writer retirement, zero active jobs and reviewed artifact required'; end if;
 update control set mode='owned',epoch=epoch+1 where id;
 insert into audit(action,epoch,evidence) values('owned_handoff',e+1,jsonb_build_object('proof',p_retirement_proof,'artifact',p_artifact_sha256));
end $$;
create function public.rpc_worker_close_v1(p_reason text) returns bigint
language plpgsql security definer set search_path=pg_catalog,qpms_workers as $$
declare e bigint;
begin
 if length(btrim(coalesce(p_reason,'')))<16 then raise exception 'Worker incident/change reference required';end if;
 update control set mode='closed',epoch=epoch+1 where id returning epoch into e;
 insert into audit(action,epoch,evidence) values('closed',e,jsonb_build_object('reason',p_reason));return e;
end $$;
create function public.rpc_worker_reconcile_v1(p_epoch bigint,p_job text,p_owner uuid,p_token uuid,p_dead_process_proof text) returns void
language plpgsql security definer set search_path=pg_catalog,qpms_workers as $$
declare m text;e bigint;
begin
 select mode,epoch into m,e from control where id for update;
 if m is distinct from 'closed' or e is distinct from p_epoch or length(btrim(coalesce(p_dead_process_proof,'')))<32 then raise exception 'Closed mode, current epoch and independently verified process/side-effect proof required';end if;
 update jobs set owner=null,token=null,slot=null where job=p_job and owner=p_owner and token=p_token;
 if not found then raise exception 'Stale or unknown worker claim';end if;
 insert into audit(action,epoch,evidence) values('incident_reconciled',e,jsonb_build_object('job',p_job,'owner',p_owner,'token',p_token,'proof',p_dead_process_proof));
end $$;
revoke all on function public.rpc_worker_claim_v1(text,uuid,uuid,text),public.rpc_worker_release_v1(text,uuid,uuid),public.rpc_worker_status_v1(),public.rpc_worker_inspect_v1(),public.rpc_worker_open_v1(bigint,text,text),public.rpc_worker_close_v1(text),public.rpc_worker_reconcile_v1(bigint,text,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.rpc_worker_claim_v1(text,uuid,uuid,text),public.rpc_worker_release_v1(text,uuid,uuid),public.rpc_worker_status_v1() to service_role;
grant execute on function public.rpc_worker_status_v1(),public.rpc_worker_inspect_v1(),public.rpc_worker_open_v1(bigint,text,text),public.rpc_worker_close_v1(text),public.rpc_worker_reconcile_v1(bigint,text,uuid,uuid,text) to qpms_worker_operator;
commit;
