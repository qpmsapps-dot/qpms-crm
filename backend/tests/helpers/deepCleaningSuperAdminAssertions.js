import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export async function verifySuperAdminImport(pg){
 const proposal=readFileSync(new URL('../../../supabase/proposals/retail_cleaning_superadmin_import_20261119.sql',import.meta.url),'utf8');
 const recovery=readFileSync(new URL('../../../supabase/proposals/retail_cleaning_superadmin_import_recovery_20261119.sql',import.meta.url),'utf8');
 const fingerprints=async()=>(await pg.db.query("select proname,proacl::text acl,md5(replace(pg_get_functiondef(oid),E'\\r\\n',E'\\n')) hash from pg_proc where oid in ('qpms_cleaning_plan.validate_row(uuid,jsonb)'::regprocedure,'public.rpc_retail_cleaning_plan_v1(uuid,uuid,text,jsonb)'::regprocedure) order by proname")).rows;
 const before=await fingerprints();
 // Match production's service-only RPC ACL; fixture helpers remain synthetic.
 await pg.db.exec('revoke all on function public.rpc_retail_cleaning_plan_v1(uuid,uuid,text,jsonb) from public;grant execute on function public.rpc_retail_cleaning_plan_v1(uuid,uuid,text,jsonb) to service_role');
 const aclBefore=await fingerprints();
 await pg.db.exec("alter table profiles add column metadata jsonb default '{}'");
 await pg.db.exec(`insert into profiles(id,employee_code,is_active,status,auth_user_id,role,business,state) values
 ('${id(7000)}','SYNTHETIC-SUPER',true,'ACTIVE','${id(7100)}','SUPER_ADMIN','Platform','TN'),
 ('${id(7001)}','SYNTHETIC-ADMIN',true,'ACTIVE','${id(7101)}','Admin','Reliance Retail','TN'),
 ('${id(7002)}','SYNTHETIC-HK',true,'ACTIVE','${id(7102)}','MIS_HK','Reliance Retail','TN'),
 ('d40c2b3f-87f1-4c34-8798-cf9b0d9ca784','QPMSADMIN',true,'ACTIVE','79cd196c-c6f3-404a-b22a-d4683afefa3f','Admin','Platform','TN')`);
 const command=(session,action,data,actor=id(7000),auth=id(7100))=>session.query('select rpc_retail_cleaning_plan_v1($1,$2,$3,$4) result',[actor,auth,action,data]);
 const cap=(actor=id(7000),auth=id(7100))=>pg.db.query('select rpc_retail_cleaning_schedule_admin_access_v1($1,$2) allowed',[actor,auth]);
 const row={STATE:'AP-1',STORE_CODE:'AP-1',SCHEDULE_DATE:'2026-11-28'};
 await assert.rejects(command(pg.admin,'preview',{month:'2026-11',rows:[row]}),/Active Cleaning MIS assignment/);
 await pg.db.exec(proposal);await pg.db.exec(proposal);
 assert.deepEqual((await fingerprints()).map(r=>r.acl),aclBefore.map(r=>r.acl),'Existing function ACLs preserved');
 assert.equal((await cap()).rows[0].allowed,true);
 assert.equal((await cap(id(7000),id(7999))).rows[0].allowed,false);
 assert.equal((await cap(id(7001),id(7101))).rows[0].allowed,false,'Unrelated Admin is not promoted');
 assert.equal((await cap(id(7002),id(7102))).rows[0].allowed,false);
 assert.equal((await cap('d40c2b3f-87f1-4c34-8798-cf9b0d9ca784','79cd196c-c6f3-404a-b22a-d4683afefa3f')).rows[0].allowed,true);
 for(const role of ['Super Admin','super_admin','SUPERADMIN']){
  await pg.db.query('update profiles set role=$1 where id=$2',[role,id(7000)]);assert.equal((await cap()).rows[0].allowed,true);
 }
 await pg.db.query('update profiles set metadata=$1 where id=$2',[{read_only:true},id(7000)]);
 assert.equal((await cap()).rows[0].allowed,false);
 await pg.db.query("update profiles set metadata='{}',is_active=false where id=$1",[id(7000)]);
 assert.equal((await cap()).rows[0].allowed,false);
 await pg.db.query('update profiles set is_active=true where id=$1',[id(7000)]);
 const many=[];
 for(let n=0;n<208;n++){
  const state=['AP-1','AP-2','KL','TG'][n%4],code='SUPER-'+n;
  await pg.db.query('insert into reliance_retail_store_master values($1,$2,$3,\'Active\')',[id(8000+n),code,state]);
  many.push({STATE:state,STORE_CODE:code,SCHEDULE_DATE:'2026-11-28'});
 }
 const payload={month:'2026-11',rows:many,request_id:id(7500)},a=await pg.connect(true),b=await pg.connect(true);
 const started=performance.now();
 assert.equal((await command(a,'preview',payload)).rows[0].result.valid,208);
 await assert.rejects(command(a,'import',{...payload,rows:[many[0],{...many[1],STATE:'TN'}]}),/no rows imported/);
 const results=await Promise.all([command(a,'import',payload),command(b,'import',payload)]);
 assert.deepEqual(results.map(r=>r.rows[0].result.replayed).sort(),[false,true]);
 assert.equal(results[0].rows[0].result.receipts.length,208);
 assert.ok(performance.now()-started<8000,'208-row preview and concurrent idempotent import must remain under 8 seconds');
 console.log('Native PostgreSQL 17: Super Admin 208-row preview + concurrent import ms:',Math.round(performance.now()-started));
 assert.equal((await pg.db.query("select count(*)::int n from reliance_retail_management_audit where actor_profile_id=$1 and action='CLEANING_MONTHLY_ROW'",[id(7000)])).rows[0].n,208);
 for(const invalid of [{...row,STORE_CODE:'UNKNOWN'},{...row,STATE:'AP-2'},{...row,SCHEDULE_DATE:'2026-11-99'},{...row,FO_EMPLOYEE_CODE:'UNKNOWN'}])assert.equal((await command(a,'preview',{month:'2026-11',rows:[invalid]})).rows[0].result.invalid,1);
 await assert.rejects(command(a,'import',{...payload,request_id:id(7501)}),/no rows imported/);
 await assert.rejects(command(a,'preview',payload,id(7000),id(7999)),/Verified actor/);
 await assert.rejects(command(a,'preview',payload,id(7002),id(7102)),/Active Cleaning MIS assignment/);
 for(const action of ['correct','approve'])await assert.rejects(command(a,action,payload),/Active Cleaning MIS assignment/);
 const acl=(await pg.db.query("select has_function_privilege('anon','public.rpc_retail_cleaning_schedule_admin_access_v1(uuid,uuid)','EXECUTE') anon,has_function_privilege('authenticated','public.rpc_retail_cleaning_schedule_admin_access_v1(uuid,uuid)','EXECUTE') authenticated,has_function_privilege('service_role','qpms_cleaning_plan.monthly_admin_access_v1(uuid)','EXECUTE') private")).rows[0];
 assert.deepEqual(acl,{anon:false,authenticated:false,private:false});
 await pg.db.exec('update qpms_release.test_admission set allowed=false');
 await assert.rejects(command(a,'import',{...payload,request_id:id(7502)}),/mutation fence closed/);
 await pg.db.exec('update qpms_release.test_admission set allowed=true');
 const count=(await pg.db.query('select count(*)::int n from client_deep_cleaning_schedules')).rows[0].n;
 await pg.db.exec(recovery);await pg.db.exec(recovery);
 assert.equal((await pg.db.query('select count(*)::int n from client_deep_cleaning_schedules')).rows[0].n,count);
 assert.deepEqual((await fingerprints()).map(r=>r.hash),before.map(r=>r.hash));
 await assert.rejects(command(pg.admin,'preview',payload),/Active Cleaning MIS assignment/);
 await pg.db.exec(proposal);
 const helper=(await pg.db.query("select pg_get_functiondef('qpms_cleaning_plan.monthly_admin_access_v1(uuid)'::regprocedure) definition")).rows[0].definition;
 await pg.db.exec(helper.replace("='SUPERADMIN'","='UNREVIEWED'"));
 await assert.rejects(pg.db.exec(proposal),/helper drift/);
 await pg.db.exec('rollback');
 await assert.rejects(pg.db.exec(recovery),/helper drift/);
 await pg.db.exec('rollback');
 await pg.db.exec(helper);await pg.db.exec(recovery);
}
