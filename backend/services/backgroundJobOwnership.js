import {randomUUID} from 'node:crypto';
// Unique per process boot, not an environment flag or a timestamp lease.
const owner=randomUUID();
const active=new Set();let draining=false;

export function runOwnedBackgroundJob(client,job,work,options={}) {
  if(draining)return Promise.resolve({ran:false,reason:'process_draining'});
  const task=executeOwnedJob(client,job,work,options);active.add(task);
  task.then(()=>active.delete(task),()=>active.delete(task));return task;
}
export async function drainBackgroundJobs(){draining=true;await Promise.allSettled([...active]);}

async function executeOwnedJob(client,job,work,{slot=null,logger=console}={}) {
  const token=randomUUID();let claim;
  try {claim=await client.rpc('rpc_worker_claim_v1',{p_job:job,p_owner:owner,p_token:token,p_slot:slot});}
  catch {return {ran:false,reason:'ownership_unavailable'};}
  if(claim?.error || claim?.data!==true)return {ran:false,reason:claim?.error?'ownership_unavailable':'standby_or_busy'};
  let value,failed=false,workError;
  try {value=await work();}catch(error){failed=true;workError=error;}
  // A transient transport/database failure must not permanently strand an owned claim.
  // Retry the same token only; never re-run the financial work or steal another owner's lease.
  let released;
  for(let attempt=0;attempt<3;attempt++){
    try {released=await client.rpc('rpc_worker_release_v1',{p_job:job,p_owner:owner,p_token:token});}
    catch {released=null;}
    if(released?.data===true && !released.error)break;
    // A definitive false means the claim is no longer ours; require operator review.
    if(released?.data===false && !released.error)break;
    if(attempt<2)await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
  }
  if(released?.error || released?.data!==true){
    logger.error('[Worker ownership] Completion uncertain; operator reconciliation required.',{job});
    throw Object.assign(new Error('Worker ownership completion is uncertain.'),{code:'worker_completion_uncertain'});
  }
  if(failed)throw workError;
  return {ran:true,value};
}

export async function ownedJobValue(client,job,work,options) {
  const result=await runOwnedBackgroundJob(client,job,work,options);
  if(!result.ran)throw Object.assign(new Error('Background job is in safe handoff or already running.'),{statusCode:503,code:'worker_not_owned'});
  return result.value;
}

export function startOwnedOnce(client,job,work,{schedule=setTimeout,logger=console,retryMs=10000}={}) {
  let stopped=false,timer;
  const tick=async()=>{
    if(stopped)return;
    try {
      const result=await runOwnedBackgroundJob(client,job,work,{logger});
      if(!result.ran&&!stopped){timer=schedule(tick,retryMs);timer.unref?.();}
    }catch(error){logger.error('[Worker ownership] One-time execution requires review.',{job,code:error.code});}
  };
  void tick();
  return {stop(){stopped=true;if(timer)clearTimeout(timer);}};
}
