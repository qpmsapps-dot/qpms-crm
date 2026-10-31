alter table public.reliance_retail_store_master drop constraint reliance_retail_store_fo_assignment_consistency_check;
alter table public.reliance_retail_store_master add constraint reliance_retail_store_fo_assignment_consistency_check check (
 (assigned_fo_profile_id is not null and nullif(btrim(assigned_fo_employee_code),'') is not null and nullif(btrim(assigned_fo_name_snapshot),'') is not null)
 or (assigned_fo_profile_id is null and assigned_fo_employee_code is null and assigned_fo_name_snapshot is null and assigned_fo_phone_snapshot is null and zone_id is null and upper(coalesce(metadata->>'operational_model',''))='SUPERVISOR_ONLY')
 or (assigned_fo_profile_id is null and assigned_fo_employee_code is null and assigned_fo_name_snapshot is null and assigned_fo_phone_snapshot is null and upper(coalesce(metadata->>'operational_model',''))='IDENTITY_ONLY'
 and coalesce(metadata->>'approval_id','') ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' and coalesce(metadata->>'source_sha256','') ~ '^[a-f0-9]{64}$')
);
