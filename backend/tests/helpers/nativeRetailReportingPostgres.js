// Disposable loopback PostgreSQL. No environment files or external connections.
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,openSync,closeSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createServer} from 'node:net';
import os from 'node:os';
export async function nativeRetailReportingPostgres(){
 const tools=process.env.RETAIL_REPORTING_TEST_TOOLS_DIR||'D:/QPMS_CRM/tmp/retail-mis-test-tools';
 const {Client}=createRequire(resolve(tools,'package.json'))('pg');
 const bin=process.env.RETAIL_REPORTING_TEST_PG_BIN||resolve(tools,'node_modules/@embedded-postgres/windows-x64/native/bin');
 const runtime=resolve(process.env.RETAIL_REPORTING_NATIVE_OUTPUT_DIR||(process.platform==='win32'?'D:/QPMS_CRM/artifacts/retail-reporting-validation-20261117':os.tmpdir()),'retail-reporting-native-'+Date.now()),data=resolve(runtime,'pgdata');mkdirSync(runtime,{recursive:true});
 const windows=process.platform==='win32',executable=name=>resolve(bin,name+(windows?'.exe':''));
 const env=windows?{SystemRoot:process.env.SystemRoot||'C:/Windows',PATH:bin+';C:/Windows/System32',TEMP:runtime,TMP:runtime}:{PATH:bin+':/usr/bin:/bin',HOME:runtime,TMPDIR:runtime,LANG:'C'};
 const exec=(name,args)=>{const r=spawnSync(executable(name),args,{env,encoding:'utf8',windowsHide:true,timeout:30000});if(r.status!==0)throw Error(r.stderr||r.error?.message);};
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 exec('initdb',['-D',data,'--username=postgres','--auth=trust','--encoding=UTF8','--no-locale']);
 // The fixture uses loopback TCP only; distribution socket directories may require postgres ownership.
 const logPath=resolve(runtime,'postgres.log'),log=openSync(logPath,'a');const server=spawn(executable('postgres'),['-D',data,'-h','127.0.0.1','-p',String(port),'-c','unix_socket_directories='],{env,windowsHide:true,stdio:['ignore',log,log]});closeSync(log);server.on('error',()=>{});
 const sessions=new Set();
 const connect=async(service=false)=>{const c=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres',password:'',ssl:false,connectionTimeoutMillis:1000});await c.connect();sessions.add(c);await c.query("set statement_timeout='8s';set lock_timeout='5s'");if(service)await c.query('set role service_role');return c;};
 let admin;
 try{for(let i=0;i<80;i++){try{admin=await connect();break;}catch(e){if(i===79)throw e;await new Promise(r=>setTimeout(r,100));}}}
 catch(e){let cleanup='';try{exec('pg_ctl',['-D',data,'-m','immediate','-w','stop']);}catch(stopError){cleanup='\nCleanup: '+stopError.message;}throw Error('Disposable PostgreSQL startup failed: '+e.message+'\n'+readFileSync(logPath,'utf8')+cleanup);}
 const db={exec:sql=>admin.query(sql),query:(sql,args)=>admin.query(sql,args),close:async()=>{}};
 return {db,admin,connect,runtime,async close(){await Promise.all([...sessions].map(c=>c.end().catch(()=>{})));exec('pg_ctl',['-D',data,'-m','fast','-w','stop']);}};
}
