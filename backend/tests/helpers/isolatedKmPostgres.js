import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';

export function isolatedKmPostgres() {
  const run=(args,input)=>{const r=spawnSync('docker',args,{input,encoding:'utf8',timeout:60000,maxBuffer:32e6,windowsHide:true});if(r.status!==0)throw Error(r.stderr||r.error?.message||'Docker failed');return r.stdout.trim();};
  const container=run(['run','-d','--name','km-automation-test-'+crypto.randomBytes(5).toString('hex'),'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=test','postgres:17']);
  const sql=(body,service=false)=>run(['exec','-i',container,'psql','-X','-qAt','-U',service?'authenticator':'postgres','-d','test','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],(service?"set role service_role;set request.jwt.claim.role='service_role';":'')+body);
  const json=(body,service=false)=>JSON.parse(sql(body,service));
  const q=v=>v==null?'null':"'"+String(v).replaceAll("'","''")+"'";
  const id=v=>{assert.match(v,/^[a-z_][a-z0-9_]*$/);return '"'+v+'"';};
  class Query {
    constructor(table){this.table=id(table);this.where=[];this.sort=[];}
    select(){return this;}filter(k,op,v){this.where.push(id(k)+' '+op+' '+q(v));return this;}
    eq(k,v){return this.filter(k,'=',v);}neq(k,v){return this.filter(k,'<>',v);}gte(k,v){return this.filter(k,'>=',v);}gt(k,v){return this.filter(k,'>',v);}lte(k,v){return this.filter(k,'<=',v);}lt(k,v){return this.filter(k,'<',v);}ilike(k,v){return this.filter(k,'ilike',v);}
    in(k,v){this.where.push(id(k)+' in ('+v.map(q).join(',')+')');return this;}
    is(k,v){assert.equal(v,null);this.where.push(id(k)+' is null');return this;}
    or(expression){const parts=expression.split(/,(?![^()]*\))/).map(p=>{const m=p.match(/^([a-z_]+)\.(eq|in)\.(.*)$/);assert.ok(m,p);return m[2]==='eq'?id(m[1])+'='+q(m[3]):id(m[1])+' in ('+m[3].slice(1,-1).split(',').map(q).join(',')+')';});this.where.push('('+parts.join(' or ')+')');return this;}
    order(k,o={}){this.sort.push(id(k)+(o.ascending===false?' desc':' asc'));return this;}
    range(a,b){this.offset=a;this.take=b-a+1;return this;}limit(n){this.take=n;return this;}single(){this.one=true;return this;}maybeSingle(){return this.single();}
    then(resolve,reject){try{const rows=json(`select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select * from public.${this.table} where ${this.where.join(' and ')||'true'} ${this.sort.length?'order by '+this.sort.join(','):''} ${this.take!=null?'limit '+this.take:''} ${this.offset?'offset '+this.offset:''}) r`,true);return Promise.resolve({data:this.one?rows[0]||null:rows,error:null}).then(resolve,reject);}catch(e){return Promise.resolve({data:null,error:{message:e.message,code:e.message.match(/ERROR:\s+(\w{5}):/)?.[1]||'LOCAL_SQL_ERROR'}}).then(resolve,reject);}}
  }
  const client={from:table=>new Query(table),async rpc(name,parameters={}){id(name);try{const args=Object.entries(parameters).map(([k,v])=>id(k)+' => '+(typeof v==='object'&&v!==null?q(JSON.stringify(v))+'::jsonb':typeof v==='boolean'?String(v):q(v)));if(name==='rpc_finish_fo_km_reconciliation_v1'){sql(`select public.${name}(${args.join(',')})`,true);return{data:null,error:null};}return{data:json(`select coalesce(to_jsonb(public.${name}(${args.join(',')})),'null'::jsonb)`,true),error:null};}catch(e){return{data:null,error:{message:e.message,code:e.message.match(/ERROR:\s+(\w{5}):/)?.[1]||'LOCAL_SQL_ERROR'}};}}};
  return {sql,json,client,q,container,async ready(){for(let i=0;i<50;i++){try{sql('select 1');return;}catch(e){if(i===49)throw e;await new Promise(r=>setTimeout(r,200));}}},close(){run(['rm','-f',container]);}};
}
