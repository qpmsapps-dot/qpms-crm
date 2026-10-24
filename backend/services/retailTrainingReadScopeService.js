import { resolveCurrentUserAccess } from './accessControlService.js';
import { normalizedStateKey, stateScopeQueryValues } from './workMappingScope.js';

const key = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const retail = value => ['RELIANCE', 'RELIANCERETAIL'].includes(key(value));
const preservedRoles = new Set(['FO', 'FIELDOFFICER', 'ADMIN', 'QPMSADMIN', 'DEVELOPER', 'DEV', 'ITADMIN', 'MANAGEMENTITADMIN', 'MD', 'COO', 'EXECUTIVEASSISTANT', 'MANAGEMENT', 'GM', 'SOUTHHEAD', 'BUSINESSHEAD', 'BRANCHHEAD', 'KAM', 'OPERATIONSMANAGER', 'OPERATIONMANAGER', 'OM', 'MANAGER']);
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));

export function isRetailHkTrainingReader(profile) {
  return !preservedRoles.has(key(profile?.role))
    && [profile?.role, profile?.designation, profile?.department].some(value => ['HKMIS', 'HOUSEKEEPINGMIS'].includes(key(value)));
}

function denied() {
  return Object.assign(new Error('Verified Reliance Retail Training state and store assignments are required.'), { statusCode: 403, code: 'training_scope_unverified' });
}

export async function resolveRetailHkTrainingScope(client, profile) {
  if (!isRetailHkTrainingReader(profile)) return null;
  if (!retail(profile?.business) || !profile?.id || profile.is_active !== true || key(profile.status || 'Active') !== 'ACTIVE') throw denied();
  const access = await resolveCurrentUserAccess({ client, profile, authUser: { id: profile.auth_user_id }, requestedModule: 'training' });
  if (!access.access_granted || access.source !== 'unified') throw denied();
  // State and store must be granted together by the same effective assignment.
  const grants = (access.assignments || []).filter(a => retail(a.client?.code)).map(a => ({
    states: (a.scopes || []).filter(s => s.scope_type === 'state').map(s => normalizedStateKey(s.scope_code || s.scope_text)).filter(s => s && !['ALL', 'ALLSTATES', '*'].includes(s)),
    stores: (a.scopes || []).filter(s => s.scope_type === 'store' && uuid(s.scope_id)).map(s => s.scope_id),
  })).filter(g => g.states.length && g.stores.length);
  const ids = [...new Set(grants.flatMap(g => g.stores))];
  if (!ids.length) throw denied();
  const { data, error } = await client.from('reliance_retail_store_master').select('id,store_code,state,status,zone_id')
    .in('id', ids).eq('status', 'Active');
  if (error) throw error;
  const stores = (data || []).filter(s => grants.some(g => g.stores.includes(s.id) && g.states.includes(normalizedStateKey(s.state))));
  if (!stores.length) throw denied();
  // Legacy store IDs are resolved through matching verified Retail codes and state.
  const legacy = await client.from('store_master').select('id,store_code,state,business,status')
    .in('store_code', stores.map(s => s.store_code)).eq('status', 'Active');
  if (legacy.error) throw legacy.error;
  const legacyStores = (legacy.data || []).filter(s => retail(s.business)
    && stores.some(r => r.store_code === s.store_code && normalizedStateKey(r.state) === normalizedStateKey(s.state)));
  return { retailStoreIds: stores.map(s => s.id), legacyStoreIds: legacyStores.map(s => s.id), stores, legacyStores,
    states: [...new Set(stores.flatMap(s => [s.state, ...stateScopeQueryValues(s.state)]))] };
}

export function narrowRetailTrainingScope(scope, retailIds) {
  const stores = scope.stores.filter(s => retailIds.includes(s.id));
  const legacyStores = scope.legacyStores.filter(s => stores.some(r => r.store_code === s.store_code && normalizedStateKey(r.state) === normalizedStateKey(s.state)));
  return { stores, legacyStores, retailStoreIds: stores.map(s => s.id), legacyStoreIds: legacyStores.map(s => s.id),
    states: [...new Set(stores.flatMap(s => [s.state, ...stateScopeQueryValues(s.state)]))] };
}

export function applyRetailTrainingStoreScope(query, scope) {
  const parts = [];
  if (scope.retailStoreIds.length) parts.push(`retail_store_id.in.(${scope.retailStoreIds.join(',')})`);
  // When both links exist, the canonical Retail link decides access. A legacy
  // allowed link must never override an unassigned canonical Retail store.
  if (scope.legacyStoreIds.length) parts.push(`and(retail_store_id.is.null,store_id.in.(${scope.legacyStoreIds.join(',')}))`);
  if (!parts.length) throw denied();
  return query.or(parts.join(',')).in('state_snapshot', scope.states).eq('status', 'submitted');
}

export function retailTrainingFoCodes(profiles) {
  return [...new Set(profiles.filter(p => retail(p.business) && ['FO', 'FIELDOFFICER'].includes(key(p.role)))
    .map(p => String(p.employee_code || p.username || '').trim().toUpperCase()).filter(Boolean))];
}

export async function retailTrainingFoProfiles(client) {
  const profiles = [];
  for (let start = 0; start < 100000; start += 1000) {
    const { data, error } = await client.from('profiles').select('id,employee_code,username,role,business')
      .order('id').range(start, start + 999);
    if (error) throw error;
    profiles.push(...(data || []).filter(p => retail(p.business) && ['FO', 'FIELDOFFICER'].includes(key(p.role))));
    if ((data || []).length < 1000) return profiles;
  }
  throw Object.assign(new Error('Training reporting scope exceeds the safe reporting bound.'), { statusCode: 503, code: 'training_scope_too_large' });
}

// Read all matching envelopes; never silently truncate a scoped count.
export async function retailTrainingEnvelopeIds(client, codes) {
  if (!codes.length) return [];
  const ids = [];
  for (let start = 0; start < 100000; start += 1000) {
    const { data, error } = await client.from('fo_activity_submissions').select('id')
      .eq('activity_type', 'training').in('employee_code', codes).order('id').range(start, start + 999);
    if (error) throw error;
    ids.push(...(data || []).map(row => row.id));
    if ((data || []).length < 1000) return [...new Set(ids)];
  }
  throw Object.assign(new Error('Training reporting scope exceeds the safe reporting bound.'), { statusCode: 503, code: 'training_scope_too_large' });
}
