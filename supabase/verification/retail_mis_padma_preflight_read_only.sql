-- Owner read-only check. Return booleans/identifiers, never credentials.
begin read only;
select p.id,p.auth_user_id,p.employee_code,p.role,p.designation,p.business,p.is_active,
 p.id='83231458-af73-435a-abda-48bec9f29e5e'::uuid profile_matches,
 p.auth_user_id='e843bc42-5f61-474d-8eca-1cf8d01ce2c1'::uuid auth_matches,
 (select count(*) from public.profiles x where x.employee_code=p.employee_code)=1 employee_unique,
 (select count(*) from public.profiles x where x.auth_user_id=p.auth_user_id)=1 auth_link_unique,
 exists(select 1 from auth.users u where u.id=p.auth_user_id) auth_exists
from public.profiles p where p.employee_code='QPMSAP2519';
select r.code,r.name,count(a.id) assignments from public.access_roles r left join public.access_user_assignments a on a.role_id=r.id where r.code='mis' group by r.code,r.name;
rollback;
