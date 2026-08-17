const ROLE_CODES = new Set([
  'doctor',
  'hospital_management',
  'housekeeping_supervisor',
  'operations_executive',
  'facility_manager',
  'project_head',
  'hospital_dean',
  'admin',
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
    zonal_head: 'operations_executive',
    facility_manager: 'facility_manager',
    project_head: 'project_head',
    projecthead: 'project_head',
    hospital_dean: 'hospital_dean',
    dean: 'hospital_dean',
    admin: 'admin',
    hospital_admin: 'admin',
  };
  return aliases[key] || key;
}

export function isAdminApplicationRole(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') === 'admin';
}

export function isActiveHospitalUser(user) {
  return Boolean(user?.id && user?.auth_user_id && user?.client_id && user?.is_active === true)
    && ROLE_CODES.has(normalizeHospitalRole(user.role_code));
}

export function hospitalAllowedActions(actor) {
  const role = normalizeHospitalRole(actor?.role_code);
  if (['doctor', 'hospital_management'].includes(role)) {
    return ['create_ticket', 'view_ticket', 'submit_feedback', 'cancel', 'view_client_attachments'];
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
  if (role === 'project_head') {
    return ['view_ticket', 'take_over', 'progress', 'resolve'];
  }
  if (role === 'hospital_dean') {
    return ['view_ticket', 'progress', 'assign_support'];
  }
  if (role === 'admin') {
    return ['view_ticket', 'progress', 'take_over', 'reassign_supervisor', 'assign_support', 'manual_escalation', 'escalate_facility', 'resolve'];
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

function requestedHospitalClientId(request) {
  return String(
    request.headers['x-hospital-client-id']
      || request.query?.client_id
      || request.query?.clientId
      || request.body?.client_id
      || request.body?.clientId
      || '',
  ).trim();
}

function profileDisplayName(profile, authUser) {
  return String(
    profile?.display_name
      || profile?.full_name
      || profile?.employee_code
      || profile?.email
      || authUser?.email
      || 'QPMS Admin',
  ).trim();
}

export async function resolveAdminHospitalActor({ serviceClient, authUser, request }) {
  const profileResult = await serviceClient
    .from('profiles')
    .select('id,auth_user_id,employee_code,full_name,display_name,email,role,status,is_active')
    .eq('auth_user_id', authUser.id)
    .maybeSingle();
  if (profileResult.error) throw profileResult.error;
  const profile = profileResult.data;
  if (!profile || profile.is_active === false || !isAdminApplicationRole(profile.role)) return null;
  const status = String(profile.status || 'active').trim().toLowerCase();
  if (status && status !== 'active') return null;

  const clientsResult = await serviceClient
    .from('hospital_clients')
    .select('id,client_code,client_name,is_active')
    .eq('is_active', true)
    .order('client_name', { ascending: true })
    .limit(100);
  if (clientsResult.error) throw clientsResult.error;
  const clients = clientsResult.data || [];
  if (!clients.length) {
    const error = new Error('No active Hospital client is configured.');
    error.code = 'hospital_client_required';
    throw error;
  }
  const requestedClientId = requestedHospitalClientId(request);
  const selectedClient = requestedClientId
    ? clients.find((client) => String(client.id) === requestedClientId)
    : clients[0];
  if (!selectedClient) {
    const error = new Error('Selected Hospital client is not available to this Admin account.');
    error.code = 'hospital_client_forbidden';
    throw error;
  }

  const upsertResult = await serviceClient
    .from('hospital_ticket_users')
    .upsert({
      auth_user_id: authUser.id,
      client_id: selectedClient.id,
      profile_type: 'internal',
      role_code: 'admin',
      display_name: profileDisplayName(profile, authUser),
      email: String(profile.email || authUser.email || '').trim().toLowerCase(),
      employee_code: profile.employee_code || null,
      is_active: true,
      metadata: {
        source: 'mobile_admin_hospital_access',
        profile_id: profile.id,
        application_role: profile.role,
      },
    }, { onConflict: 'auth_user_id' })
    .select('*')
    .maybeSingle();
  if (upsertResult.error) throw upsertResult.error;
  if (!isActiveHospitalUser(upsertResult.data)) return null;

  const existingScope = await serviceClient
    .from('hospital_ticket_user_scopes')
    .select('*')
    .eq('hospital_ticket_user_id', upsertResult.data.id)
    .eq('client_id', selectedClient.id)
    .eq('scope_type', 'client')
    .is('block_id', null)
    .is('location_id', null)
    .maybeSingle();
  if (existingScope.error) throw existingScope.error;
  let scopes = existingScope.data ? [existingScope.data] : [];
  if (existingScope.data && (existingScope.data.can_view !== true || existingScope.data.can_update !== true)) {
    const scopeResult = await serviceClient
      .from('hospital_ticket_user_scopes')
      .update({
        can_view: true,
        can_create: false,
        can_update: true,
      })
      .eq('id', existingScope.data.id)
      .select('*');
    if (scopeResult.error) throw scopeResult.error;
    scopes = scopeResult.data || [];
  } else if (!existingScope.data) {
    const scopeResult = await serviceClient
      .from('hospital_ticket_user_scopes')
      .insert({
        hospital_ticket_user_id: upsertResult.data.id,
        client_id: selectedClient.id,
        scope_type: 'client',
        block_id: null,
        location_id: null,
        can_view: true,
        can_create: false,
        can_update: true,
      })
      .select('*');
    if (scopeResult.error) throw scopeResult.error;
    scopes = scopeResult.data || [];
  }

  return {
    authUser,
    user: { ...upsertResult.data, role_code: normalizeHospitalRole(upsertResult.data.role_code) },
    scopes,
    available_clients: clients,
    selected_client: selectedClient,
  };
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
        const adminActor = await resolveAdminHospitalActor({ serviceClient, authUser: authResult.data.user, request });
        if (adminActor) {
          request.hospitalActor = adminActor;
          next();
          return;
        }
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
