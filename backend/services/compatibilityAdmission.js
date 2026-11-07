// Phase 1 is intentionally incapable of opening evidence writes. Opening is
// performed only by replacing this bridge with the reviewed feature release
// and satisfying that release's database gate. Missing SQL cannot open writes.
export function closeEvidenceMutationRoutes(router,{matches=()=>true,shouldClose=()=>true}={}) {
  for(const method of ['post','put','patch','delete']) {
    const register=router[method].bind(router);
    router[method]=(path,...handlers)=>{
      if(matches(path)) {
        const handler=handlers.pop();
        handlers.push(async(req,res,next)=>{
          try {if(!await shouldClose(req))return await handler(req,res,next);}catch { /* Unknown kind is closed. */ }
          return res.status(503).json({ok:false,code:'evidence_compatibility_maintenance',message:'Deep Cleaning and Training writes are temporarily closed for a controlled upgrade.'});
        });
      }
      return register(path,...handlers);
    };
  }
}
