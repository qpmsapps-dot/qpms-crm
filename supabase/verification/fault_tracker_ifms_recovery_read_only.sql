-- Read-only recovery preview. Uses the exact proposed verified-history resolver
-- body inline; requires no migration installation and changes no rows.
with affected(ticket_no,store_code) as (values
 ('CM1780058855626','TA7E'),
 ('CM1781531434258','TA7E'),
 ('CM1781943031227','U1CX'),
 ('CM1781954407593','TA7E'),
 ('CM1782283393739','T86A'),
 ('CM1783753693669','T9NZ'),
 ('CM1784389900813','TA7E'),
 ('CM1785818914364','TW83'),
 ('CM1791557165610','TA7E'),
 ('CM1791557933342','TA7E'),
 ('CM1791558095830','TA7E'),
 ('CM1791558326013','TA7E'),
 ('CM1791961001972','TL34')
), latest as (select id from public.fault_tracker_import_batches where source_name='Reliance Retail IFMS' order by imported_at desc,id desc limit 1)
select a.ticket_no,a.store_code,cur.id as latest_ticket_id,cur.stage as snapshot_stage,
 e.id as verified_update_id,e.new_stage as retained_stage,e.remarks as retained_remarks,
 e.created_at as verified_updated_at,cur.ageing_days,
 (select count(*) from public.reliance_retail_store_master s where upper(btrim(s.store_code))=a.store_code) as store_matches,
 (cur.id is not null and e.id is not null) as recoverable
from affected a
left join public.fault_tracker_tickets cur on cur.import_batch_id=(select id from latest)
 and upper(btrim(cur.ticket_no))=a.ticket_no and upper(btrim(cur.store_code))=a.store_code
left join lateral (select verified.* from (
 select u.*
 from public.fault_tracker_tickets target
 join public.fault_tracker_import_batches tb on tb.id=target.import_batch_id and tb.source_name='Reliance Retail IFMS'
 join public.reliance_retail_store_master s on upper(btrim(s.store_code))=upper(btrim(target.store_code))
 join public.fault_tracker_tickets original on upper(btrim(original.ticket_no))=upper(btrim(target.ticket_no))
  and upper(btrim(original.store_code))=upper(btrim(target.store_code))
 join public.fault_tracker_import_batches ob on ob.id=original.import_batch_id and ob.source_name=tb.source_name
 join public.fault_tracker_ticket_updates u on u.ticket_id=original.id
 join public.profiles actor on actor.id::text=u.metadata->>'actor_profile_id'
  and actor.auth_user_id=u.updated_by_auth_user_id and actor.employee_code=u.updated_by_employee_code
 where target.id=cur.id and btrim(target.ticket_no)<>'' and btrim(target.store_code)<>''
 and (select count(*) from public.reliance_retail_store_master x where upper(btrim(x.store_code))=upper(btrim(target.store_code)))=1
 and u.metadata->>'retail_workflow_version'='1'
 and u.metadata->>'retail_request_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 and u.update_type in ('STAGE_OR_REMARKS','WORK_COMPLETED')
 and u.new_stage=any(array['Fault Raised - Quote Yet to Submit','Quote Submitted - PO Yet to Receive','PO Received - Fund Request Pending','Fund Released - Work Yet to Start','Fund Released - Work in Progress','Work Completed - Documents Pending','Documents Received - JMS Yet to Create','JMS Created - Invoice Yet to Raise','Invoice Raised - Payment Pending','Set Off Pending','CAMC','OEM','MEPC','IOT','Pest Control','HK','Work Completed - Call Yet to Close']::text[]) and u.remarks is not null
 and (not(u.metadata ? 'ifms_identity') or u.metadata->'ifms_identity'=jsonb_build_array(tb.source_name,upper(btrim(target.ticket_no)),upper(btrim(target.store_code)),s.id))
) verified order by verified.created_at desc,verified.id desc limit 1) e on true
order by a.ticket_no;
