// HTTP lifecycle and optional worker drain; job business bodies are unchanged.
export function createHttpLifecycle({isReady,environment=process.env,signals=process,exit=code=>process.exit(code),shutdownTimeoutMs=25000,logger=console,drainWorkers=null}){
 let server,draining=false;
 function readiness(req,res){
  const ready=Boolean(server?.listening)&&!draining&&isReady();
  res.set('Cache-Control','no-store').status(ready?200:503).json({
   ok:ready,draining,oos_mutations_frozen:environment.RETAIL_OOS_MUTATIONS_FROZEN==='true',
   deployment_id:environment.RAILWAY_DEPLOYMENT_ID||null,
   replica_id:environment.RAILWAY_REPLICA_ID||null,
   commit_sha:environment.RAILWAY_GIT_COMMIT_SHA||null,
  });
 }
 function shutdown(){
  if(draining)return;draining=true;
  const workerDrain=drainWorkers?Promise.resolve().then(drainWorkers):null;
  logger.info('[HTTP] SIGTERM received; draining active requests.');
  const deadline=setTimeout(()=>{logger.error('[HTTP] Request drain timed out.');server.closeAllConnections?.();exit(1);},shutdownTimeoutMs);
  deadline.unref?.();
  server.close(error=>{
   const finish=()=>{clearTimeout(deadline);exit(error?1:0);};
   if(workerDrain)void workerDrain.then(finish,()=>{clearTimeout(deadline);exit(1);});else finish();
  });
  server.closeIdleConnections?.();
 }
 function attach(httpServer){server=httpServer;signals.once('SIGTERM',shutdown);}
 return {readiness,attach};
}
