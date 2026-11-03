import { resolveCurrentUserAccess } from './accessControlService.js';
import { isInitialRetailAdmin } from './retailInitialAdminAccess.js';

export const RETAIL_CLIENT_ID = '369d2d5f-396f-49f9-a47d-bfbc8f7cb922';
export const RETAIL_VERTICAL_ID = '8bbf5511-1e15-4da4-895e-8546cd14a799';
export const CLEANING_CONTRACT = 'retail-cleaning.v1';
const states = new Set(['TN', 'PY', 'KA', 'KL', 'TG', 'AP-1', 'AP-2']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const cleaningError = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });
export function geographicState(value) {
  const key = String(value || '').trim().toUpperCase();
  return key === 'KN' ? 'KA' : states.has(key) ? key : null;
}
function day(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw cleaningError(400, 'invalid_date', 'Use a valid YYYY-MM-DD date.');
  }
  return value;
}
export function cleaningFilters(query = {}, now = new Date()) {
  const today = new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);
  let from = query.from || today, to = query.to || new Date(Date.parse(today) + 30 * 86400000).toISOString().slice(0, 10);
  if (query.month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(query.month) || query.from || query.to) throw cleaningError(400, 'invalid_month', 'Use month or from/to, not both.');
    from = `${query.month}-01`;
    const date = new Date(from); date.setUTCMonth(date.getUTCMonth() + 1); date.setUTCDate(0);
    to = date.toISOString().slice(0, 10);
  }
  from = day(from); to = day(to);
  if (to < from || Date.parse(to) - Date.parse(from) > 92 * 86400000) throw cleaningError(400, 'invalid_range', 'Date range must be between 1 and 93 days.');
  const page = Number(query.page || 1), limit = Number(query.limit || 50);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw cleaningError(400, 'invalid_pagination', 'Use page >= 1 and limit between 1 and 100.');
  const status = query.status === 'NotDone' ? 'Not Done' : query.status;
  if (status && !['Planned', 'Scheduled', 'Completed', 'Not Done', 'Cancelled'].includes(status)) throw cleaningError(400, 'invalid_status', 'Unknown schedule status.');
  return { from, to, page, limit, status };
}

// Scope rows have already been checked for activation/expiry by the canonical resolver.
// Within each grant, geographic state AND any narrower store constraints must match.
export function assignmentAllowsStore(assignment, store, permission = 'deep_cleaning.view') {
  if (assignment.business_vertical?.id !== RETAIL_VERTICAL_ID || assignment.client?.id !== RETAIL_CLIENT_ID || assignment.module?.code !== 'deep_cleaning' || !(assignment.permissions || []).includes('deep_cleaning.view') || !(assignment.permissions || []).includes(permission)) return false;
  const scopes = assignment.scopes || [];
  if (!scopes.length || !geographicState(store.state)) return false;
  const stateScopes = scopes.filter(s => s.scope_type === 'state');
  const storeScopes = scopes.filter(s => s.scope_type === 'store');
  const broad = scopes.some(s => s.scope_type === 'global' || (['client', 'all_client'].includes(s.scope_type) && s.scope_id === RETAIL_CLIENT_ID));
  // Unsupported branch/zone/site constraints cannot silently become broader access.
  if (scopes.some(s => !['state', 'store', 'global', 'client', 'all_client', 'business_vertical'].includes(s.scope_type))) return false;
  const stateMatch = stateScopes.some(s => geographicState(s.scope_code || s.scope_text) === geographicState(store.state));
  const storeMatch = storeScopes.some(s => s.scope_id === store.id || String(s.scope_code || s.scope_text || '').trim().toUpperCase() === String(store.store_code).trim().toUpperCase());
  return (stateScopes.length ? stateMatch : broad || storeMatch) && (!storeScopes.length || storeMatch);
}

async function resolveCleaningViewerScope(client, profile, { resolveAccess = resolveCurrentUserAccess, permission = 'deep_cleaning.view' } = {}) {
  const admin = isInitialRetailAdmin(profile);
  const result = admin ? {source:'unified', access_granted:true} : await resolveAccess({ client, authUser: { id: profile?.auth_user_id }, profile, requestedModule: 'deep_cleaning', requestedPermission: permission, requestedClientId: RETAIL_CLIENT_ID });
  if (result.source !== 'unified' || !result.access_granted) throw cleaningError(403, 'cleaning_scope_denied', 'An explicit Reliance Retail Deep Cleaning grant is required.');
  const stores = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from('reliance_retail_store_master').select('id,store_code,state,status').range(offset, offset + 499);
    if (error) throw error;
    stores.push(...(data || []).filter(s => s.status === 'Active' && (admin || (result.assignments || []).some(a => assignmentAllowsStore(a, s, permission)))));
    if ((data || []).length < 500) break;
  }
  return {stores, exportAllowed:admin || result.assignments.some(a=>a.permissions.includes('deep_cleaning.export'))};
}

export async function cleaningViewerStoreIds(...args) { return (await resolveCleaningViewerScope(...args)).stores; }

export async function listDeliveredCleaningSchedules(client, profile, query = {}, { scheduleId = null, ...options } = {}) {
  if (!profile?.id || !profile.auth_user_id || profile.is_active === false || String(profile.status).toUpperCase() !== 'ACTIVE') throw cleaningError(403, 'inactive_profile', 'A verified active profile is required.');
  if (scheduleId && !uuid.test(scheduleId)) throw cleaningError(400, 'invalid_schedule_id', 'Invalid schedule ID.');
  const filters = cleaningFilters(query);
  const fo = ['FO', 'FIELDOFFICER'].includes(String(profile.role || '').toUpperCase().replace(/[^A-Z]/g, ''));
  if(fo && options.permission==='deep_cleaning.export') throw cleaningError(403,'export_denied','An explicit viewer export permission is required.');
  const viewer = fo ? null : await resolveCleaningViewerScope(client, profile, options);
  const stores = viewer?.stores;
  const { data, error } = await client.rpc('rpc_retail_cleaning_delivery_v1', {
    p_actor: profile.id, p_auth: profile.auth_user_id, p_stores: stores?.map(s => s.id) ?? null,
    p_from: filters.from, p_to: filters.to, p_schedule: scheduleId,
  });
  if (error) throw cleaningError(error.code === '42501' ? 403 : error.code === '22023' ? 400 : 503, 'cleaning_delivery_unavailable', error.code === '42501' ? 'Schedule access denied.' : 'Schedule delivery is not available.');
  if (data?.contract_version !== CLEANING_CONTRACT || !Array.isArray(data.rows)) throw cleaningError(503, 'incompatible_schedule_contract', 'Schedule delivery requires a compatible backend.');
  let rows = data.rows;
  if (filters.status) rows = rows.filter(r => filters.status === 'Scheduled' ? ['Scheduled', 'Planned'].includes(r.status) : r.status === filters.status);
  if (scheduleId) {
    if (!rows.length) throw cleaningError(404, 'schedule_not_found', 'Schedule not found.');
    return { contract_version: CLEANING_CONTRACT, schedule: rows[0] };
  }
  return { contract_version: CLEANING_CONTRACT, rows: rows.slice((filters.page - 1) * filters.limit, filters.page * filters.limit), pagination: { page: filters.page, limit: filters.limit, total: rows.length }, filters, capabilities: { view: true, export:viewer?.exportAllowed===true, execute: fo, create: false, edit: false, delete: false, assign: false } };
}

export async function scheduledCleaningCommand(client, profile, action, payload) {
  const { data, error } = await client.rpc('rpc_retail_cleaning_submission_v1', { p_actor: profile.id, p_auth: profile.auth_user_id, p_action: action, p_data: payload });
  if (error) throw cleaningError(error.code === '42501' ? 403 : error.code === '22023' ? 400 : error.code === '23505' || error.code === '40001' ? 409 : 503, 'scheduled_submission_rejected', error.code === '42501' ? 'You cannot execute this schedule.' : error.code === '22023' ? 'Invalid scheduled submission.' : 'Schedule changed or delivery is unavailable. Refresh before retrying.');
  return data;
}
