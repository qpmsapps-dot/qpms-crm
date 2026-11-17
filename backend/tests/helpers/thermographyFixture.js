// Isolated fixture: PGlite by default, or an explicitly supplied disposable native
// PostgreSQL adapter. No environment files, production clients or external DBs.
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
export const thermoMigration=new URL('../../../supabase/migrations/20261115140000_retail_thermography_reports.sql',import.meta.url);
export async function thermoFixture({db=new PGlite()}={}){
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema storage;
 create table public.profiles(id uuid primary key,auth_user_id uuid,employee_code text,full_name text,role text,designation text,department text,business text,is_active boolean,status text);
 create table public.retail_mis_assignments(profile_id uuid,auth_user_id uuid,employee_code text,role text,states text[],active boolean);
 create table public.reliance_retail_store_master(id uuid primary key,store_code text unique not null,store_name text not null,state text not null,status text default 'Active',store_format text,city text);
 create table public.reliance_retail_management_audit(id uuid primary key default gen_random_uuid(),action text,entity_type text,entity_id uuid,actor_profile_id uuid,created_at timestamptz default now(),before_state jsonb,after_state jsonb);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
 alter table storage.objects enable row level security;
 create function public.retail_unified_access(p_actor uuid,p_state text,p_action text) returns boolean language sql as $$select true$$;`);
 await db.exec(readFileSync(new URL('../../../supabase/proposals/retail_operations_workflows.sql',import.meta.url),'utf8'));
 const mis=readFileSync(new URL('../../../supabase/migrations/20261102071258_retail_mis_four_roles.sql',import.meta.url),'utf8');
 for(const name of ['retail_mis_super','retail_mis_allowed','retail_mis_unique_store','rpc_retail_mis_report']){
  const match=mis.match(new RegExp('create function public\\.'+name+'\\([\\s\\S]*?\\$\\$;'));if(!match)throw Error('Missing source prerequisite '+name);await db.exec(match[0]);
 }
 const originalMisReport=(await db.query(`select prosrc from pg_proc where oid='public.rpc_retail_mis_report(uuid,text,date,date,text)'::regprocedure`)).rows[0].prosrc;
 await db.exec(readFileSync(thermoMigration,'utf8'));
 const ids=Object.fromEntries(['mepc','other','hk','central','admin','store','otherStore'].map(k=>[k,randomUUID()]));
 for(const [key,role,states] of [['mepc','MIS_MEPC',['TN']],['other','MIS_MEPC',['KA']],['hk','MIS_HK',['TN']],['central','CENTRAL_MIS',[]],['admin','Super Admin',[]]]){
  await db.query(`insert into profiles values($1,$1,$2,$2,$3,null,null,'Reliance Retail',true,'Active')`,[ids[key],'SYNTHETIC '+key,role]);
  if(key!=='admin')await db.query(`insert into retail_mis_assignments values($1,$1,$2,$3,$4,true)`,[ids[key],'SYNTHETIC '+key,role,states]);
 }
 await db.query(`insert into reliance_retail_store_master(id,store_code,store_name,state) values($1,'0012','SYNTHETIC TN STORE','TN'),($2,'0099','SYNTHETIC KA STORE','KA')`,[ids.store,ids.otherStore]);
 const today=(await db.query(`select retail_operations_today()::text as business_date`)).rows[0].business_date;
 const call=async(actor,action,data={})=>(await db.query(`select rpc_retail_thermography_reports($1,$2,$3::jsonb) result`,[actor,action,JSON.stringify(data)])).rows[0].result;
 const prepare=(data={},actor=ids.mepc)=>call(actor,'prepare',{request_id:randomUUID(),store_id:ids.store,date:today,filename:'SYNTHETIC.xlsx',size:100,source_sha256:'a'.repeat(64),...data});
 const object=async v=>(await db.query(`insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3::jsonb) returning id`,[v.bucket,v.object_path,JSON.stringify({size:Number(v.file_size),mimetype:v.mime_type})])).rows[0].id;
 const finalize=async v=>{const object_id=await object(v);return call(ids.mepc,'finalize',{request_id:v.operation_id,sha256:'a'.repeat(64),object_id});};
 const row=async id=>(await db.query('select * from retail_thermography_inspections where id=$1',[id])).rows[0];
 return {db,ids,today,call,prepare,object,finalize,row,originalMisReport};
}
