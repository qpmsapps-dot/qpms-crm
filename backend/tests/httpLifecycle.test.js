import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import express from 'express';
import {createHttpLifecycle} from '../services/httpLifecycle.js';

function response(){return {headers:{},set(k,v){this.headers[k]=v;return this;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;}};}
const logger={info(){},error(){}};

test('readiness checks listening/configuration and exposes only non-secret freeze/deployment evidence',async()=>{
 const signals=new EventEmitter(),environment={RETAIL_OOS_MUTATIONS_FROZEN:'true',RAILWAY_DEPLOYMENT_ID:'deployment',RAILWAY_REPLICA_ID:'replica',RAILWAY_GIT_COMMIT_SHA:'commit',SECRET:'never exposed'};
 let configured=false;const lifecycle=createHttpLifecycle({isReady:()=>configured,environment,signals,logger}),app=express();app.get('/ready',lifecycle.readiness);
 const before=response();lifecycle.readiness({},before);assert.equal(before.statusCode,503);
 const server=app.listen(0,'127.0.0.1');lifecycle.attach(server);await once(server,'listening');
 try{
  const url=`http://127.0.0.1:${server.address().port}/ready`;assert.equal((await fetch(url)).status,503);configured=true;
  const ready=await fetch(url);assert.equal(ready.status,200);assert.equal(ready.headers.get('cache-control'),'no-store');
  assert.deepEqual(await ready.json(),{ok:true,draining:false,oos_mutations_frozen:true,deployment_id:'deployment',replica_id:'replica',commit_sha:'commit'});
 }finally{signals.removeAllListeners();await new Promise(r=>server.close(r));}
});

test('SIGTERM stops admission, marks readiness unavailable and lets an active HTTP request finish before exit',async()=>{
 const signals=new EventEmitter(),exits=[];let finish,entered;const started=new Promise(r=>entered=r),exited=new Promise(resolve=>{
  signals.on('exited',resolve);
 });
 const lifecycle=createHttpLifecycle({isReady:()=>true,signals,logger,exit:code=>{exits.push(code);signals.emit('exited');}}),app=express();
 app.get('/slow',(req,res)=>{finish=()=>res.end('completed');entered();});
 const server=app.listen(0,'127.0.0.1');lifecycle.attach(server);await once(server,'listening');
 try{
  const request=fetch(`http://127.0.0.1:${server.address().port}/slow`);await started;signals.emit('SIGTERM');
  const state=response();lifecycle.readiness({},state);assert.equal(state.statusCode,503);assert.equal(state.body.draining,true);
  assert.equal(server.listening,false);assert.deepEqual(exits,[]);finish();assert.equal(await (await request).text(),'completed');await exited;assert.deepEqual(exits,[0]);
 }finally{signals.removeAllListeners();await new Promise(r=>server.close(r));}
});

test('shutdown has a bounded deadline for a request that never finishes',async()=>{
 const signals=new EventEmitter();let entered;const started=new Promise(r=>entered=r);let stopped;
 const exited=new Promise(r=>stopped=r),lifecycle=createHttpLifecycle({isReady:()=>true,signals,logger,shutdownTimeoutMs:50,exit:stopped}),app=express();
 app.get('/stuck',()=>entered());const server=app.listen(0,'127.0.0.1');lifecycle.attach(server);await once(server,'listening');
 try{
  const request=fetch(`http://127.0.0.1:${server.address().port}/stuck`).catch(()=>null);await started;signals.emit('SIGTERM');
  assert.equal(await exited,1);await request;
 }finally{signals.removeAllListeners();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
