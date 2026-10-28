-- PREPARED ONLY: revised Phase 1 candidate; never install over an existing 232 without a separate reviewed upgrade. Reporting module; requires Retail Store Master (211/212/215).
-- Never reads/writes FO attendance, GPS, payable KM or financial tables.
begin;
create table public.retail_attendance_uploads (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('attendance','aop')),
  filename text not null,
  checksum text not null,
  uploaded_by uuid not null references public.profiles(id),
  uploaded_at timestamptz not null default now(),
  committed_at timestamptz,
  date_from date, date_to date,
  total_rows integer not null, valid_rows integer not null, rejected_rows integer not null,
  status text not null default 'preview' check(status in ('preview','committed')),
  validation_summary jsonb not null,
  payload jsonb not null,
  raw_source jsonb not null default '{}'::jsonb,
  expected_ids jsonb not null default '[]',
  correction_reason text,
  unique(kind,checksum)
);
create table public.retail_employee_daily_attendance (
  id uuid primary key default gen_random_uuid(),
  attendance_date date not null,
  employee_code text not null check(employee_code = upper(btrim(employee_code)) and employee_code <> ''),
  employee_name text not null check(btrim(employee_name) <> ''),
  retail_store_id uuid not null references public.reliance_retail_store_master(id) on delete restrict,
  store_code_snapshot text not null,
  class text not null check(class in ('HK','MEPC')),
  original_status text not null,
  source_row integer not null check(source_row > 1),
  credit numeric(3,1) not null,
  batch_id uuid not null references public.retail_attendance_uploads(id),
  imported_at timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by_batch uuid references public.retail_attendance_uploads(id),
  check (credit = case upper(regexp_replace(regexp_replace(original_status,'^\s+|\s+$','','g'),'\s*[-–]\s*','-','g'))
    when 'A' then 0 when 'T' then 0 when 'H' then 0 when 'NO-SHOW' then 0
    when 'H-P' then 1 when 'P' then 1 when 'H-HD' then 0.5 when 'HD' then 0.5 else -1 end)
);
create unique index ux_retail_daily_current_employee_date on public.retail_employee_daily_attendance(employee_code,attendance_date,retail_store_id) where superseded_at is null;
create index ix_retail_daily_store_date on public.retail_employee_daily_attendance(retail_store_id,attendance_date) where superseded_at is null;

-- Serialize all current-row changes, including direct service-role writes, before checking the company-wide daily cap.
create function public.retail_attendance_daily_cap()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('retail_uploaded_attendance',0));
  if new.superseded_at is null and new.credit + coalesce((select sum(a.credit) from public.retail_employee_daily_attendance a
    where a.employee_code=new.employee_code and a.attendance_date=new.attendance_date and a.superseded_at is null and a.id<>new.id),0)>1 then
    raise exception 'Employee daily attendance credit cannot exceed 1';
  end if;
  if tg_op='UPDATE' and old.superseded_at is not null then raise exception 'Superseded attendance is immutable'; end if;
  if tg_op='UPDATE' and (to_jsonb(new)-'superseded_at'-'superseded_by_batch') is distinct from (to_jsonb(old)-'superseded_at'-'superseded_by_batch') then
    raise exception 'Attendance evidence is immutable; supersede with a reasoned upload';
  end if;
  return new;
end; $$;
create trigger retail_daily_cap before insert or update on public.retail_employee_daily_attendance for each row execute function public.retail_attendance_daily_cap();
revoke all on function public.retail_attendance_daily_cap() from public,anon,authenticated;

create function public.retail_attendance_source_immutable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.status='committed' then raise exception 'Committed upload audit is immutable'; end if;
  return new;
end; $$;
create trigger retail_source_immutable before update on public.retail_attendance_uploads for each row execute function public.retail_attendance_source_immutable();
revoke all on function public.retail_attendance_source_immutable() from public,anon,authenticated;

create table public.retail_attendance_aop_versions (
  id uuid primary key default gen_random_uuid(),
  retail_store_id uuid not null references public.reliance_retail_store_master(id) on delete restrict,
  hk_count numeric(14,4) not null check(hk_count >= 0),
  mepc_count numeric(14,4) not null check(mepc_count >= 0),
  mepc_cycle_anchor date, -- Approved planning-cycle anchor, not an employee off-day roster.
  effective_from date not null,
  effective_to date,
  source_version text not null check(btrim(source_version) <> ''),
  batch_id uuid not null references public.retail_attendance_uploads(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by_batch uuid references public.retail_attendance_uploads(id),
  check(effective_to is null or effective_to >= effective_from)
);
create index ix_retail_aop_effective on public.retail_attendance_aop_versions(retail_store_id,effective_from,effective_to) where superseded_at is null;
create function public.retail_attendance_aop_no_overlap()
returns trigger language plpgsql set search_path = public,pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('retail_uploaded_attendance',0));
  if new.superseded_at is null and exists(select 1 from public.retail_attendance_aop_versions a
    where a.retail_store_id = new.retail_store_id and a.id <> new.id and a.superseded_at is null
      and daterange(a.effective_from,a.effective_to,'[]') && daterange(new.effective_from,new.effective_to,'[]')) then
    raise exception 'Overlapping approved AOP periods';
  end if;
  return new;
end; $$;
create trigger retail_aop_no_overlap before insert or update on public.retail_attendance_aop_versions
for each row execute function public.retail_attendance_aop_no_overlap();

create function public.rpc_commit_retail_attendance_upload(p_batch uuid,p_actor uuid,p_replace boolean default false,p_reason text default null,p_preview_key text default null)
returns uuid language plpgsql security definer set search_path = public,pg_temp as $$
declare b public.retail_attendance_uploads%rowtype; current_ids jsonb; p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = p_actor;
  if not found or p.is_active is not true or not exists(select 1 from unnest(array[p.role,p.designation,p.department]) r
    where regexp_replace(upper(coalesce(r,'')),'[^A-Z0-9]+','','g') in ('ADMIN','QPMSADMIN','DEVELOPER','DEV','MD','COO')) then
    raise exception using errcode='42501',message='Administrative upload authorization required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('retail_uploaded_attendance',0));
  select * into b from public.retail_attendance_uploads where id = p_batch for update;
  if not found or b.uploaded_by <> p_actor then raise exception using errcode='42501',message='Upload owner mismatch'; end if;
  if b.status = 'committed' then return b.id; end if;
  if p_preview_key is distinct from b.validation_summary ->> 'preview_key' then raise exception using errcode='40001',message='Preview changed; review it again'; end if;
  if b.valid_rows = 0 then raise exception 'Resolve upload validation errors first'; end if;
  if b.kind = 'attendance' then
    select coalesce(jsonb_agg(x.id::text order by x.id::text),'[]'::jsonb) into current_ids
      from public.retail_employee_daily_attendance x where x.superseded_at is null and exists(
        select 1 from jsonb_array_elements(b.payload) v where v->>'employee_code'=x.employee_code and (v->>'attendance_date')::date=x.attendance_date);
  else
    select coalesce(jsonb_agg(x.id::text order by x.id::text),'[]'::jsonb) into current_ids
      from public.retail_attendance_aop_versions x where x.superseded_at is null and exists(
        select 1 from jsonb_array_elements(b.payload) v where (v->>'retail_store_id')::uuid=x.retail_store_id
          and daterange(x.effective_from,x.effective_to,'[]') && daterange((v->>'effective_from')::date,(v->>'effective_to')::date,'[]'));
  end if;
  if current_ids <> b.expected_ids then raise exception using errcode='40001',message='Data changed since preview; upload again for a new preview'; end if;
  if jsonb_array_length(current_ids)>0 and (not p_replace or nullif(btrim(p_reason),'') is null) then raise exception 'Explicit correction confirmation and reason required'; end if;
  if b.kind = 'attendance' then
    update public.retail_employee_daily_attendance set superseded_at=now(),superseded_by_batch=b.id where id::text in(select jsonb_array_elements_text(current_ids));
    insert into public.retail_employee_daily_attendance(attendance_date,employee_code,employee_name,retail_store_id,store_code_snapshot,class,original_status,credit,batch_id,source_row)
      select (v->>'attendance_date')::date,v->>'employee_code',v->>'employee_name',(v->>'retail_store_id')::uuid,v->>'store_code',v->>'class',v->>'original_status',(v->>'credit')::numeric,b.id,(v->>'source_row')::integer
      from jsonb_array_elements(b.payload) v;
  else
    -- Only exact-window corrections; do not silently erase/split historical periods.
    if exists(select 1 from public.retail_attendance_aop_versions x join jsonb_array_elements(b.payload) v on (v->>'retail_store_id')::uuid=x.retail_store_id
      and daterange(x.effective_from,x.effective_to,'[]') && daterange((v->>'effective_from')::date,(v->>'effective_to')::date,'[]')
      where x.id::text in(select jsonb_array_elements_text(current_ids))
        and (x.effective_from is distinct from (v->>'effective_from')::date or x.effective_to is distinct from (v->>'effective_to')::date)) then
      raise exception 'AOP correction must preserve the existing effective window';
    end if;
    update public.retail_attendance_aop_versions set superseded_at=now(),superseded_by_batch=b.id where id::text in(select jsonb_array_elements_text(current_ids));
    insert into public.retail_attendance_aop_versions(retail_store_id,hk_count,mepc_count,effective_from,effective_to,source_version,batch_id,created_by,mepc_cycle_anchor)
      select (v->>'retail_store_id')::uuid,(v->>'hk_count')::numeric,(v->>'mepc_count')::numeric,(v->>'effective_from')::date,(v->>'effective_to')::date,v->>'source_version',b.id,p_actor,(v->>'mepc_cycle_anchor')::date
      from jsonb_array_elements(b.payload) v;
  end if;
  update public.retail_attendance_uploads set status='committed',committed_at=now(),correction_reason=nullif(btrim(p_reason),'') where id=b.id;
  return b.id;
end; $$;
alter table public.retail_attendance_uploads enable row level security;
alter table public.retail_employee_daily_attendance enable row level security;
alter table public.retail_attendance_aop_versions enable row level security;
revoke all on public.retail_attendance_uploads,public.retail_employee_daily_attendance,public.retail_attendance_aop_versions from public,anon,authenticated;
grant select,insert,update on public.retail_attendance_uploads,public.retail_employee_daily_attendance,public.retail_attendance_aop_versions to service_role;
revoke all on function public.rpc_commit_retail_attendance_upload(uuid,uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.rpc_commit_retail_attendance_upload(uuid,uuid,boolean,text,text) to service_role;
revoke all on function public.retail_attendance_aop_no_overlap() from public,anon,authenticated;

create function public.rpc_retail_attendance_conflicts(p_rows jsonb)
returns table(id uuid,employee_code text,attendance_date date,retail_store_id uuid,class text,credit numeric)
language sql stable security definer set search_path = public,pg_temp as $$
  select a.id,a.employee_code,a.attendance_date,a.retail_store_id,a.class,a.credit
  from public.retail_employee_daily_attendance a
  join (select distinct employee_code,attendance_date from jsonb_to_recordset(p_rows) as r(employee_code text,attendance_date date)) r
    on r.employee_code=a.employee_code and r.attendance_date=a.attendance_date
  where a.superseded_at is null order by a.id::text;
$$;
create function public.rpc_retail_attendance_report_source(p_store_ids uuid[],p_from date,p_to date)
returns jsonb language sql stable security definer set search_path = public,pg_temp as $$
  select jsonb_build_object(
    'attendance',coalesce((select jsonb_agg(g) from (
      select retail_store_id,attendance_date,class,sum(credit) as credit
      from public.retail_employee_daily_attendance
      where superseded_at is null and retail_store_id=any(p_store_ids) and attendance_date between p_from and p_to
      group by retail_store_id,attendance_date,class
    ) g),'[]'::jsonb),
    'employee_counts',(select jsonb_build_object('unique_employees',count(distinct employee_code),'employee_days',count(distinct (employee_code,attendance_date)),
      'hk_employee_days',count(distinct (employee_code,attendance_date)) filter(where class='HK'),
      'mepc_employee_days',count(distinct (employee_code,attendance_date)) filter(where class='MEPC'))
      from public.retail_employee_daily_attendance where superseded_at is null and credit>0 and retail_store_id=any(p_store_ids) and attendance_date between p_from and p_to),
    'aop',coalesce((select jsonb_agg(a) from public.retail_attendance_aop_versions a
      where a.superseded_at is null and a.retail_store_id=any(p_store_ids)
        and a.effective_from<=p_to and (a.effective_to is null or a.effective_to>=p_from)),'[]'::jsonb),
    'latest_date',(select max(attendance_date) from public.retail_employee_daily_attendance
      where superseded_at is null and retail_store_id=any(p_store_ids))
  );
$$;
revoke all on function public.rpc_retail_attendance_conflicts(jsonb), public.rpc_retail_attendance_report_source(uuid[],date,date) from public,anon,authenticated;
grant execute on function public.rpc_retail_attendance_conflicts(jsonb), public.rpc_retail_attendance_report_source(uuid[],date,date) to service_role;
commit;
