-- FO Training store scope: TN/PY assigned zone only; elsewhere state-wide.
-- Exact state matching; AP-1 and AP-2 never merged.
-- Do not alter Training attendance, site visit, topic/evidence, or audit requirements.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.training_retail_store_allowed(
 p_actor_profile_id uuid, p_store_id uuid, p_category_id uuid
) returns boolean
language plpgsql stable security definer
set search_path to 'pg_catalog','public'
as $training_store_scope$
declare p public.profiles%rowtype;
 s public.reliance_retail_store_master%rowtype;
 c public.training_categories%rowtype;
 z public.reliance_retail_zones%rowtype;
 pgeo text;sgeo text;zgeo text;model text;
begin
 select * into p from public.profiles where id=p_actor_profile_id;
 select * into s from public.reliance_retail_store_master where id=p_store_id;
 select * into c from public.training_categories where id=p_category_id;
 if p.id is null or p.is_active is not true or regexp_replace(upper(coalesce(p.status,'Active')),'[^A-Z0-9]','','g')<>'ACTIVE'
 or regexp_replace(upper(coalesce(p.role,'')),'[^A-Z0-9]','','g') not in ('FO','FIELDOFFICER')
 or regexp_replace(upper(coalesce(p.business,'')),'[^A-Z0-9]','','g') not in ('RELIANCE','RELIANCERETAIL')
 or s.id is null or s.status<>'Active' or c.id is null or c.is_active is not true
 then return false;end if;
 if (select count(*) from public.reliance_retail_store_master r where upper(btrim(r.store_code))=upper(btrim(s.store_code)))<>1 then return false;end if;
 pgeo:=regexp_replace(upper(coalesce(p.state,'')),'[^A-Z0-9]','','g');
 sgeo:=regexp_replace(upper(coalesce(s.state,'')),'[^A-Z0-9]','','g');
 pgeo:=case
  when pgeo in ('TN','PY','TAMILNADU','PUDUCHERRY','PONDICHERRY') then 'TN'
  when pgeo in ('KA','KN','KARNATAKA') then 'KA'
  when pgeo in ('KL','KERALA') then 'KL'
  when pgeo in ('TG','TELANGANA') then 'TG'
  when pgeo in ('AP1','ANDHRAPRADESH1') then 'AP1'
  when pgeo in ('AP2','ANDHRAPRADESH2') then 'AP2'
  else null end;
 sgeo:=case
  when sgeo in ('TN','PY','TAMILNADU','PUDUCHERRY','PONDICHERRY') then 'TN'
  when sgeo in ('KA','KN','KARNATAKA') then 'KA'
  when sgeo in ('KL','KERALA') then 'KL'
  when sgeo in ('TG','TELANGANA') then 'TG'
  when sgeo in ('AP1','ANDHRAPRADESH1') then 'AP1'
  when sgeo in ('AP2','ANDHRAPRADESH2') then 'AP2'
  else null end;
 if pgeo is null or sgeo is distinct from pgeo then return false;end if;
 model:=upper(coalesce(s.metadata->>'operational_model',''));
 if model='SUPERVISOR_ONLY' and c.code<>'technical_mep' then return false;end if;
 if pgeo<>'TN' then return true;end if;
 if s.zone_id is null then
  return model='SUPERVISOR_ONLY' and c.code='technical_mep';
 end if;
 select * into z from public.reliance_retail_zones where id=s.zone_id and status='Active';
 if z.id is null then return false;end if;
 zgeo:=regexp_replace(upper(coalesce(z.state,'')),'[^A-Z0-9]','','g');
 if zgeo not in ('TN','PY','TAMILNADU','PUDUCHERRY','PONDICHERRY') then return false;end if;
 return exists(
  select 1 from public.reliance_retail_zone_fo_assignments a
  where a.zone_id=z.id and a.fo_profile_id=p.id and a.status='Active'
   and a.effective_from<=clock_timestamp() and (a.effective_to is null or a.effective_to>clock_timestamp())
 );
end;
$training_store_scope$;

revoke all on function public.training_retail_store_allowed(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.training_retail_store_allowed(uuid,uuid,uuid) to service_role;
commit;
