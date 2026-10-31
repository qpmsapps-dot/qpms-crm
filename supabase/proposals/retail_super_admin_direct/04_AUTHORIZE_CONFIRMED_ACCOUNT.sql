-- OWNER ONLY. Exactly four authenticated IDs authorized by the Super Admin.
-- Uses existing profiles; never grants authority by role name alone.
begin;
set local lock_timeout='5s';
do $grant$
declare auth_id uuid; target_id uuid; source_sha text;
 allowed uuid[]:=array['79cd196c-c6f3-404a-b22a-d4683afefa3f','7e84cddf-821a-4513-b7ce-25895d660393','f9238141-8f44-4073-86aa-2749b8a3dccf','377ca7a2-95cc-4891-8840-338f2cb20bb9']::uuid[];
begin
 perform pg_advisory_xact_lock(hashtextextended('retail_super_admin_identity_authority_setup',0));
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261031090000' and cardinality(statements)=1 and md5(replace(statements[1],E'\r\n',E'\n'))='f2087eb8651b01334bdc6762f8892048') then raise exception 'Install the reviewed pending exception package first; never rerun older migrations';end if;
 select sha256 into strict source_sha from public.retail_provisional_files where version=2 and source_format='UNIFIED MASTER' and withdrawn_at is null for share;
 if exists(select 1 from public.retail_identity_final_authority where enabled and auth_user_id<>all(allowed)) then raise exception 'Unexpected existing authority: inspect before proceeding';end if;
 foreach auth_id in array allowed loop
  select id into strict target_id from public.profiles where auth_user_id=auth_id for share;
  if public.retail_provisional_admin(target_id) is not true then raise exception 'Authorized authenticated ID does not map to exactly one active Admin: %',auth_id;end if;
  insert into public.retail_identity_final_authority(actor_id,auth_user_id,source_sha256,authorization_reference)
   values(target_id,auth_id,source_sha,'Super Admin final authorization: exactly four existing authenticated IDs; confirmed Reliance Retail Version 2')
   on conflict(actor_id,source_sha256) do nothing;
  if public.retail_identity_final_authorized(target_id,source_sha) is not true then raise exception 'Account binding mismatch or revoked entitlement: %',auth_id;end if;
 end loop;
 if (select count(*) from public.retail_identity_final_authority where enabled and source_sha256=source_sha)<>4 then raise exception 'Expected exactly four enabled source-bound accounts';end if;
end;$grant$;
select p.username,p.id as profile_id,p.auth_user_id,a.source_sha256,a.granted_at,a.authorization_reference
 from public.retail_identity_final_authority a join public.profiles p on p.id=a.actor_id and p.auth_user_id=a.auth_user_id where a.enabled order by p.username;
commit;
