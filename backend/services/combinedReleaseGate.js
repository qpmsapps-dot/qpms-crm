import {randomUUID} from 'node:crypto';

function unavailable() {
  return Object.assign(new Error('Training and Deep Cleaning writes are temporarily unavailable.'),{statusCode:503,code:'combined_release_frozen'});
}
export async function withCombinedReleaseOperation(client,actor,route,work) {
  // These normal evidence operations retain their own actor/object checks.
  // Release-control admission is no longer their operational availability switch.
  if (['storage:cleaning-upload-grant','storage:training-content'].includes(route)) return await work();
  const token=randomUUID();
  let begin;
  try {begin=await client.rpc('rpc_combined_release_begin',{p_token:token,p_actor:actor,p_route:route});}
  catch {throw unavailable();}
  if(!begin || begin.error)throw unavailable();
  let result,failed=false,workError;
  try {result=await work();}catch(error){failed=true;workError=error;}
  // Await actual work, not HTTP finish/close. A crashed request remains active
  // until separately investigated; no clock-based ticket expiry can fake drain.
  let end;
  try {end=await client.rpc('rpc_combined_release_end',{p_token:token,p_actor:actor});}
  catch {throw unavailable();}
  if(!end||end.error)throw unavailable();
  if(failed)throw workError;
  return result;
}

// Wrap only the final controller, after authentication/body parsing. Wrapping
// registration makes all present/future mutation methods use one gate contract.
export function gateCombinedMutationRoutes(router,{getClient,matches=()=>true,shouldGate=()=>true,normalOperations=false}) {
  // Explicitly retired at existing Retail call sites; controller auth stays intact.
  if (normalOperations) return router;
  for(const method of ['post','put','patch','delete']) {
    const register=router[method].bind(router);
    router[method]=(path,...handlers)=>{
      if(matches(path)) {
        const handler=handlers.pop();
        handlers.push(async(req,res,next)=>{
          try {
            if(!await shouldGate(req))return await handler(req,res,next);
            await withCombinedReleaseOperation(getClient(),req.profile?.id,`${method.toUpperCase()} ${req.baseUrl||''}${path}`,()=>handler(req,res,next));
          }
          catch(error) {
            if(!res.headersSent)res.status(503).json({ok:false,code:'combined_release_frozen',message:unavailable().message});
            else console.error('[CombinedRelease] Operation completion requires drain review.',error.code||'unavailable');
          }
        });
      }
      return register(path,...handlers);
    };
  }
}
