import fs from 'node:fs';import {createHash} from 'node:crypto';
const root=new URL('../../',import.meta.url),out=new URL('supabase/proposals/retail_operational_activation/',root),read=p=>fs.readFileSync(new URL(p,root),'utf8').replaceAll('\r\n','\n'),md5=s=>createHash('md5').update(s).digest('hex'),quote=s=>"'"+s.replaceAll("'","''")+"'";
const strip=s=>{const start=s.indexOf('\nbegin;\n'),end=s.lastIndexOf('\ncommit;');if(start<0||end<start)throw Error('Expected one outer proposal transaction');return s.slice(start+8,end);};
const source=strip(read('supabase/proposals/retail_service_trackers.sql'))+'\n'+strip(read('supabase/proposals/retail_zone_mapping_drafts.sql'))+'\n',hash=md5(source),version='20261030140000',baseHash=read('supabase/verification/retail_unified_source_digest.txt').trim();
const functions=[...source.matchAll(/create function public\.(\w+)\(([^)]*)\) returns[\s\S]*?as \$\$([\s\S]*?)\$\$;/g)].map(m=>({signature:'public.'+m[1]+'('+m[2].split(',').filter(Boolean).map(a=>a.trim().split(/\s+/).slice(1).join(' ')).join(',')+')',body_md5:md5(m[3]),rpc:m[1].startsWith('rpc_')}));if(functions.length!==8)throw Error('Unexpected function manifest size: '+functions.length);
const newTables=['retail_service_orders','retail_service_events','retail_service_order_stores','retail_zone_mapping_drafts'];
const protectedTables=['reliance_retail_store_master','reliance_retail_zones','reliance_retail_zone_fo_assignments','reliance_retail_store_zone_history','retail_employee_daily_attendance','retail_attendance_uploads','retail_attendance_aop_versions','retail_store_import_approvals','retail_store_import_batches','retail_store_import_events','retail_provisional_rows','retail_provisional_files','retail_provisional_events','retail_provisional_proposals','retail_provisional_access','client_deep_cleaning_submissions','client_deep_cleaning_uploads','client_deep_cleaning_schedules','training_sessions','training_evidence','training_events','profiles'];
const array=items=>'array['+items.map(quote).join(',')+']';
const required={profiles:{id:'uuid',state:'text',is_active:'boolean',status:'text'},reliance_retail_store_master:{id:'uuid',store_code:'text',state:'text',status:'text'},reliance_retail_zones:{id:'uuid',state:'text',status:'text'},retail_provisional_rows:{id:'uuid',batch_id:'uuid',source_state:'text',revision:'integer',row_digest:'text',store_code:'text'},retail_provisional_files:{id:'uuid',withdrawn_at:'timestamp with time zone'},reliance_retail_management_audit:{action:'text',entity_type:'text',entity_id:'uuid',actor_profile_id:'uuid',after_state:'jsonb'}};
required.profiles.role='text';required.profiles.business='text';
const requiredSQL=Object.entries(required).flatMap(([table,columns])=>Object.entries(columns).map(([column,type])=>`(${quote(table)},${quote(column)},${quote(type)})`)).join(',\n');
const contracts={retail_service_orders:{id:'uuid',kind:'text',reference:'text',state:'text',store_ids:'uuid[]',status:'text',revision:'integer',rework_count:'integer',details:'jsonb',created_by:'uuid',created_at:'timestamp with time zone',updated_at:'timestamp with time zone'},retail_service_events:{id:'uuid',order_id:'uuid',request_id:'uuid',actor_id:'uuid',action:'text',before_value:'jsonb?',after_value:'jsonb',evidence:'jsonb',created_at:'timestamp with time zone'},retail_service_order_stores:{order_id:'uuid',retail_store_id:'uuid'},retail_zone_mapping_drafts:{id:'uuid',row_id:'uuid',row_revision:'integer',row_digest:'text',state:'text',zone_id:'uuid?',effective_from:'text',effective_to:'timestamp with time zone?',reason:'text',proposed_by:'uuid',created_at:'timestamp with time zone',status:'text',fingerprint:'text'}};
contracts.retail_service_orders.assigned_profile_id='uuid?';
const columns=Object.entries(contracts).flatMap(([table,cols])=>Object.entries(cols).map(([column,type])=>({table,column,type:type.replace('?',''),not_null:!type.endsWith('?')})));
const prerequisites=`if to_regclass('supabase_migrations.schema_migrations') is null then raise exception 'Installed migration history required';end if;
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261029140000' and cardinality(statements)=1 and md5(replace(statements[1],E'\\r\\n',E'\\n'))='${baseHash}') then raise exception 'Installed Unified migration fingerprint mismatch; do not rerun it';end if;
 if to_regprocedure('public.retail_unified_access(uuid,text,text)') is null or to_regprocedure('public.retail_unified_owner(uuid,timestamp with time zone)') is null then raise exception 'Installed access and effective ownership functions required';end if;
 for item in select * from (values ${requiredSQL}) v(table_name,column_name,column_type) loop
  if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.'||item.table_name) and attname=item.column_name and (atttypid=to_regtype(item.column_type) or item.column_type='text' and atttypid in ('varchar'::regtype,'bpchar'::regtype)) and not attisdropped) then raise exception 'Incompatible required column %.%',item.table_name,item.column_name;end if;
 end loop;
 if exists(select 1 from public.reliance_retail_zones where state is null or state not in ('TN','PY','KA','KL','TG','AP-1','AP-2')) then raise exception 'Existing undefined Zone state requires explicit review';end if;`;
const verify=`for item in select * from jsonb_to_recordset(${quote(JSON.stringify(columns))}::jsonb) as c("table" text,"column" text,"type" text,not_null boolean) loop
  if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.'||item."table") and attname=item."column" and atttypid=to_regtype(item."type") and attnotnull=item.not_null and not attisdropped) then raise exception 'Target column drift: %.%',item."table",item."column";end if;
 end loop;
 for item in select * from jsonb_to_recordset(${quote(JSON.stringify(functions))}::jsonb) as f(signature text,body_md5 text,rpc boolean) loop
  if not exists(select 1 from pg_proc where oid=to_regprocedure(item.signature) and prosecdef=item.rpc and md5(replace(prosrc,E'\\r\\n',E'\\n'))=item.body_md5 and exists(select 1 from unnest(proconfig) cfg where regexp_replace(cfg,'[[:space:]]','','g')='search_path=pg_catalog,public')) then raise exception 'Installed function drift: %',item.signature;end if;
  if has_function_privilege('anon',item.signature,'EXECUTE') or has_function_privilege('authenticated',item.signature,'EXECUTE') or has_function_privilege('service_role',item.signature,'EXECUTE') is distinct from item.rpc then raise exception 'RPC/helper privilege mismatch: %',item.signature;end if;
 end loop;
 foreach relation_name in array ${array(newTables)} loop
  if not exists(select 1 from pg_class where oid=to_regclass('public.'||relation_name) and relrowsecurity) then raise exception 'RLS/table missing: %',relation_name;end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(role_name,'public.'||relation_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Direct table privilege detected: % %',relation_name,role_name;end if;
  end loop;
 end loop;
 if not exists(select 1 from pg_constraint where conrelid='public.retail_service_order_stores'::regclass and confrelid='public.reliance_retail_store_master'::regclass and contype='f' and confdeltype='r') then raise exception 'Canonical Store foreign key protection missing';end if;
 if not exists(select 1 from pg_constraint where conname='retail_zones_defined_state' and conrelid='public.reliance_retail_zones'::regclass) then raise exception 'Defined Zone state constraint missing';end if;`;
const capture=(stage)=>`foreach relation_name in array ${array(protectedTables)} loop
  if to_regclass('public.'||relation_name) is not null then
   execute format('lock table public.%I in share mode',relation_name);
   execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb)::text) from public.%I x',relation_name) into row_count,row_digest;
   ${stage==='before'?"insert into retail_activation_protected values(relation_name,row_count,row_digest);":"if not exists(select 1 from retail_activation_protected where name=relation_name and rows=row_count and digest=row_digest) then raise exception 'Protected data changed: %',relation_name;end if;"}
  end if;
 end loop;`;
const countsSQL=`select name,(xpath('/table/row/n/text()',report))[1]::text::bigint as row_count,(xpath('/table/row/digest/text()',report))[1]::text as digest
 from unnest(${array(protectedTables)}) name cross join lateral (select case when to_regclass('public.'||name) is not null then query_to_xml(format('select count(*) as n,md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb)::text) as digest from public.%I x',name),false,false,'') end as report) q where to_regclass('public.'||name) is not null;`;
const preflight=`-- READ ONLY. Save output. Do not rerun installed migrations.\nbegin transaction read only;
do $preflight$ declare item record;begin ${prerequisites} end;$preflight$;
select version,name,cardinality(statements)=1 as one_statement,md5(replace(statements[1],E'\\r\\n',E'\\n')) as source_md5 from supabase_migrations.schema_migrations where version in ('20261029140000','${version}') order by version;
select name,to_regclass('public.'||name) as existing_object from unnest(${array(newTables)}) name;
${countsSQL}
select p.oid::regprocedure,md5(replace(p.prosrc,E'\\r\\n',E'\\n')) as body_md5,p.prosecdef,p.proconfig,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'rpc_retail_unified_%' or p.proname in ('retail_unified_access','retail_unified_owner','rpc_confirm_retail_store_import','rpc_confirm_retail_bulk_identity')) order by p.proname;
rollback;\n`;
const install=`-- NEW activation package only. Explicit owner authorization required.
-- Atomic installation, source/history guards, fail-closed replay and protected data checks.
begin;
set local lock_timeout='5s';set local statement_timeout='90s';
do $install$
declare source text:=$retail_source$${source}$retail_source$;item record;relation_name text;role_name text;row_count bigint;row_digest text;prior_digest text;after_digest text;prior_acl text;after_acl text;old_oids oid[];old_relation_oids oid[];
begin
 perform pg_advisory_xact_lock(hashtextextended('retail_unified_ownership',0));
 perform pg_advisory_xact_lock(hashtextextended('retail_uploaded_attendance',0));
 perform pg_advisory_xact_lock(hashtextextended('retail_operational_activation_install',0));
 source:=replace(source,E'\\r\\n',E'\\n');if md5(source)<>'${hash}' then raise exception 'Activation source fingerprint mismatch';end if;
 ${prerequisites}
 if exists(select 1 from supabase_migrations.schema_migrations where version='${version}') then
  if not exists(select 1 from supabase_migrations.schema_migrations where version='${version}' and name='retail_operational_activation' and cardinality(statements)=1 and md5(replace(statements[1],E'\\r\\n',E'\\n'))='${hash}') then raise exception 'Activation migration history drift';end if;
  ${verify}
  raise notice 'Activation package already installed exactly; no writes performed';return;
 end if;
 foreach relation_name in array ${array(newTables)} loop if to_regclass('public.'||relation_name) is not null then raise exception 'Unrecorded/partial existing object: %. Stop and reconcile; nothing overwritten',relation_name;end if;end loop;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'rpc_retail_service_%' or p.proname like 'retail_service_%' or p.proname like 'rpc_retail_zone_draft%' or p.proname='retail_zone_draft_immutable')) then raise exception 'Unrecorded target function exists; review before installation';end if;
 create temporary table retail_activation_protected(name text primary key,rows bigint,digest text) on commit drop;
 ${capture('before')}
 select array_agg(p.oid order by p.oid),md5(string_agg(pg_get_functiondef(p.oid)||p.proowner::text||coalesce(p.proacl::text,''),E'\\n' order by p.oid)) into old_oids,prior_digest from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f';
 select array_agg(c.oid order by c.oid),md5(string_agg(c.oid::text||c.relrowsecurity::text||c.relforcerowsecurity::text||coalesce(c.relacl::text,''),E'\\n' order by c.oid)) into old_relation_oids,prior_acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public';
 execute source;
 ${capture('after')}
 select md5(string_agg(pg_get_functiondef(p.oid)||p.proowner::text||coalesce(p.proacl::text,''),E'\\n' order by p.oid)) into after_digest from pg_proc p where p.oid=any(old_oids);
 if after_digest is distinct from prior_digest then raise exception 'Existing function definition/ACL changed; rolling back';end if;
 -- Compare existing relation security, excluding newly-created objects/indexes.
 select md5(string_agg(c.oid::text||c.relrowsecurity::text||c.relforcerowsecurity::text||coalesce(c.relacl::text,''),E'\\n' order by c.oid)) into after_acl from pg_class c where c.oid=any(old_relation_oids);
 if after_acl is distinct from prior_acl then raise exception 'Existing relation security changed; rolling back';end if;
 ${verify}
 insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','retail_operational_activation',array[source]);
 perform pg_notify('pgrst','reload schema');
 raise notice 'Installed activation package ${version}; protected data and existing security unchanged';
end;$install$;
commit;\n`;
const post=`-- READ ONLY. Run after the new installer; retain output with preflight.\nbegin transaction read only;
select version,name,cardinality(statements)=1 as one_statement,md5(replace(statements[1],E'\\r\\n',E'\\n'))='${hash}' as source_exact_match from supabase_migrations.schema_migrations where version='${version}';
do $verify$ declare item record;relation_name text;role_name text;begin ${verify} end;$verify$;
${newTables.map(name=>`select ${quote(name)} as relation,count(*) from public.${name};`).join('\n')}
-- Initial counts should be zero; subsequent authenticated use may create records.
${countsSQL}
rollback;\n`;
const quarantine=`-- Requires separate authorization. Keeps orders, links, drafts and audit evidence.
begin;
${functions.filter(f=>f.rpc).map(f=>`revoke all on function ${f.signature} from public,anon,authenticated,service_role;`).join('\n')}
commit;\n`;
fs.mkdirSync(out,{recursive:true});for(const [name,content] of Object.entries({'01_PREFLIGHT_READ_ONLY.sql':preflight,'02_INSTALL_AND_RECORD.sql':install,'03_POSTINSTALL_READ_ONLY.sql':post,'04_QUARANTINE.sql':quarantine,'manifest.json':JSON.stringify({version,source_md5:hash,base_unified_md5:baseHash,tables:newTables,functions},null,2)+'\n'}))fs.writeFileSync(new URL(name,out),content);
console.log(JSON.stringify({version,source_md5:hash,functions:functions.length,tables:newTables.length}));
