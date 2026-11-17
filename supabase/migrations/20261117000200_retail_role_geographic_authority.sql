-- Verified Reliance Retail South Head / Branch Head geographic reporting authority.

-- Branch Heads: view own verified state only; South Heads: all verified regional states.

-- Existing admins, MIS and other roles retain their unchanged authorization conditions.

CREATE OR REPLACE FUNCTION public.retail_role_states(p_actor uuid)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
SELECT COALESCE(ARRAY(
 SELECT DISTINCT allowed.state
 FROM public.profiles p
 JOIN public.access_user_assignments a ON a.profile_id=p.id AND a.auth_user_id=p.auth_user_id
 JOIN public.access_roles r ON r.id=a.role_id
 JOIN public.access_modules m ON m.id=a.module_id AND m.code='fo_operations'
 JOIN public.access_clients c ON c.id=a.client_id AND c.code='reliance_retail'
 JOIN public.access_user_scopes s ON s.user_assignment_id=a.id AND s.scope_type='state' AND s.allowed=true
 CROSS JOIN LATERAL unnest(
  CASE upper(btrim(s.scope_code))
   WHEN 'AP' THEN ARRAY['AP-1','AP-2']
   WHEN 'TN' THEN ARRAY['TN','PY']
   WHEN 'KA' THEN ARRAY['KA']
   WHEN 'KN' THEN ARRAY['KA']
   WHEN 'KL' THEN ARRAY['KL']
   WHEN 'TG' THEN ARRAY['TG']
   ELSE ARRAY[]::text[]
  END
 ) AS allowed(state)
 WHERE p.id=p_actor
   AND p.auth_user_id IS NOT NULL
   AND nullif(btrim(p.employee_code),'') IS NOT NULL
   AND p.is_active=true AND p.web_access_enabled=true
   AND upper(coalesce(p.status,'Active'))='ACTIVE'
   AND regexp_replace(upper(coalesce(p.business,'')),'[^A-Z0-9]','','g') IN ('RELIANCE','RELIANCERETAIL')
   AND ((p.role='South Head' AND r.code='gm')
     OR (p.role='Branch Head' AND r.code='branch_head'
       AND CASE upper(btrim(p.state))
         WHEN 'KN' THEN 'KA' ELSE upper(btrim(p.state)) END
         = CASE upper(btrim(s.scope_code))
         WHEN 'KN' THEN 'KA' ELSE upper(btrim(s.scope_code)) END))
   AND a.active=true AND a.verification_status='verified'
   AND (a.effective_from IS NULL OR a.effective_from<=now())
   AND (a.effective_to IS NULL OR a.effective_to>now())
   AND (s.effective_from IS NULL OR s.effective_from<=now())
   AND (s.effective_to IS NULL OR s.effective_to>now())
),ARRAY[]::text[]);
$function$;
REVOKE ALL ON FUNCTION public.retail_role_states(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retail_role_states(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.retail_role_state_access(p_actor uuid,p_state text,p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
SELECT EXISTS(
 SELECT 1 FROM public.profiles p
 WHERE p.id=p_actor
   AND ((p.role='South Head' AND p_action IN ('view','edit','review'))
    OR (p.role='Branch Head' AND p_action='view'))
   AND (p_state IS NULL OR p_state=ANY(public.retail_role_states(p_actor)))
   AND cardinality(public.retail_role_states(p_actor))>0
);
$function$;
REVOKE ALL ON FUNCTION public.retail_role_state_access(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retail_role_state_access(uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.retail_unified_access(p_actor uuid, p_state text, p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 select exists(
  select 1 from public.profiles p where p.id=p_actor and p.is_active is true and upper(coalesce(p.status,'Active'))='ACTIVE'
  and (
   regexp_replace(upper(coalesce(p.role,'')),'[^A-Z0-9]','','g') in ('ADMIN','QPMSADMIN')
   or (
    regexp_replace(upper(coalesce(p.business,'')),'[^A-Z0-9]','','g') in ('RELIANCE','RELIANCERETAIL')
    and exists(
     select 1 from public.retail_provisional_access a where a.actor_id=p.id and (p_state is null or a.state=p_state)
     and (p_action='view' or (p_action='edit' and a.permission in ('editor','reviewer')) or (p_action='review' and a.permission='reviewer'))
    )
   )
  )
 ) OR public.retail_role_state_access(p_actor,p_state,p_action);
$function$;

CREATE OR REPLACE FUNCTION public.retail_operations_access(p_actor uuid, p_state text, p_write boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 select exists(select 1 from public.profiles p where p.id=p_actor and p.is_active is true and upper(coalesce(p.status,'Active'))='ACTIVE'
 and (regexp_replace(upper(coalesce(p.role,'')),'[^A-Z0-9]','','g') in ('ADMIN','QPMSADMIN') or
  (regexp_replace(upper(coalesce(p.business,'')),'[^A-Z0-9]','','g') in ('RELIANCE','RELIANCERETAIL') and exists(
   select 1 from unnest(array[p.role,p.designation,p.department]) k where (
   regexp_replace(upper(coalesce(k,'')),'[^A-Z0-9]','','g')
    in ('MIS','HKMIS','HOUSEKEEPINGMIS','TECHNICALMIS','TECHMIS','KAM')
   or (p.role in ('South Head','Branch Head') and
       public.retail_role_state_access(p_actor,p_state,case when p_write then 'edit' else 'view' end))
  ))))
 and public.retail_unified_access(p_actor,p_state,case when p_write then 'edit' else 'view' end));
$function$
;