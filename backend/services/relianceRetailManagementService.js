import { resolveTrainingReadScope, RELIANCE_TRAINING_CLIENT_ID } from './trainingAccessService.js';
import { isRetailHkTrainingReader, applyRetailTrainingStoreScope, narrowRetailTrainingScope, retailTrainingEnvelopeIds } from './retailTrainingReadScopeService.js';

const norm = (value) => String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
const text = (value) => String(value ?? '').trim();
const ADMIN = new Set(['ADMIN', 'QPMSADMIN', 'DEVELOPER', 'DEV', 'MD', 'COO']);
const HK = new Set(['HKMIS', 'HOUSEKEEPINGMIS']);
const TECH = new Set(['TECHNICALMIS', 'TECHMIS']);
const KAM = new Set(['KAM']);
const RETAIL_STORE_REGIONS = new Set(['TN', 'PY', 'KA', 'KL', 'AP-1', 'AP-2']);

export function retailAccess(profile) {
  const keys = [profile?.role, profile?.designation, profile?.department].map(norm);
  const admin = keys.some((key) => ADMIN.has(key));
  const retail = ['RELIANCE', 'RELIANCERETAIL'].includes(norm(profile?.business));
  const hk = retail && keys.some((key) => HK.has(key));
  const technical = retail && keys.some((key) => TECH.has(key));
  const kam = retail && keys.some((key) => KAM.has(key));
  return {
    allowed: admin || hk || technical || kam,
    dashboard: admin || hk || technical || kam,
    stores: admin || hk,
    zones: admin || hk,
    deepCleaning: admin || hk,
    training: admin || hk,
    faultTracker: admin || technical,
    oos: admin || technical,
    cmpm: admin || kam,
    thermography: admin || kam,
    manpower: admin || hk,
  };
}

export function assertRetailAccess(profile, capability = 'dashboard') {
  const access = retailAccess(profile);
  if (!profile?.id) throw Object.assign(new Error('Authentication is required.'), { statusCode: 401 });
  if (!access[capability]) {
    const error = new Error('Reliance Retail access is not authorized for this account.');
    error.statusCode = 403; error.code = 'retail_access_forbidden'; throw error;
  }
  return access;
}

function page(input) {
  const size = Math.max(1, Math.min(Number(input.limit) || 50, 500));
  const number = Math.max(1, Number(input.page) || 1);
  return { size, from: (number - 1) * size, to: number * size - 1, number };
}

export async function listRetailStores(client, profile, input = {}) {
  assertRetailAccess(profile, 'stores');
  const p = page(input);
  let query = client.from('reliance_retail_store_operational_ownership').select('*', { count: 'exact' })
    .order('store_code').range(p.from, p.to);
  if (text(input.state)) query = query.eq('state', text(input.state));
  if (text(input.zone_id)) query = query.eq('zone_id', text(input.zone_id));
  if (text(input.fo_profile_id)) query = query.eq('current_responsible_fo_profile_id', text(input.fo_profile_id));
  if (text(input.format)) query = query.eq('store_format', text(input.format));
  if (text(input.status)) query = query.eq('status', text(input.status));
  if (text(input.q)) query = query.or(`store_code.ilike.%${text(input.q).replace(/[,%()]/g, '')}%,store_name.ilike.%${text(input.q).replace(/[,%()]/g, '')}%`);
  const { data, error, count } = await query;
  if (error) throw error;
  const ids = (data || []).map((row) => row.id);
  const budgets = ids.length
    ? await client.from('reliance_retail_store_manpower_budgets').select('*,profiles:updated_by_profile_id(employee_code,full_name)').in('retail_store_id', ids).order('updated_at', { ascending: false })
    : { data: [], error: null };
  if (budgets.error) throw budgets.error;
  const latest = new Map();
  for (const budget of budgets.data || []) if (!latest.has(budget.retail_store_id)) latest.set(budget.retail_store_id, budget);
  return { rows: (data || []).map((row) => ({ ...row, manpower_budget: latest.get(row.id) || null })), page: p.number, limit: p.size, total: count || 0 };
}

export async function listRetailZones(client, profile, { includeInactive = false } = {}) {
  assertRetailAccess(profile, 'dashboard');
  let query = client.from('reliance_retail_zones').select('*').order('zone_code');
  if (!includeInactive) query = query.eq('status', 'Active');
  const [{ data: zones, error }, { data: assignments, error: assignmentError }, { data: stores, error: storeError }] = await Promise.all([
    query,
    client.from('reliance_retail_zone_fo_assignments').select('*,profiles:fo_profile_id(id,employee_code,full_name,status,is_active)').eq('status', 'Active').is('effective_to', null).limit(1000),
    client.from('reliance_retail_store_master').select('id,zone_id,status').limit(5000),
  ]);
  if (error || assignmentError || storeError) throw error || assignmentError || storeError;
  return (zones || []).map((zone) => ({
    ...zone,
    assignment: (assignments || []).find((item) => item.zone_id === zone.id) || null,
    store_count: (stores || []).filter((store) => store.zone_id === zone.id).length,
    active_store_count: (stores || []).filter((store) => store.zone_id === zone.id && store.status === 'Active').length,
  }));
}

async function audit(client, profile, action, entityType, entityId, before, after) {
  const { error } = await client.from('reliance_retail_management_audit').insert({ action, entity_type: entityType, entity_id: entityId, actor_profile_id: profile.id, before_state: before, after_state: after });
  if (error) throw error;
}

async function loadRetailZoneAssignment(client, zoneId) {
  const assignment = await client.from('reliance_retail_zone_fo_assignments')
    .select('fo_profile_id,fo_employee_code,profiles:fo_profile_id(full_name)')
    .eq('zone_id', zoneId).eq('status', 'Active').is('effective_to', null).single();
  if (assignment.error) {
    throw Object.assign(new Error('The selected Zone must have an active responsible FO before a store can be assigned.'), { statusCode: 400, cause: assignment.error });
  }
  return assignment.data;
}

function applyZoneAssignment(payload, assignment) {
  return {
    ...payload,
    assigned_fo_profile_id: assignment.fo_profile_id,
    assigned_fo_employee_code: assignment.fo_employee_code,
    assigned_fo_name_snapshot: assignment.profiles?.full_name || assignment.fo_employee_code,
  };
}

export async function saveRetailZone(client, profile, input = {}) {
  assertRetailAccess(profile, 'zones');
  const id = text(input.id);
  const payload = { zone_code: text(input.zone_code).toUpperCase(), zone_name: text(input.zone_name), state: text(input.state) || null, status: input.status === 'Inactive' ? 'Inactive' : 'Active', updated_at: new Date().toISOString() };
  if (!payload.zone_code || !payload.zone_name) throw Object.assign(new Error('Zone code and name are required.'), { statusCode: 400 });
  let before = null; let result;
  if (id) {
    const existing = await client.from('reliance_retail_zones').select('*').eq('id', id).single();
    if (existing.error) throw existing.error; before = existing.data;
    result = await client.from('reliance_retail_zones').update(payload).eq('id', id).select().single();
  } else result = await client.from('reliance_retail_zones').insert({ ...payload, created_by_profile_id: profile.id }).select().single();
  if (result.error) throw result.error;
  await audit(client, profile, id ? 'ZONE_UPDATED' : 'ZONE_CREATED', 'zone', result.data.id, before, result.data);
  return result.data;
}

export async function assignZoneFo(client, profile, zoneId, foProfileId, effectiveFrom) {
  assertRetailAccess(profile, 'zones');
  const fo = await client.from('profiles').select('id,employee_code,business,role,is_active,status').eq('id', foProfileId).single();
  if (fo.error) throw fo.error;
  if (!fo.data.is_active || !['RELIANCE', 'RELIANCERETAIL'].includes(norm(fo.data.business)) || !['FO', 'FIELDOFFICER'].includes(norm(fo.data.role))) {
    throw Object.assign(new Error('The selected employee is not an active Reliance Retail FO.'), { statusCode: 400 });
  }
  const now = effectiveFrom || new Date().toISOString();
  const current = await client.from('reliance_retail_zone_fo_assignments').select('*').eq('zone_id', zoneId).eq('status', 'Active').is('effective_to', null).maybeSingle();
  if (current.error) throw current.error;
  if (current.data?.fo_profile_id === foProfileId) return current.data;
  if (current.data) {
    const ended = await client.from('reliance_retail_zone_fo_assignments').update({ status: 'Ended', effective_to: now }).eq('id', current.data.id);
    if (ended.error) throw ended.error;
  }
  const created = await client.from('reliance_retail_zone_fo_assignments').insert({ zone_id: zoneId, fo_profile_id: foProfileId, fo_employee_code: fo.data.employee_code, effective_from: now, assigned_by_profile_id: profile.id }).select().single();
  if (created.error) throw created.error;
  await audit(client, profile, 'ZONE_FO_REASSIGNED', 'zone', zoneId, current.data, created.data);
  return created.data;
}

export async function syncFoZones(client, profile, foProfileId, zoneIds = []) {
  assertRetailAccess(profile, 'zones');
  const unique = [...new Set((zoneIds || []).map(text).filter(Boolean))];
  const { data, error } = await client.rpc('rpc_sync_reliance_retail_fo_zones', {
    p_actor_profile_id: profile.id, p_fo_profile_id: foProfileId, p_zone_ids: unique,
  });
  if (error) throw error;
  return data;
}

export async function moveRetailStore(client, profile, storeId, zoneId, reason) {
  assertRetailAccess(profile, 'stores');
  const before = await client.from('reliance_retail_store_master').select('*').eq('id', storeId).single();
  if (before.error) throw before.error;
  const cleanZoneId = text(zoneId);
  if (!cleanZoneId) throw Object.assign(new Error('A Zone is required when assigning an FO-managed Retail store.'), { statusCode: 400 });
  const assignment = await loadRetailZoneAssignment(client, cleanZoneId);
  const updated = await client.from('reliance_retail_store_master').update(applyZoneAssignment({
    zone_id: cleanZoneId,
    metadata: { ...(before.data.metadata || {}), operational_model: 'FO_ZONE_ASSIGNED' },
    updated_at: new Date().toISOString(),
  }, assignment)).eq('id', storeId).select().single();
  if (updated.error) throw updated.error;
  const history = await client.from('reliance_retail_store_zone_history').insert({ retail_store_id: storeId, previous_zone_id: before.data.zone_id, new_zone_id: cleanZoneId, changed_by_profile_id: profile.id, reason: text(reason) || null });
  if (history.error) throw history.error;
  return updated.data;
}

function retailSupervisorDetails(input = {}, existingMetadata = {}) {
  const supplied = input.supervisor && typeof input.supervisor === 'object' ? input.supervisor : {};
  const existing = existingMetadata?.supervisor && typeof existingMetadata.supervisor === 'object'
    ? existingMetadata.supervisor
    : {};
  const value = (flatKey, nestedKey) => text(input[flatKey] ?? supplied[nestedKey] ?? existing[nestedKey]) || null;
  return {
    name: value('supervisor_name', 'name'),
    employee_code: value('supervisor_employee_code', 'employee_code'),
    phone: value('supervisor_phone', 'phone')?.replace(/\D/g, '') || null,
    email: value('supervisor_email', 'email')?.toLowerCase() || null,
  };
}

export function normalizeRetailStoreInput(input = {}, existingMetadata = {}) {
  const state = text(input.state).toUpperCase();
  const zoneId = text(input.zone_id) || null;
  const existingSupervisorOnly = norm(existingMetadata?.operational_model) === 'SUPERVISORONLY';
  const requestedSupervisorOnly = input.supervisor_only === true || norm(input.operational_model) === 'SUPERVISORONLY';
  const supervisorOnly = !zoneId && (requestedSupervisorOnly || existingSupervisorOnly);
  const supervisor = retailSupervisorDetails(input, existingMetadata);
  const status = input.status === 'Inactive' ? 'Inactive' : 'Active';
  if (!text(input.store_code) || !text(input.store_name) || !state) {
    throw Object.assign(new Error('Store Code, Store Name and State are required.'), { statusCode: 400 });
  }
  if (!RETAIL_STORE_REGIONS.has(state)) {
    throw Object.assign(new Error('The Retail Store region is not supported.'), { statusCode: 400, code: 'retail_store_region_invalid' });
  }
  if (requestedSupervisorOnly && zoneId) {
    throw Object.assign(new Error('Supervisor-only stores cannot have a Zone assignment.'), { statusCode: 400 });
  }
  if (supervisorOnly && !supervisor.name) {
    throw Object.assign(new Error('Supervisor details are required for a supervisor-only store.'), { statusCode: 400, code: 'retail_supervisor_details_required' });
  }
  if (status === 'Active' && !zoneId && !supervisorOnly) {
    throw Object.assign(new Error('A Zone is required before activating an FO-managed Retail store.'), { statusCode: 400 });
  }
  const metadata = {
    ...(existingMetadata || {}),
    source: existingMetadata?.source || 'WEB_RETAIL_STORE_MASTER',
    operational_model: supervisorOnly ? 'SUPERVISOR_ONLY' : 'FO_ZONE_ASSIGNED',
    supervisor,
  };
  const payload = {
    store_code: text(input.store_code).toUpperCase(),
    store_name: text(input.store_name),
    state,
    city: text(input.city) || null,
    store_format: text(input.store_format) || null,
    zone_id: supervisorOnly ? null : zoneId,
    status,
    metadata,
    updated_at: new Date().toISOString(),
  };
  if (supervisorOnly) {
    payload.assigned_fo_profile_id = null;
    payload.assigned_fo_employee_code = null;
    payload.assigned_fo_name_snapshot = null;
    payload.assigned_fo_phone_snapshot = null;
  }
  return { payload, supervisorOnly };
}

export async function saveRetailStore(client, profile, input = {}) {
  assertRetailAccess(profile, 'stores');
  const id = text(input.id);
  let before = null; let result;
  if (id) {
    const found = await client.from('reliance_retail_store_master').select('*').eq('id', id).single(); if (found.error) throw found.error; before = found.data;
    const normalized = normalizeRetailStoreInput(input, before.metadata);
    let updatePayload = normalized.payload;
    if (!normalized.supervisorOnly && updatePayload.zone_id) {
      updatePayload = applyZoneAssignment(updatePayload, await loadRetailZoneAssignment(client, updatePayload.zone_id));
    }
    result = await client.from('reliance_retail_store_master').update(updatePayload).eq('id', id).select().single();
  } else {
    const { payload, supervisorOnly } = normalizeRetailStoreInput(input);
    if (!supervisorOnly && !payload.zone_id) {
      throw Object.assign(new Error('A Zone is required when creating an FO-managed Retail store.'), { statusCode: 400 });
    }
    let assignment = null;
    if (!supervisorOnly) {
      assignment = await loadRetailZoneAssignment(client, payload.zone_id);
    }
    result = await client.from('reliance_retail_store_master').insert({
      ...payload,
      latitude: null,
      longitude: null,
      gps_accuracy: null,
      location_status: 'LOCATION_PENDING',
      ...(supervisorOnly ? {} : {
        assigned_fo_profile_id: assignment.fo_profile_id,
        assigned_fo_employee_code: assignment.fo_employee_code,
        assigned_fo_name_snapshot: assignment.profiles?.full_name || assignment.fo_employee_code,
      }),
    }).select().single();
  }
  if (result.error) throw result.error;
  await audit(client, profile, id ? 'STORE_UPDATED' : 'STORE_CREATED', 'store', result.data.id, before, result.data);
  const previousZoneId = before?.zone_id || null;
  const newZoneId = result.data.zone_id || null;
  if (previousZoneId !== newZoneId) await client.from('reliance_retail_store_zone_history').insert({ retail_store_id: result.data.id, previous_zone_id: previousZoneId, new_zone_id: newZoneId, changed_by_profile_id: profile.id, reason: id ? 'Store Master edit' : 'Initial assignment' });
  return result.data;
}

export async function saveManpowerBudget(client, profile, storeId, input = {}) {
  assertRetailAccess(profile, 'manpower');
  const period = text(input.budget_period);
  if (!period) throw Object.assign(new Error('Budget period is required.'), { statusCode: 400 });
  const payload = { retail_store_id: storeId, budget_period: period, hk_budget: input.hk_budget === '' || input.hk_budget == null ? null : Number(input.hk_budget), mepc_budget: input.mepc_budget === '' || input.mepc_budget == null ? null : Number(input.mepc_budget), updated_by_profile_id: profile.id, updated_at: new Date().toISOString() };
  const result = await client.from('reliance_retail_store_manpower_budgets').upsert(payload, { onConflict: 'retail_store_id,budget_period' }).select().single();
  if (result.error) throw result.error;
  await audit(client, profile, 'MANPOWER_BUDGET_SAVED', 'store', storeId, null, result.data);
  return result.data;
}

export async function listRetailDeepCleaningRecords(client, profile) {
  assertRetailAccess(profile, 'deepCleaning');
  const submissions = await client.from('client_deep_cleaning_submissions').select('*')
    .in('business', ['Reliance Retail', 'Reliance']).order('submitted_at', { ascending: false }).limit(1000);
  if (submissions.error) throw submissions.error;
  const submissionIds = (submissions.data || []).map((row) => row.id);
  const storeCodes = [...new Set((submissions.data || []).map((row) => row.store_code).filter(Boolean))];
  const employeeCodes = [...new Set((submissions.data || []).map((row) => row.submitted_by_employee_code).filter(Boolean))];
  const [uploads, stores, profiles] = await Promise.all([
    submissionIds.length ? client.from('client_deep_cleaning_uploads').select('*').in('submission_id', submissionIds).eq('upload_status', 'uploaded').limit(1500) : { data: [], error: null },
    storeCodes.length ? client.from('reliance_retail_store_master').select('id,store_code,store_name,state,city,store_format,status,latitude,longitude,gps_accuracy,metadata').in('store_code', storeCodes).limit(1000) : { data: [], error: null },
    employeeCodes.length ? client.from('profiles').select('employee_code,username,full_name,display_name,business,state,role,designation,department').in('employee_code', employeeCodes).limit(500) : { data: [], error: null },
  ]);
  if (uploads.error || stores.error || profiles.error) throw uploads.error || stores.error || profiles.error;
  const uploadsWithSignedUrls = await Promise.all((uploads.data || []).map(async (row) => {
    const signed = await client.storage
      .from(row.storage_bucket)
      .createSignedUrl(row.storage_path, 10 * 60);
    if (signed.error) throw signed.error;
    return { ...row, signed_url: signed.data?.signedUrl || null };
  }));
  return {
    submissions: (submissions.data || []).map((row) => ({
      ...row, employee_code: row.submitted_by_employee_code, activity_type: 'deep_cleaning',
      remarks: row.remarks, submitted_at: row.submitted_at || row.created_at,
      metadata: { ...(row.metadata || {}), business: 'Reliance Retail', store_name: row.store_name, state: row.state, city: row.city },
    })),
    uploads: uploadsWithSignedUrls.map((row) => ({
      ...row, activity_type: 'deep_cleaning', upload_role: row.upload_type,
      file_url: row.storage_path, file_name: row.original_filename, file_type: row.mime_type,
      storage_bucket: row.storage_bucket, uploaded_at: row.uploaded_at || row.created_at,
      metadata: { ...(row.metadata || {}), business: 'Reliance Retail' },
    })),
    stores: (stores.data || []).map((row) => ({ ...row, business: 'Reliance Retail', client_name: 'Reliance Retail' })),
    profiles: profiles.data || [], visits: [],
  };
}

const DEEP_CLEANING_SCHEDULE_SELECT = [
  'id',
  'retail_store_id',
  'scheduled_date',
  'assigned_fo_profile_id',
  'status',
  'not_done_reason',
  'completed_at',
  'source_type',
  'source_reference',
  'created_by_profile_id',
  'metadata',
  'created_at',
  'updated_at',
  'store:reliance_retail_store_master!client_deep_cleaning_schedules_retail_store_id_fkey(id,store_code,store_name,state,city,store_format,status)',
  'assigned_fo:profiles!client_deep_cleaning_schedules_assigned_fo_profile_id_fkey(id,employee_code,full_name,role,designation,business,is_active,status)',
].join(',');

function scheduleDate(value) {
  const clean = text(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean);
  if (!match) {
    throw Object.assign(new Error('Scheduled Date must be YYYY-MM-DD.'), {
      statusCode: 400,
      code: 'invalid_scheduled_date',
    });
  }
  const parsed = new Date(`${clean}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== clean) {
    throw Object.assign(new Error('Scheduled Date is not a valid calendar date.'), {
      statusCode: 400,
      code: 'invalid_scheduled_date',
    });
  }
  return clean;
}

function scheduleSourceReference(storeId, date) {
  return `schedule:${storeId}:${date}`;
}

async function loadRetailScheduleStore(client, storeCode) {
  const code = text(storeCode);
  if (!code) {
    throw Object.assign(new Error('Store Code is required.'), {
      statusCode: 400,
      code: 'store_code_required',
    });
  }
  const { data, error } = await client
    .from('reliance_retail_store_master')
    .select('id,store_code,store_name,state,city,store_format,status')
    .ilike('store_code', code)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== 'Active') {
    throw Object.assign(new Error('Active Reliance Retail Store was not found.'), {
      statusCode: 400,
      code: 'invalid_retail_store',
    });
  }
  return data;
}

async function loadRetailScheduleFo(client, profileId) {
  const id = text(profileId);
  if (!id) {
    throw Object.assign(new Error('Assigned FO is required.'), {
      statusCode: 400,
      code: 'assigned_fo_required',
    });
  }
  const { data, error } = await client
    .from('profiles')
    .select('id,employee_code,full_name,role,designation,business,is_active,status')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (
    !data
    || data.is_active !== true
    || !['RELIANCE', 'RELIANCERETAIL'].includes(norm(data.business))
    || !['FO', 'FIELDOFFICER'].includes(norm(data.role))
  ) {
    throw Object.assign(new Error('The selected employee is not an active Reliance Retail FO.'), {
      statusCode: 400,
      code: 'invalid_assigned_fo',
    });
  }
  return data;
}

async function findDuplicateRetailSchedule(client, storeId, date) {
  const { data, error } = await client
    .from('client_deep_cleaning_schedules')
    .select('id,status')
    .eq('retail_store_id', storeId)
    .eq('scheduled_date', date)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function loadManagedRetailSchedule(client, id) {
  const scheduleId = text(id);
  if (!scheduleId) {
    throw Object.assign(new Error('Schedule ID is required.'), {
      statusCode: 400,
      code: 'schedule_id_required',
    });
  }
  const { data, error } = await client
    .from('client_deep_cleaning_schedules')
    .select(DEEP_CLEANING_SCHEDULE_SELECT)
    .eq('id', scheduleId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw Object.assign(new Error('Deep Cleaning schedule was not found.'), {
      statusCode: 404,
      code: 'schedule_not_found',
    });
  }
  return data;
}

export async function listRetailDeepCleaningSchedules(client, profile, input = {}) {
  assertRetailAccess(profile, 'deepCleaning');
  const p = page(input);
  let query = client
    .from('client_deep_cleaning_schedules')
    .select(DEEP_CLEANING_SCHEDULE_SELECT, { count: 'exact' })
    .order('scheduled_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(p.from, p.to);
  if (text(input.status)) query = query.eq('status', text(input.status));
  if (text(input.fo_profile_id)) {
    query = query.eq('assigned_fo_profile_id', text(input.fo_profile_id));
  }
  const range = monthRange(input.month);
  if (range) {
    query = query
      .gte('scheduled_date', range.from)
      .lt('scheduled_date', range.to);
  }
  const { data, error, count } = await query;
  if (error) throw error;
  return {
    rows: data || [],
    pagination: { page: p.number, limit: p.size, total: count || 0 },
  };
}

export async function createRetailDeepCleaningSchedule(client, profile, input = {}) {
  assertRetailAccess(profile, 'deepCleaning');
  const [store, assignedFo] = await Promise.all([
    loadRetailScheduleStore(client, input.store_code),
    loadRetailScheduleFo(client, input.assigned_fo_profile_id),
  ]);
  const date = scheduleDate(input.scheduled_date);
  const duplicate = await findDuplicateRetailSchedule(client, store.id, date);
  if (duplicate) {
    throw Object.assign(new Error('A Deep Cleaning schedule already exists for this store and date.'), {
      statusCode: 409,
      code: 'duplicate_schedule',
    });
  }
  const { data, error } = await client
    .from('client_deep_cleaning_schedules')
    .insert({
      retail_store_id: store.id,
      scheduled_date: date,
      assigned_fo_profile_id: assignedFo.id,
      status: 'Scheduled',
      source_type: 'HK_MIS',
      source_reference: scheduleSourceReference(store.id, date),
      created_by_profile_id: profile.id,
      metadata: { source: 'HK_MIS_SCHEDULING_API' },
    })
    .select(DEEP_CLEANING_SCHEDULE_SELECT)
    .single();
  if (error) throw error;
  await audit(
    client,
    profile,
    'DEEP_CLEANING_SCHEDULE_CREATED',
    'deep_cleaning_schedule',
    data.id,
    null,
    data,
  );
  return data;
}

export async function updateRetailDeepCleaningSchedule(
  client,
  profile,
  scheduleId,
  input = {},
) {
  assertRetailAccess(profile, 'deepCleaning');
  const existing = await loadManagedRetailSchedule(client, scheduleId);
  if (existing.status !== 'Scheduled') {
    throw Object.assign(new Error('Completed or Not Done schedules cannot be edited.'), {
      statusCode: 409,
      code: 'finalized_schedule_locked',
    });
  }
  const store = Object.prototype.hasOwnProperty.call(input, 'store_code')
    ? await loadRetailScheduleStore(client, input.store_code)
    : { id: existing.retail_store_id };
  const assignedFo = Object.prototype.hasOwnProperty.call(
    input,
    'assigned_fo_profile_id',
  )
    ? await loadRetailScheduleFo(client, input.assigned_fo_profile_id)
    : { id: existing.assigned_fo_profile_id };
  const date = Object.prototype.hasOwnProperty.call(input, 'scheduled_date')
    ? scheduleDate(input.scheduled_date)
    : existing.scheduled_date;
  const duplicate = await findDuplicateRetailSchedule(client, store.id, date);
  if (duplicate && duplicate.id !== existing.id) {
    throw Object.assign(new Error('A Deep Cleaning schedule already exists for this store and date.'), {
      statusCode: 409,
      code: 'duplicate_schedule',
    });
  }
  const { data, error } = await client
    .from('client_deep_cleaning_schedules')
    .update({
      retail_store_id: store.id,
      scheduled_date: date,
      assigned_fo_profile_id: assignedFo.id,
      source_type: 'HK_MIS',
      source_reference: scheduleSourceReference(store.id, date),
    })
    .eq('id', existing.id)
    .eq('status', 'Scheduled')
    .select(DEEP_CLEANING_SCHEDULE_SELECT)
    .single();
  if (error) throw error;
  await audit(
    client,
    profile,
    'DEEP_CLEANING_SCHEDULE_UPDATED',
    'deep_cleaning_schedule',
    data.id,
    existing,
    data,
  );
  return data;
}

function monthRange(month) {
  if (!/^\d{4}-\d{2}$/.test(text(month))) return null;
  const [year, value] = text(month).split('-').map(Number);
  if (value < 1 || value > 12) return null;
  return { from: `${text(month)}-01`, to: new Date(Date.UTC(year, value, 1)).toISOString().slice(0, 10) };
}

export async function retailDashboard(client, profile, input = {}) {
  assertRetailAccess(profile, 'dashboard');
  const trainingScope = isRetailHkTrainingReader(profile) ? await resolveTrainingReadScope(client, profile) : null;
  let storeQuery = client.from('reliance_retail_store_master').select('id,store_code,store_name,status,location_status,state,zone_id').limit(5000);
  if (trainingScope) storeQuery = storeQuery.in('id', trainingScope.retailScope.retailStoreIds);
  if (text(input.state)) storeQuery = storeQuery.eq('state', text(input.state));
  if (text(input.zone_id)) storeQuery = storeQuery.eq('zone_id', text(input.zone_id));
  if (text(input.store_id)) storeQuery = storeQuery.eq('id', text(input.store_id));
  const stores = await storeQuery;
  if (stores.error) throw stores.error;
  const storeIds = (stores.data || []).map((row) => row.id);
  const storeCodes = (stores.data || []).map((row) => row.store_code);
  const zoneIds = [...new Set((stores.data || []).map((row) => row.zone_id).filter(Boolean))];
  let cleaningQuery = client.from('client_deep_cleaning_submissions').select('id', { count: 'exact', head: true }).in('business', ['Reliance Retail', 'Reliance']);
  let trainingQuery = client.from('training_sessions').select('id', { count: 'exact', head: true }).eq('access_client_code', 'reliance_retail');
  if (storeCodes.length) cleaningQuery = cleaningQuery.in('store_code', storeCodes); else cleaningQuery = cleaningQuery.eq('store_code', '__NO_MATCH__');
  // One row-level OR preserves exact counting when both store links match.
  if (storeIds.length) {
    const ids = storeIds.join(',');
    trainingQuery = trainingQuery.or(`store_id.in.(${ids}),retail_store_id.in.(${ids})`);
  } else trainingQuery = trainingQuery.eq('store_id', '00000000-0000-0000-0000-000000000000');
  const range = monthRange(input.month);
  if (range) { cleaningQuery = cleaningQuery.gte('deep_cleaning_date', range.from).lt('deep_cleaning_date', range.to); trainingQuery = trainingQuery.gte('training_date', range.from).lt('training_date', range.to); }
  if (trainingScope) {
    const narrowed = narrowRetailTrainingScope(trainingScope.retailScope, storeIds);
    const envelopeIds = await retailTrainingEnvelopeIds(client, [...trainingScope.employeeCodes]);
    // Rebuild this HK-only query so no legacy OR can override the store guard.
    if (envelopeIds.length && narrowed.retailStoreIds.length) {
      trainingQuery = applyRetailTrainingStoreScope(client.from('training_sessions').select('id', { count: 'exact', head: true })
        .eq('access_client_id', RELIANCE_TRAINING_CLIENT_ID).eq('access_client_code', 'reliance_retail').in('id', envelopeIds), narrowed);
      if (range) trainingQuery = trainingQuery.gte('training_date', range.from).lt('training_date', range.to);
    } else trainingQuery = Promise.resolve({ data: null, count: 0, error: null });
  }
  const [zones, assignments, cleaning, training] = await Promise.all([
    zoneIds.length ? client.from('reliance_retail_zones').select('id,zone_code,zone_name,status').in('id', zoneIds).limit(500) : { data: [], error: null },
    zoneIds.length ? client.from('reliance_retail_zone_fo_assignments').select('fo_profile_id,zone_id').in('zone_id', zoneIds).eq('status', 'Active').is('effective_to', null).limit(500) : { data: [], error: null },
    cleaningQuery, trainingQuery,
  ]);
  for (const result of [stores, zones, assignments, cleaning, training]) if (result.error) throw result.error;
  return { total_stores: stores.data.length, active_stores: stores.data.filter((x) => x.status === 'Active').length, inactive_stores: stores.data.filter((x) => x.status === 'Inactive').length, gps_ready: stores.data.filter((x) => x.location_status === 'GPS_READY').length, location_pending: stores.data.filter((x) => x.location_status === 'LOCATION_PENDING').length, active_zones: zones.data.filter((x) => x.status === 'Active').length, assigned_fo_count: new Set(assignments.data.map((x) => x.fo_profile_id)).size, deep_cleaning_submissions: cleaning.count || 0, training_sessions: training.count || 0, fault_tracker: null, stores: stores.data, zones: zones.data };
}
