const ROLE_CODES = new Set([
  'doctor',
  'hospital_management',
  'housekeeping_supervisor',
  'operations_executive',
  'facility_manager',
]);

export function normalizeHospitalRole(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const aliases = {
    doctor: 'doctor',
    hospital_management: 'hospital_management',
    hospital_manager: 'hospital_management',
    housekeeping_supervisor: 'housekeeping_supervisor',
    supervisor: 'housekeeping_supervisor',
    operations_executive: 'operations_executive',
    facility_manager: 'facility_manager',
  };
  return aliases[key] || key;
}

export function isActiveHospitalUser(user) {
  return Boolean(user?.id && user?.auth_user_id && user?.client_id && user?.is_active === true)
    && ROLE_CODES.has(normalizeHospitalRole(user.role_code));
}

export function hospitalAllowedActions(actor) {
  const role = normalizeHospitalRole(actor?.role_code);
  if (['doctor', 'hospital_management'].includes(role)) {
    return ['create_ticket', 'view_ticket', 'submit_feedback', 'view_client_attachments'];
  }
  if (role === 'housekeeping_supervisor') {
    return ['view_ticket', 'accept', 'start_work', 'progress', 'request_assistance', 'manual_escalation', 'resolve'];
  }
  if (role === 'operations_executive') {
    return ['view_ticket', 'take_over', 'reassign_supervisor', 'progress', 'escalate_facility', 'resolve'];
  }
  if (role === 'facility_manager') {
    return ['view_ticket', 'take_over', 'assign_support', 'progress', 'resolve'];
  }
  return [];
}

export function scopeAllows(scopes, { clientId, blockId, locationId, permission = 'view' }) {
  const permissionKey = permission === 'create' ? 'can_create' : permission === 'update' ? 'can_update' : 'can_view';
  return (scopes || []).some((scope) => {
    if (!scope?.[permissionKey] || scope.client_id !== clientId) return false;
    if (scope.scope_type === 'client') return true;
    if (scope.scope_type === 'block') return scope.block_id === blockId;
    return scope.scope_type === 'location' && scope.location_id === locationId;
  });
}

export function canViewHospitalTicket(actor, ticket) {
  return isActiveHospitalUser(actor?.user)
    && scopeAllows(actor.scopes, {
      clientId: ticket?.client_id,
      blockId: ticket?.block_id,
      locationId: ticket?.location_id,
      permission: 'view',
    });
}

export function createHospitalAuthMiddleware({ anonClient, serviceClient }) {
  return async function requireHospitalTicketAuth(request, response, next) {
    const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      response.status(401).json({ ok: false, code: 'authentication_required', message: 'Supabase Bearer token required.' });
      return;
    }
    if (!anonClient || !serviceClient) {
      response.status(503).json({ ok: false, code: 'hospital_service_unavailable', message: 'Hospital Ticketing authentication is not configured.' });
      return;
    }
    try {
      const authResult = await anonClient.auth.getUser(token);
      if (authResult.error || !authResult.data?.user) {
        response.status(401).json({ ok: false, code: 'invalid_token', message: 'Invalid or expired access token.' });
        return;
      }
      const userResult = await serviceClient
        .from('hospital_ticket_users')
        .select('*')
        .eq('auth_user_id', authResult.data.user.id)
        .maybeSingle();
      if (userResult.error) throw userResult.error;
      if (!isActiveHospitalUser(userResult.data)) {
        response.status(403).json({ ok: false, code: 'inactive_hospital_profile', message: 'An active Hospital Ticketing profile is required.' });
        return;
      }
      const scopeResult = await serviceClient
        .from('hospital_ticket_user_scopes')
        .select('*')
        .eq('hospital_ticket_user_id', userResult.data.id);
      if (scopeResult.error) throw scopeResult.error;
      request.hospitalActor = {
        authUser: authResult.data.user,
        user: { ...userResult.data, role_code: normalizeHospitalRole(userResult.data.role_code) },
        scopes: scopeResult.data || [],
      };
      next();
    } catch (error) {
      console.warn('[Hospital Ticketing] authentication failed', { code: error?.code || null, message: error?.message || 'unknown' });
      response.status(503).json({ ok: false, code: 'hospital_auth_failed', message: 'Unable to authorize Hospital Ticketing access.' });
    }
  };
}

export const hospitalRoleCodes = ROLE_CODES;
