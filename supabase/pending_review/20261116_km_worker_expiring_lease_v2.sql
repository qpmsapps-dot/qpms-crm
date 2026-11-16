-- One-time KM ownership lease protocol. Apply before deploying the matching backend.
-- Existing held v1 claims deliberately receive no expiry: reconcile those through
-- the established closed-epoch operator procedure after the old process is gone.
begin;
set local lock_timeout='3s';
set local statement_timeout='25s';

alter table qpms_workers.jobs
  add column if not exists lease_until timestamptz,
  add column if not exists claimed_epoch bigint,
  add column if not exists last_released_token uuid;

-- Only the END DAY KM worker opts into leases; the other six/background
-- services continue to use their existing rpc_worker_claim_v1 contract.
create function public.rpc_worker_claim_km_v2(
  p_job text, p_owner uuid, p_token uuid, p_slot text default null
) returns boolean
language plpgsql security definer
set search_path=pg_catalog,qpms_workers
as $$
declare v_mode text; v_epoch bigint; v_allowed text[]; v_claimed uuid;
        prior qpms_workers.jobs%rowtype;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'km_service_worker_required' using errcode='42501';
  end if;
  if p_job is distinct from 'end_day_km' or p_owner is null or p_token is null
     or length(coalesce(p_slot,''))>240 then
    raise exception 'km_worker_identity_invalid' using errcode='42501';
  end if;
  select mode,epoch,allowed_jobs into v_mode,v_epoch,v_allowed
  from qpms_workers.control where id for share;
  if v_mode is distinct from 'owned'
    or not coalesce(p_job=any(v_allowed),false) then return false; end if;

  select * into prior from qpms_workers.jobs where job=p_job for update;
  if found and prior.token is not null and prior.lease_until is not null
     and prior.lease_until<=clock_timestamp()
     and prior.claimed_epoch=v_epoch then
    insert into qpms_workers.audit(action,epoch,evidence)
    values('km_expired_claim_replaced',v_epoch,jsonb_build_object(
      'job',p_job,'prior_owner',prior.owner,'prior_token',prior.token,
      'expired_at',prior.lease_until,'replacement_owner',p_owner));
  end if;

  insert into qpms_workers.jobs as current_claim
    (job,owner,token,started_at,slot,lease_until,claimed_epoch,last_released_token)
  values
    (p_job,p_owner,p_token,clock_timestamp(),p_slot,clock_timestamp()+interval '180 seconds',v_epoch,null)
  on conflict(job) do update set
    owner=excluded.owner,token=excluded.token,started_at=excluded.started_at,
    slot=excluded.slot,lease_until=excluded.lease_until,claimed_epoch=excluded.claimed_epoch,
    last_released_token=null
  where (current_claim.token is null or
    (current_claim.lease_until is not null
      and current_claim.lease_until<=clock_timestamp()
      and current_claim.claimed_epoch=v_epoch))
    and (excluded.slot is null or current_claim.last_completed_slot is distinct from excluded.slot)
  returning token into v_claimed;
  return coalesce(v_claimed=p_token,false);
end $$;

create function public.rpc_worker_renew_km_v2(
  p_job text,p_owner uuid,p_token uuid
) returns boolean
language plpgsql security definer
set search_path=pg_catalog,qpms_workers
as $$
declare v_epoch bigint; v_mode text; v_allowed text[];
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'km_service_worker_required' using errcode='42501';
  end if;
  if p_job is distinct from 'end_day_km' or p_owner is null or p_token is null then
    raise exception 'km_worker_identity_invalid' using errcode='42501';
  end if;
  select mode,epoch,allowed_jobs into v_mode,v_epoch,v_allowed
  from qpms_workers.control where id for share;
  if v_mode is distinct from 'owned' or not coalesce(p_job=any(v_allowed),false)
    then return false; end if;
  update qpms_workers.jobs set lease_until=clock_timestamp()+interval '180 seconds'
  where job=p_job and owner=p_owner and token=p_token and claimed_epoch=v_epoch
    and lease_until>clock_timestamp();
  return found;
end $$;

create function public.rpc_worker_release_km_v2(
  p_job text,p_owner uuid,p_token uuid
) returns boolean
language plpgsql security definer
set search_path=pg_catalog,qpms_workers
as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'km_service_worker_required' using errcode='42501';
  end if;
  if p_job is distinct from 'end_day_km' or p_owner is null or p_token is null then
    raise exception 'km_worker_identity_invalid' using errcode='42501';
  end if;
  update qpms_workers.jobs
  set owner=null,token=null,last_completed_slot=coalesce(slot,last_completed_slot),
      slot=null,lease_until=null,claimed_epoch=null,last_released_token=p_token
  where job=p_job and owner=p_owner and token=p_token;
  if found then return true; end if;
  -- If the DB committed the release but its response was lost, a retry is
  -- successful only if the job is unowned. Never clear another owner's claim.
  return exists(select 1 from qpms_workers.jobs
    where job=p_job and owner is null and token is null and last_released_token=p_token);
end $$;

revoke all on function
 public.rpc_worker_claim_km_v2(text,uuid,uuid,text),
 public.rpc_worker_renew_km_v2(text,uuid,uuid),
 public.rpc_worker_release_km_v2(text,uuid,uuid)
from public,anon,authenticated,service_role;
grant execute on function
 public.rpc_worker_claim_km_v2(text,uuid,uuid,text),
 public.rpc_worker_renew_km_v2(text,uuid,uuid),
 public.rpc_worker_release_km_v2(text,uuid,uuid)
to service_role;
commit;
