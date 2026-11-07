import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import net from 'node:net';import {spawn} from 'node:child_process';
test('Normal startup keeps HTTP/auth/KM routes available while all updated workers are in DB standby',async()=>{
 const cwd=new URL('..',import.meta.url);assert.equal(fs.existsSync(new URL('.env',cwd)),false);assert.equal(fs.existsSync(new URL('backend/.env',cwd)),false);
 const requests=[],mock=http.createServer((req,res)=>{requests.push(req.url);res.setHeader('content-type','application/json');if(req.url==='/rest/v1/rpc/rpc_worker_claim_v1')res.end('false');else{res.statusCode=500;res.end('{"error":"Unexpected synthetic service call"}');}});
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const env={};for(const k of ['SystemRoot','WINDIR','TEMP','TMP','PATH','PATHEXT','ComSpec','OS','USERPROFILE','LOCALAPPDATA','APPDATA'])if(process.env[k])env[k]=process.env[k];
 Object.assign(env,{PORT:String(port),NODE_ENV:'test',READ_ONLY_UAT_MODE:'false',SUPABASE_URL:`http://127.0.0.1:${mock.address().port}`,SUPABASE_ANON_KEY:'synthetic-anon-key',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',EMAIL_USER:'',EMAIL_PASS:'',END_DAY_KM_AUTO_RECALC_ENABLED:'true',KM_SHARED_RECONCILIATION_ENABLED:'true',FO_GPS_EVIDENCE_REFRESH_ENABLED:'true'});
 const output=[],child=spawn(process.execPath,['server.js'],{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>output.push(b.toString()));child.stderr.on('data',b=>output.push(b.toString()));
 try{
  let ready=false;for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Synthetic startup failed: '+output.join('').slice(-1600));try{if((await fetch(`http://127.0.0.1:${port}/ready`)).status===200){ready=true;break;}}catch{ /* Local startup not listening yet. */ }await new Promise(r=>setTimeout(r,50));}
  assert.equal(ready,true,'Normal HTTP startup must not await worker ownership');
  const base=`http://127.0.0.1:${port}`;assert.equal((await fetch(base+'/health')).status,200);
  for(const path of ['/api/pre-sales/leads','/api/fo/km/recalculate','/api/fo/site-visits/validate-checkin-location']){
   const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(response.status,401,path+' retains authentication, not global maintenance');
  }
  assert.equal((await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,404,'Existing disabled demo-auth behavior is retained');
  for(let i=0;i<30&&requests.length<3;i++)await new Promise(r=>setTimeout(r,20));
  assert.ok(requests.length>=3,'Startup background claims were exercised');assert.ok(requests.every(p=>p==='/rest/v1/rpc/rpc_worker_claim_v1'),JSON.stringify(requests));
  assert.doesNotMatch(output.join(''),/READ_ONLY_UAT_MODE enabled/);
 }finally{if(child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}mock.closeAllConnections();await new Promise(r=>mock.close(r));}
});
