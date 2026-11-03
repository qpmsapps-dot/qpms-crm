-- Synthetic isolated PostgreSQL schema, never executable against production.
create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema storage;
create table auth.users(id uuid primary key,encrypted_password text);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
grant usage on schema public,auth,storage to anon,authenticated,service_role;
create table public.profiles(id uuid primary key,auth_user_id uuid unique,employee_code text unique,full_name text,role text check(role=any(array['Admin','QPMS Admin','Business Development Head','FO'])),business text,designation text,department text,state text,status text default 'Active',is_active boolean default true);
alter table public.profiles add column display_name text, add column mobile text, add column email text, add column requires_password_change boolean default false, add column mobile_access_enabled boolean default true;
-- Match the production text CHECK and its NOT VALID state, without copying users.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check(role=any(array['Admin','QPMS Admin','Developer','Dev','IT Admin','Management IT Admin','Management','MD','COO','Executive Assistant','GM','General Manager','South Head','Business Head','Branch Head','Operations Manager','Manager','KAM','FO','Field Officer','Supervisor','Business Development Executive','Business Development Head','BD Executive','BD Head','Pre-Sales','Pre-Sales Executive','Pre-Sales Manager','Tender','Hospital Management','RMO','Doctor','Operations Team','Coordinator','Commercial','Commercial Team','Commercial Reviewer','Finance','Finance Team','Finance Reviewer','HR Reviewer','HR','HR GM','Finance GM','CFO','DEMO_VIEWER'])) not valid;
-- Installed production trigger definition inspected read-only on 2026-11-02.
create function public.sync_mobile_role_from_designation() returns trigger language plpgsql as $$begin
 new.designation:=trim(new.designation);
 new.role:=case upper(trim(coalesce(new.designation,''))) when 'FIELD OFFICER' then 'FO' when 'KEY ACCOUNT MANAGER' then 'KAM' when 'KEY ACCOUNTS MANAGER' then 'KAM' when 'OPERATIONS MANAGER' then 'OPERATIONS_MANAGER' else coalesce(new.role,'OTHER') end;
 return new;end;$$;
create trigger sync_mobile_role_from_designation before insert or update on public.profiles for each row execute function public.sync_mobile_role_from_designation();
create table public.reliance_retail_store_master(id uuid primary key,store_code text,store_name text,state text,status text default 'Active',city text,store_format text,zone_id uuid);
create table public.retail_provisional_access(actor_id uuid,state text,permission text);
create table public.access_roles(id uuid primary key default gen_random_uuid(),code text,name text);
create table public.access_user_assignments(id uuid primary key default gen_random_uuid(),role_id uuid references public.access_roles(id));
insert into public.access_roles(code,name) values('mis','MIS');
create table public.reliance_retail_management_audit(id uuid primary key default gen_random_uuid(),action text,entity_type text,entity_id uuid,actor_profile_id uuid,before_state jsonb,after_state jsonb,created_at timestamptz default now());
create function public.retail_unified_access(p_actor uuid,p_state text,p_action text) returns boolean language sql stable as $$select exists(select 1 from public.profiles where id=p_actor and role in ('Admin','QPMS Admin'))$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb default '{}');
alter table storage.objects enable row level security;
grant all on storage.objects to authenticated,service_role;
create policy broad_fixture_policy on storage.objects for all to authenticated using(true) with check(true);
create table public.client_deep_cleaning_schedules(id uuid primary key default gen_random_uuid(),retail_store_id uuid,scheduled_date date,assigned_fo_profile_id uuid,status text default 'Planned',not_done_reason text,source_reference text,created_by_profile_id uuid,metadata jsonb not null default '{}',created_at timestamptz default now(),updated_at timestamptz default now(),completed_at timestamptz);
create table public.client_deep_cleaning_submissions(id uuid primary key,retail_store_id uuid,store_code text,state text,deep_cleaning_date date,status text);
create table public.client_deep_cleaning_uploads(id uuid primary key,submission_id uuid,storage_bucket text,storage_path text,upload_status text);
create table public.retail_provisional_proposals(id uuid primary key,kind text,status text,target_store uuid,proposed_by uuid,decided_by uuid);
create table public.fo_activity_submissions(id uuid primary key,employee_code text,store_code text,activity_type text,status text,submitted_at timestamptz,metadata jsonb,retail_store_id uuid);
create table public.fo_activity_uploads(id uuid primary key,submission_id uuid,employee_code text,store_code text,activity_type text,uploaded_at timestamptz,storage_bucket text,upload_role text,file_type text,file_size bigint,file_url text,file_name text);
create table public.retail_unified_epoch(observed_at timestamptz,store_zones jsonb);
create table public.reliance_retail_zone_fo_assignments(id uuid primary key,zone_id uuid,fo_profile_id uuid,fo_employee_code text,effective_from timestamptz,effective_to timestamptz);
create table public.reliance_retail_store_zone_history(id uuid primary key,retail_store_id uuid,new_zone_id uuid,changed_at timestamptz);
create table public.training_categories(id uuid primary key,code text);
create table public.training_sessions(id uuid primary key,retail_store_id uuid,store_code_snapshot text,state_snapshot text,access_client_code text,training_date date,category_id uuid,status text);
create table public.training_evidence(id uuid primary key,training_session_id uuid,storage_bucket text,storage_path text);
create table public.fault_tracker_tickets(id uuid primary key,store_code text,is_active boolean default true,stage text,stage_group text,remarks text,updated_at timestamptz default now(),metadata jsonb default '{}',raw_row jsonb);
create table public.fault_tracker_import_batches(id uuid primary key default gen_random_uuid());
create table public.fault_tracker_ticket_updates(id uuid primary key default gen_random_uuid(),ticket_id uuid,updated_by_auth_user_id uuid,updated_by_employee_code text,update_type text,previous_stage text,new_stage text,remarks text,metadata jsonb,created_at timestamptz default now());
