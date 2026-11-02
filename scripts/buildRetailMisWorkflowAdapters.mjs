// Deterministic copies of reviewed legacy workflow bodies, with scoped authority.
// Existing installed functions are NEVER renamed/replaced by this generator.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replaceAll('\r\n','\n');
function body(file,name){const sql=read(file),re=new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`,'i'),m=sql.match(re);if(!m)throw Error('Missing reviewed function '+name);return m[0];}
function replace(sql,from,to){if(!sql.includes(from))throw Error('Reviewed workflow anchor changed: '+from);return sql.replaceAll(from,to);}
let ops=['rpc_retail_maintenance_complete','rpc_retail_thermography_command'].map(n=>body('supabase/proposals/retail_operations_workflows.sql',n).replaceAll(n,n.replace('rpc_retail_','retail_mis_')).replaceAll('public.retail_operations_access','public.retail_mis_operations_access')).join('\n');
ops=replace(ops,'not public.retail_mis_operations_access(p_actor,s.state,true)','(not public.retail_mis_unique_store(s.id) or not public.retail_mis_operations_access(p_actor,s.state,true))');
let fault=body('supabase/proposals/retail_fault_tracker_updates.sql','rpc_retail_fault_update').replaceAll('rpc_retail_fault_update','retail_mis_fault_update');
fault=replace(fault,"regexp_replace(upper(coalesce(p.role,'')),'[^A-Z0-9]','','g') not in ('ADMIN','QPMSADMIN','DEVELOPER','DEV','ITADMIN','MANAGEMENTITADMIN')","not public.retail_mis_allowed(p_actor,'fault',null,true)");
fault=replace(fault,' select * into e from public.fault_tracker_ticket_updates'," if not exists(select 1 from public.reliance_retail_store_master s where upper(btrim(s.store_code))=upper(btrim(t.store_code)) and public.retail_mis_allowed(p_actor,'fault',s.state,true)) then raise exception using errcode='42501',message='Outside assigned state';end if;\n select * into e from public.fault_tracker_ticket_updates");
let cleaning=['rpc_retail_cleaning_link_source','rpc_retail_cleaning_link_fo'].map(n=>body('supabase/proposals/retail_cleaning_fo_link.sql',n)).join('\n');
cleaning=cleaning.replaceAll('rpc_retail_cleaning_link_source','retail_mis_cleaning_link_source').replaceAll('rpc_retail_cleaning_link_fo','retail_mis_cleaning_link_fo').replaceAll('public.retail_unified_access','public.retail_mis_cleaning_access');
cleaning=replace(cleaning,"regexp_replace(upper(coalesce(p.role,'')),'[^A-Z0-9]','','g') not in ('ADMIN','QPMSADMIN')","not public.retail_mis_allowed(p_actor,'cleaning',null,true)");
let service=body('supabase/proposals/retail_service_trackers.sql','rpc_retail_service_command').replaceAll('rpc_retail_service_command','retail_mis_service_command').replaceAll('public.retail_unified_access','public.retail_mis_oos_access');
service=replace(service," if p_request is null",` if not public.retail_mis_oos_enabled() then raise exception using errcode='42501',message='MIS OOS writes require separate activation';end if;
 if p_action not in ('CREATE_OOS','REWORK','PO_RECORDED','COMMERCIALLY_CONFIRMED','FUND_RECORDED','PAYMENT_RECORDED','DELIVERED') then raise exception using errcode='42501',message='OOS actions only';end if;
 if p_order is not null and (not public.retail_mis_oos_order_allowed(p_actor,p_order,true) or exists(select 1 from public.retail_mis_oos_retirements where order_id=p_order)) then raise exception using errcode='42501',message='Order unavailable or retired';end if;
 if p_request is null`);
let importer=body('supabase/proposals/retail_service_trackers.sql','rpc_retail_service_import').replaceAll('rpc_retail_service_import','rpc_retail_mis_oos_import').replaceAll('public.rpc_retail_service_command','public.retail_mis_service_command');
// Advanced quotation changes must not bypass the independent financial reviewer.
service=replace(service,"if o.kind<>'OOS' or o.status<>'QUOTED' then raise exception 'Rework is allowed before PO only';end if;","if o.kind<>'OOS' then raise exception 'OOS quotation required';end if; if o.status<>'QUOTED' and (not public.retail_mis_oos_access(p_actor,o.state,'review') or o.created_by=p_actor) then raise exception using errcode='42501',message='Advanced rework requires independent authorized reviewer';end if;");
service=replace(service,"if p_action='COMMERCIALLY_CONFIRMED' and o.created_by=p_actor", "if p_action='COMMERCIALLY_CONFIRMED' and (o.created_by=p_actor or p_actor=(select author_event.actor_id from public.retail_service_events author_event where author_event.order_id=o.id and author_event.action in ('CREATE_OOS','REWORK') order by author_event.created_at desc,author_event.id desc limit 1))");
importer=replace(importer,"receipts jsonb:='[]';request uuid;","receipts jsonb:='[]';request uuid;o public.retail_service_orders%rowtype;");
importer=replace(importer," for g in select value from jsonb_array_elements(p_groups) loop",` perform pg_advisory_xact_lock(hashtextextended('retail_service_orders',0));
 for g in select value from jsonb_array_elements(p_groups) loop`);
importer=replace(importer,"  receipts:=receipts||jsonb_build_array(public.retail_mis_service_command(p_actor,request,'CREATE_OOS',null,null,jsonb_build_object('reference',g->>'quotation_number','store_ids',g->'store_ids','items',g->'items','filename',p_filename,'file_sha256',p_sha256,'original_base64',p_original)));",`  select * into o from public.retail_service_orders where kind='OOS' and reference=g->>'quotation_number' for update;
  if found then
   if not public.retail_mis_oos_order_allowed(p_actor,o.id,true) or exists(select 1 from public.retail_mis_oos_retirements where order_id=o.id) then raise exception using errcode='42501',message='Quotation outside assignment or retired';end if;
   if exists(select 1 from public.retail_service_events e where e.order_id=o.id and (e.evidence->>'file_sha256'=p_sha256 or e.evidence->>'quotation_file_sha256'=p_sha256)) then
    receipts:=receipts||jsonb_build_array(jsonb_build_object('replayed',true,'order_id',o.id));
   else
    if o.revision is distinct from (g->>'expected_revision')::integer then raise exception using errcode='40001',message='Quotation changed after preview';end if;
    receipts:=receipts||jsonb_build_array(public.retail_mis_service_command(p_actor,request,'REWORK',o.id,o.revision,jsonb_build_object('reference',g->>'quotation_number','store_ids',g->'store_ids','items',g->'items','reason','Reviewed revised quotation upload','quotation_file_sha256',p_sha256,'original_base64',p_original)));
   end if;
  else
   if (g->>'expected_revision')::integer is distinct from 0 then raise exception using errcode='40001',message='Quotation identity changed after preview';end if;
   receipts:=receipts||jsonb_build_array(public.retail_mis_service_command(p_actor,request,'CREATE_OOS',null,null,jsonb_build_object('reference',g->>'quotation_number','store_ids',g->'store_ids','items',g->'items','filename',p_filename,'file_sha256',p_sha256,'original_base64',p_original)));
  end if;`);
service=replace(service,'  select min(state) into st',`  if exists(select 1 from public.reliance_retail_store_master s where s.id=any(ids) and (nullif(btrim(s.store_code),'') is null or (select count(*) from public.reliance_retail_store_master d where upper(btrim(d.store_code))=upper(btrim(s.store_code)))<>1)) then raise exception using errcode='42501',message='Ambiguous canonical Store Code';end if;
  select min(state) into st`);
service=replace(service,"  if not public.retail_mis_oos_access(p_actor,e.after_value->>'state','edit')", "  if not public.retail_mis_oos_order_allowed(p_actor,e.order_id,true) or exists(select 1 from public.retail_mis_oos_retirements r where r.order_id=e.order_id) then raise exception using errcode='42501',message='Replayed order unavailable or retired';end if;\n  if not public.retail_mis_oos_access(p_actor,e.after_value->>'state','edit')");
service=replace(service,"  select * into o from public.retail_service_orders where kind=k and reference=p_data->>'reference';",`  select * into o from public.retail_service_orders where kind=k and reference=p_data->>'reference';
  if found and (not public.retail_mis_oos_order_allowed(p_actor,o.id,true) or exists(select 1 from public.retail_mis_oos_retirements where order_id=o.id)) then raise exception using errcode='42501',message='Existing quotation outside assignment or retired';end if;`);
importer=replace(importer,'begin\n',`begin
 if not public.retail_mis_oos_enabled() or not public.retail_mis_allowed(p_actor,'oos',null,true) then raise exception using errcode='42501',message='OOS writes unavailable';end if;
 if (select count(distinct s.state) from jsonb_array_elements(p_groups) as quoted(value) cross join lateral jsonb_array_elements_text(quoted.value->'store_ids') i join public.reliance_retail_store_master s on s.id=i.value::uuid)<>1 then raise exception using errcode='42501',message='Cross-state file rejected in full';end if;
`);
let attendance=body('supabase/migrations_2_0/232_reliance_retail_uploaded_attendance.sql','rpc_commit_retail_attendance_upload').replaceAll('rpc_commit_retail_attendance_upload','rpc_retail_mis_attendance_commit');
attendance=replace(attendance,"not exists(select 1 from unnest(array[p.role,p.designation,p.department]) r\n    where regexp_replace(upper(coalesce(r,'')),'[^A-Z0-9]+','','g') in ('ADMIN','QPMSADMIN','DEVELOPER','DEV','MD','COO'))","not (public.retail_mis_allowed(p_actor,'attendance-hk',null,true) or public.retail_mis_allowed(p_actor,'attendance-mepc',null,true))");
attendance=replace(attendance,"  if b.status = 'committed'",`  if b.kind<>'attendance' or exists(select 1 from jsonb_array_elements(b.payload) v left join public.reliance_retail_store_master s on s.id=(v->>'retail_store_id')::uuid where s.id is null or not public.retail_mis_unique_store(s.id) or upper(btrim(v->>'store_code')) is distinct from upper(btrim(s.store_code)) or not public.retail_mis_allowed(p_actor,case when v->>'class'='HK' then 'attendance-hk' when v->>'class'='MEPC' then 'attendance-mepc' else '' end,s.state,true)) then raise exception using errcode='42501',message='Entire attendance upload must remain within assigned class/state';end if;
  if exists(select 1 from public.retail_employee_daily_attendance x where x.superseded_at is null and exists(select 1 from jsonb_array_elements(b.payload) v where v->>'employee_code'=x.employee_code and (v->>'attendance_date')::date=x.attendance_date) and not exists(select 1 from public.reliance_retail_store_master s where s.id=x.retail_store_id and public.retail_mis_allowed(p_actor,case when x.class='HK' then 'attendance-hk' else 'attendance-mepc' end,s.state,true))) then raise exception using errcode='42501',message='Cross-scope employee/day correction denied';end if;
  if b.status = 'committed'`);
const output='-- GENERATED by scripts/buildRetailMisWorkflowAdapters.mjs. Review-only local adapters.\n'+ops+'\n'+fault+'\n'+cleaning+'\n'+service+'\n'+importer+'\n'+attendance+'\n';
fs.writeFileSync(path.join(root,'supabase/proposals/retail_mis_workflow_adapters.sql'),output);
const migration=path.join(root,'supabase/migrations/20261102071258_retail_mis_four_roles.sql');
let main=fs.readFileSync(migration,'utf8').replaceAll('\r\n','\n');
if((main.match(/-- BEGIN GENERATED MIS WORKFLOWS/g)||[]).length!==1||(main.match(/-- END GENERATED MIS WORKFLOWS/g)||[]).length!==1)throw Error('Expected exactly one generated workflow section');
main=main.replace(/-- BEGIN GENERATED MIS WORKFLOWS[\s\S]*?-- END GENERATED MIS WORKFLOWS\n/,'');
const insert='-- BEGIN GENERATED MIS WORKFLOWS\n'+read('supabase/proposals/retail_mis_commands.sql')+'\n'+output+'-- END GENERATED MIS WORKFLOWS\n';
main=main.replace('-- No direct employee table access',()=>insert+'-- No direct employee table access');
fs.writeFileSync(migration,main);
