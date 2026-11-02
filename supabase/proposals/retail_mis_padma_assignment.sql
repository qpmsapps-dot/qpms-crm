-- PREPARED ONLY. Separate explicit go-live authorization required. Not part of automatic schema installation.
-- Reclassifies exactly one verified existing account. No auth creation/password change.
begin;
set local lock_timeout='5s';
do $padma$ declare p public.profiles%rowtype;before_password text;after_password text;revision int;begin
 select * into p from public.profiles where id='83231458-af73-435a-abda-48bec9f29e5e' for update;
 if not found or p.auth_user_id is distinct from 'e843bc42-5f61-474d-8eca-1cf8d01ce2c1'::uuid or p.employee_code is distinct from 'QPMSAP2519' or p.is_active is not true or p.designation not in ('MIS','Central MIS') or p.role not in ('Business Development Head','CENTRAL_MIS') then raise exception 'Padma identity or baseline differs; stop without assignment';end if;
 select md5(encrypted_password) into before_password from auth.users where id=p.auth_user_id;
 if before_password is null then raise exception 'Existing auth identity required';end if;
 select a.revision into revision from public.retail_mis_assignments a where a.profile_id=p.id;
 if p.role<>'CENTRAL_MIS' then perform public.rpc_retail_mis_assign('d40c2b3f-87f1-4c34-8798-cf9b0d9ca784',p.id,p.auth_user_id,p.employee_code,'CENTRAL_MIS','{}','Business owner confirmed exact existing QPMSAP2519 Central MIS assignment',coalesce(revision,0));
 elsif not exists(select 1 from public.retail_mis_assignments a where a.profile_id=p.id and a.auth_user_id=p.auth_user_id and a.role='CENTRAL_MIS' and a.active) then raise exception 'Central MIS assignment/profile mismatch';end if;
 select md5(encrypted_password) into after_password from auth.users where id=p.auth_user_id;
 if before_password is distinct from after_password then raise exception 'Credential preservation failed';end if;
end;$padma$;
commit;
