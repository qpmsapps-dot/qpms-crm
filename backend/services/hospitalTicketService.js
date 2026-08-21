import { randomUUID } from 'node:crypto';

import { canViewHospitalTicket, hospitalAllowedActions, scopeAllows } from './hospitalTicketAuthService.js';
import { nimsRosterCoverageMatrix } from './hospitalTicketRoutingService.js';
import { cleanHospitalText, normalizeHospitalTicketCreate, slaMinutes, validateHospitalAction, validateHospitalTicketCreate } from './hospitalTicketWorkflowService.js';

const TICKET_SELECT = `
  *,
  block:hospital_blocks(id,block_code,block_name),
  location:hospital_locations(id,floor_name,department_name,location_name,location_code,room_number,area_name,ward_name),
  category:hospital_ticket_categories(id,category_code,category_name),
  assignee:hospital_ticket_users!hospital_tickets_current_assignee_user_id_fkey(id,display_name,role_code),
  accepted_by:hospital_ticket_users!hospital_tickets_accepted_by_user_id_fkey(id,display_name,role_code)
`;

export async function loadHospitalMasters(client, actor) {
  const clientId = actor.user.client_id;
  const [blocksResult, locationsResult, categoriesResult] = await Promise.all([
    client.from('hospital_blocks').select('*').eq('client_id', clientId).eq('is_active', true).order('sort_order'),
    client.from('hospital_locations').select('*,floor:hospital_floors(id,floor_code,floor_name,floor_number,verification_status),department:hospital_departments(id,department_code,department_name,department_type,verification_status)').eq('client_id', clientId).eq('is_active', true).order('floor_name'),
    client.from('hospital_ticket_categories').select('*').or(`client_id.is.null,client_id.eq.${clientId}`).eq('is_active', true).order('sort_order'),
  ]);
  for (const result of [blocksResult, locationsResult, categoriesResult]) if (result.error) throw result.error;
  const blocks = (blocksResult.data || []).filter((row) => scopeAllows(actor.scopes, { clientId, blockId: row.id, permission: 'view' }));
  const blockIds = new Set(blocks.map((row) => row.id));
  const locations = (locationsResult.data || []).filter((row) => blockIds.has(row.block_id)
    && scopeAllows(actor.scopes, { clientId, blockId: row.block_id, locationId: row.id, permission: 'view' }));
  return { blocks, locations, categories: categoriesResult.data || [] };
}

export async function listHospitalFloors(client, actor, filters = {}) {
  const blockId = cleanHospitalUuid(filters.block_id || filters.blockId, 'block_id');
  let query = client.from('hospital_floors')
    .select('id,client_id,block_id,floor_code,floor_name,floor_number,sort_order,is_known_service_floor,is_confirmed_building_floor,verification_status,is_active,metadata')
    .eq('client_id', actor.user.client_id)
    .eq('is_active', true)
    .eq('is_known_service_floor', true)
    .order('sort_order')
    .order('floor_name');
  if (blockId) query = query.eq('block_id', blockId);
  const result = await query;
  if (result.error) throw result.error;
  const scopedRows = (result.data || []).filter((row) => scopeAllows(actor.scopes, {
    clientId: row.client_id,
    blockId: row.block_id,
    permission: 'view',
  }) && isUsableHospitalFloor(row));
  if (!scopedRows.length) return [];
  const blockIds = [...new Set(scopedRows.map((row) => row.block_id).filter(Boolean))];
  let referencedFloorIds = new Set();
  if (blockIds.length) {
    let referenceQuery = client.from('hospital_locations')
      .select('floor_id')
      .eq('client_id', actor.user.client_id)
      .eq('is_active', true)
      .not('floor_id', 'is', null);
    if (blockId) referenceQuery = referenceQuery.eq('block_id', blockId);
    else referenceQuery = referenceQuery.in('block_id', blockIds);
    const references = await referenceQuery;
    if (references.error) throw references.error;
    referencedFloorIds = new Set((references.data || []).map((row) => row.floor_id).filter(Boolean));
  }
  return dedupeHospitalFloors(scopedRows, referencedFloorIds);
}

export async function listHospitalDepartments(client, actor, filters = {}) {
  const blockId = cleanHospitalUuid(filters.block_id || filters.blockId, 'block_id');
  const floorId = cleanHospitalUuid(filters.floor_id || filters.floorId, 'floor_id');
  let query = client.from('hospital_departments').select('*,floor:hospital_floors(id,floor_code,floor_name,floor_number)').eq('client_id', actor.user.client_id).eq('is_active', true).order('department_name');
  if (blockId) query = query.eq('block_id', blockId);
  if (floorId) query = query.eq('floor_id', floorId);
  const result = await query;
  if (result.error) throw result.error;
  return (result.data || []).filter((row) => scopeAllows(actor.scopes, {
    clientId: row.client_id,
    blockId: row.block_id,
    permission: 'view',
  }));
}

export async function listHospitalHierarchyLocations(client, actor, filters = {}) {
  const blockId = cleanHospitalUuid(filters.block_id || filters.blockId, 'block_id');
  const floorId = cleanHospitalUuid(filters.floor_id || filters.floorId, 'floor_id');
  const departmentId = cleanHospitalUuid(filters.department_id || filters.departmentId, 'department_id');
  let query = client.from('hospital_locations')
    .select('*,block:hospital_blocks(id,block_code,block_name),floor:hospital_floors(id,floor_code,floor_name,floor_number),department:hospital_departments(id,department_code,department_name,department_type)')
    .eq('client_id', actor.user.client_id)
    .eq('is_active', true)
    .order('floor_name')
    .order('department_name')
    .order('location_name');
  if (blockId) query = query.eq('block_id', blockId);
  if (floorId) query = query.eq('floor_id', floorId);
  if (departmentId) query = query.eq('department_id', departmentId);
  const result = await query;
  if (result.error) throw result.error;
  return dedupeHospitalLocations((result.data || []).filter((row) => row.floor_id && scopeAllows(actor.scopes, {
    clientId: row.client_id,
    blockId: row.block_id,
    locationId: row.id,
    permission: 'view',
  })));
}

export async function loadHospitalLocationHierarchy(client, actor, filters = {}) {
  const [masters, floors, departments, locations] = await Promise.all([
    loadHospitalMasters(client, actor),
    listHospitalFloors(client, actor, filters),
    listHospitalDepartments(client, actor, filters),
    listHospitalHierarchyLocations(client, actor, filters),
  ]);
  const blockIdSet = new Set(masters.blocks.map((row) => row.id));
  return {
    blocks: masters.blocks,
    floors: floors.filter((row) => blockIdSet.has(row.block_id)),
    departments: departments.filter((row) => blockIdSet.has(row.block_id)),
    locations,
  };
}

function requireRoutingAdmin(actor) {
  if (!actor?.user || actor.user.profile_type !== 'internal'
    || !['operations_executive', 'facility_manager', 'admin'].includes(actor.user.role_code)) {
    const error = new Error('Routing configuration is available only to authorised operations users.');
    error.code = '42501';
    throw error;
  }
}

const NIMS_SUPERVISOR_ROSTER = [
  { roster_id: 'nims-supervisor-01', name: 'Ch Ramu', mobile: '9866320241', shift_label: '8 AM - 4 PM', start_minute: 8 * 60, end_minute: 16 * 60, area_label: 'Overall / Administration' },
  { roster_id: 'nims-supervisor-02', name: 'L. V. Sai', mobile: '9948310098', shift_label: '8 AM - 4 PM', start_minute: 8 * 60, end_minute: 16 * 60, area_label: 'OPD Block / Admin Block / Oncology Block' },
  { roster_id: 'nims-supervisor-03', name: 'M. Praveen', mobile: '9704682736', shift_label: '8 AM - 4 PM', start_minute: 8 * 60, end_minute: 16 * 60, area_label: 'Speciality Block' },
  { roster_id: 'nims-supervisor-04', name: 'Sastri', mobile: '7013989869', shift_label: '8 AM - 4 PM', start_minute: 8 * 60, end_minute: 16 * 60, area_label: 'Speciality Block / Trauma Block / Campus' },
  { roster_id: 'nims-supervisor-05', name: 'B. Anil', mobile: '9866934055', shift_label: '7 AM - 3 PM', start_minute: 7 * 60, end_minute: 15 * 60, area_label: 'Trauma Block' },
  { roster_id: 'nims-supervisor-06', name: 'Shiva', mobile: '7799876077', shift_label: '2 PM - 8 PM', start_minute: 14 * 60, end_minute: 20 * 60, area_label: 'Speciality Block / Trauma Block' },
  { roster_id: 'nims-supervisor-07', name: 'Venkata Krishna Reddy', mobile: '7815969967', shift_label: '8 PM - 8 AM', start_minute: 20 * 60, end_minute: 8 * 60, area_label: 'All Blocks / Night' },
  { roster_id: 'nims-supervisor-08', name: 'A Ravi', mobile: '9581219133', shift_label: '7 AM - 3 PM', start_minute: 7 * 60, end_minute: 15 * 60, area_label: 'NPR Blocks / Old Building' },
  { roster_id: 'nims-supervisor-09', name: 'K Srinivas', mobile: '7989159722', shift_label: '8 AM - 4 PM', start_minute: 8 * 60, end_minute: 16 * 60, area_label: 'Campus / Waiting Halls' },
  { roster_id: 'nims-supervisor-10', name: 'V Lenin', mobile: '8897427043', shift_label: '8 AM - 4 PM', start_minute: 8 * 60, end_minute: 16 * 60, area_label: 'Millennium Block' },
  { roster_id: 'nims-supervisor-11', name: 'V Anji Reddy', mobile: '970365667', shift_label: '12 Noon - 8 PM', start_minute: 12 * 60, end_minute: 20 * 60, area_label: 'NPR Blocks / Old Building / Millennium Block' },
  { roster_id: 'nims-supervisor-12', name: 'Y Nikhil', mobile: '8886744183', shift_label: '8 PM - 8 AM', start_minute: 20 * 60, end_minute: 8 * 60, area_label: 'All Blocks / Night' },
  { roster_id: 'nims-supervisor-13', name: 'M Srinivas', mobile: '9010199955', shift_label: '12 Noon - 8 PM', start_minute: 12 * 60, end_minute: 20 * 60, area_label: 'Millennium Block / Overall' },
];

const SUPERVISOR_AVAILABILITY_ROLES = new Set(['operations_executive', 'facility_manager', 'project_head']);

function requireSupervisorAvailabilityViewer(actor) {
  if (!actor?.user || actor.user.profile_type !== 'internal' || !SUPERVISOR_AVAILABILITY_ROLES.has(actor.user.role_code)) {
    const error = new Error('Supervisor availability is available only to Hospital escalation owners.');
    error.code = '42501';
    throw error;
  }
}

export function nimsSupervisorRosterDataIssues() {
  return NIMS_SUPERVISOR_ROSTER
    .filter((row) => row.mobile && !/^\d{10}$/.test(row.mobile))
    .map((row) => ({
      roster_id: row.roster_id,
      name: row.name,
      issue: `Supplied mobile '${row.mobile}' is not 10 digits.`,
    }));
}

function normalizeSupervisorKey(value) {
  return cleanHospitalText(value, 120).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function supervisorPhoneValues(user = {}) {
  return [user.cug_number, user.cug_number_display, user.phone, user.mobile, user.metadata?.mobile, user.metadata?.phone]
    .map((value) => cleanHospitalText(value, 40).replace(/\D+/g, ''))
    .filter(Boolean);
}

function currentMinuteInKolkata(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  return hour * 60 + minute;
}

function isInsideShift(rosterRow, now = new Date()) {
  const minute = currentMinuteInKolkata(now);
  if (rosterRow.start_minute === rosterRow.end_minute) return true;
  if (rosterRow.start_minute < rosterRow.end_minute) {
    return minute >= rosterRow.start_minute && minute < rosterRow.end_minute;
  }
  return minute >= rosterRow.start_minute || minute < rosterRow.end_minute;
}

function findRosterUser(rosterRow, users) {
  const rosterMobile = cleanHospitalText(rosterRow.mobile, 40).replace(/\D+/g, '');
  if (rosterMobile) {
    const byMobile = users.find((user) => supervisorPhoneValues(user).includes(rosterMobile));
    if (byMobile) return byMobile;
  }
  const rosterName = normalizeSupervisorKey(rosterRow.name);
  return users.find((user) => normalizeSupervisorKey(user.display_name) === rosterName) || null;
}

export function supervisorAvailabilityStatus({ rosterRow, user, now = new Date() }) {
  const withinShift = isInsideShift(rosterRow, now);
  if (user?.duty_status === 'on_duty') {
    return { status: 'on_duty', status_label: 'On Duty', is_on_duty: true, within_shift: withinShift };
  }
  if (withinShift) {
    return { status: 'duty_not_started', status_label: 'Duty Not Started', is_on_duty: false, within_shift: true };
  }
  return { status: 'off_shift', status_label: 'Off Shift', is_on_duty: false, within_shift: false };
}

export function buildNimsSupervisorAvailability(users = [], now = new Date()) {
  const activeSupervisorUsers = users.filter((user) => user?.is_active !== false && user?.role_code === 'housekeeping_supervisor');
  const supervisors = NIMS_SUPERVISOR_ROSTER.map((rosterRow) => {
    const user = findRosterUser(rosterRow, activeSupervisorUsers);
    const status = supervisorAvailabilityStatus({ rosterRow, user, now });
    const phones = user ? supervisorPhoneValues(user) : [];
    return {
      roster_id: rosterRow.roster_id,
      name: cleanHospitalText(user?.display_name, 120) || rosterRow.name,
      role_code: 'housekeeping_supervisor',
      matched_user_id: user?.id || null,
      identity_status: user?.id ? 'matched' : 'not_linked',
      status: status.status,
      status_label: status.status_label,
      is_on_duty: status.is_on_duty,
      within_shift: status.within_shift,
      shift_label: rosterRow.shift_label,
      area_label: rosterRow.area_label,
      mobile_display: phones[0] || null,
      duty_status: user?.duty_status || 'off_duty',
      duty_started_at: user?.duty_started_at || null,
      duty_ended_at: user?.duty_ended_at || null,
      last_active_at: user?.last_seen_at || user?.duty_started_at || user?.duty_ended_at || null,
    };
  }).sort((left, right) => {
    const rank = { on_duty: 0, duty_not_started: 1, offline_stale: 2, off_shift: 3 };
    return (rank[left.status] ?? 9) - (rank[right.status] ?? 9) || left.name.localeCompare(right.name);
  });
  const count = (status) => supervisors.filter((row) => row.status === status).length;
  return {
    generated_at: now.toISOString(),
    timezone: 'Asia/Kolkata',
    stale_tracking_supported: false,
    data_issues: nimsSupervisorRosterDataIssues(),
    counts: {
      on_duty: count('on_duty'),
      duty_not_started: count('duty_not_started'),
      off_shift: count('off_shift'),
      offline_stale: 0,
    },
    supervisors,
  };
}

export async function listHospitalSupervisorAvailability(client, actor, options = {}) {
  requireSupervisorAvailabilityViewer(actor);
  const result = await client
    .from('hospital_ticket_users')
    .select('id,client_id,profile_type,role_code,display_name,email,cug_number,cug_number_display,duty_status,duty_started_at,duty_ended_at,last_seen_at,metadata,is_active')
    .eq('client_id', actor.user.client_id)
    .eq('profile_type', 'internal')
    .eq('role_code', 'housekeeping_supervisor')
    .eq('is_active', true)
    .order('display_name');
  if (result.error) throw result.error;
  return buildNimsSupervisorAvailability(result.data || [], options.now || new Date());
}

export async function listHospitalRoutingShifts(client, actor) {
  requireRoutingAdmin(actor);
  const result = await client
    .from('hospital_shifts')
    .select('id,client_id,shift_code,shift_name,starts_at,ends_at,timezone,days_of_week,is_overnight,verification_status,is_active,source,source_reference,metadata')
    .or(`client_id.is.null,client_id.eq.${actor.user.client_id}`)
    .order('starts_at');
  if (result.error) throw result.error;
  return result.data || [];
}

export async function listHospitalRoutingAssignments(client, actor) {
  requireRoutingAdmin(actor);
  const result = await client
    .from('hospital_supervisor_assignments')
    .select('id,client_id,user_id,block_id,department_id,category_id,shift_id,assignment_type,routing_priority,effective_from,effective_to,days_of_week,verification_status,is_active,source,source_reference,metadata,user:hospital_ticket_users(id,display_name,role_code,is_active),block:hospital_blocks(id,block_name),shift:hospital_shifts(id,shift_name,starts_at,ends_at,is_overnight)')
    .eq('client_id', actor.user.client_id)
    .order('routing_priority')
    .order('created_at');
  if (result.error) throw result.error;
  return result.data || [];
}

export function nimsSupervisorCoverageReport(actor) {
  requireRoutingAdmin(actor);
  return {
    blocks: nimsRosterCoverageMatrix(),
    confirmations_required: [
      'Core Block morning supervisor',
      'Core Block evening supervisor',
      'Extra Mural morning supervisor',
      'Extra Mural evening supervisor',
      'Admin Block coverage from 4 PM-8 PM',
      'OPD Block coverage from 4 PM-8 PM',
      'Oncology Block coverage from 4 PM-8 PM',
      'Whether broad Overall/Campus/Administration responsibilities map to exact blocks',
      'Primary/backup order for overlapping Speciality, Millennium, and night supervisors',
      'Emergency & Physiotherapy versus Trauma identity',
    ],
  };
}

export function cleanHospitalUuid(value, fieldName = 'id') {
  const text = cleanHospitalText(value, 80);
  if (!text) return '';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) return text;
  const error = new Error(`${fieldName} must be a valid UUID.`);
  error.code = '22023';
  throw error;
}

function normalizeHierarchyLabel(value) {
  return cleanHospitalText(value, 160)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\bfirst\b/g, '1')
    .replace(/\bsecond\b/g, '2')
    .replace(/\bthird\b/g, '3')
    .replace(/\bfourth\b/g, '4')
    .replace(/\bfifth\b/g, '5')
    .replace(/\bsixth\b/g, '6')
    .replace(/\bseventh\b/g, '7')
    .replace(/\beighth\b/g, '8')
    .replace(/\bninth\b/g, '9')
    .replace(/\btenth\b/g, '10')
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUsableHospitalFloor(row) {
  if (row?.is_active !== true) return false;
  if (row.is_known_service_floor === false) return false;
  const normalized = normalizeHierarchyLabel(row.floor_name || row.floor_code);
  if (!normalized) return false;
  const placeholderTokens = [
    'not confirmed',
    'unconfirmed floor',
    'not applicable',
    'campus areas',
    'mentioned in department',
  ];
  return !placeholderTokens.some((token) => normalized.includes(token));
}

function hospitalFloorDedupeKey(row) {
  if (Number.isInteger(row.floor_number)) return `${row.block_id}:number:${row.floor_number}`;
  const normalized = normalizeHierarchyLabel(row.floor_name || row.floor_code);
  return `${row.block_id}:name:${normalized}`;
}

function preferredHospitalFloor(existing, candidate, referencedFloorIds) {
  if (!existing) return candidate;
  const existingReferenced = referencedFloorIds.has(existing.id);
  const candidateReferenced = referencedFloorIds.has(candidate.id);
  if (candidateReferenced && !existingReferenced) return candidate;
  if (existingReferenced && !candidateReferenced) return existing;
  const existingConfirmed = existing.is_confirmed_building_floor === true;
  const candidateConfirmed = candidate.is_confirmed_building_floor === true;
  if (candidateConfirmed && !existingConfirmed) return candidate;
  if (existingConfirmed && !candidateConfirmed) return existing;
  const existingSort = Number.isFinite(Number(existing.sort_order)) ? Number(existing.sort_order) : 999999;
  const candidateSort = Number.isFinite(Number(candidate.sort_order)) ? Number(candidate.sort_order) : 999999;
  if (candidateSort < existingSort) return candidate;
  return existing;
}

function dedupeHospitalFloors(rows, referencedFloorIds) {
  const byKey = new Map();
  for (const row of rows) {
    const key = hospitalFloorDedupeKey(row);
    byKey.set(key, preferredHospitalFloor(byKey.get(key), row, referencedFloorIds));
  }
  return [...byKey.values()].sort((a, b) => {
    const aSort = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : 999999;
    const bSort = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 999999;
    if (aSort !== bSort) return aSort - bSort;
    return cleanHospitalText(a.floor_name, 120).localeCompare(cleanHospitalText(b.floor_name, 120));
  });
}

function hospitalLocationDisplayLabel(row) {
  return [
    row?.ward_name,
    row?.area_name,
    row?.department_name,
    row?.department?.department_name,
    row?.location_name,
  ].map((value) => cleanHospitalText(value, 160)).find(Boolean) || '';
}

function dedupeHospitalLocations(rows) {
  const seen = new Set();
  const output = [];
  for (const row of rows) {
    const label = hospitalLocationDisplayLabel(row);
    const key = `${row.block_id}:${row.floor_id}:${normalizeHierarchyLabel(label)}`;
    if (!label || seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }
  return output;
}

function applyTicketFilters(query, filters = {}) {
  if (filters.status) query = query.eq('status_code', cleanHospitalText(filters.status, 60));
  if (filters.block) query = query.eq('block_id', cleanHospitalText(filters.block, 80));
  if (filters.priority) query = query.eq('priority', cleanHospitalText(filters.priority, 20));
  if (filters.category) query = query.eq('category_id', cleanHospitalText(filters.category, 80));
  if (filters.date_from) query = query.gte('raised_at', `${filters.date_from}T00:00:00+05:30`);
  if (filters.date_to) query = query.lte('raised_at', `${filters.date_to}T23:59:59.999+05:30`);
  if (filters.assigned_to_me === 'true') query = query.eq('current_assignee_user_id', filters.actorUserId);
  if (filters.escalated === 'true') query = query.in('status_code', ['escalated_operations_executive', 'escalated_facility_manager', 'escalated_project_head']);
  if (filters.awaiting_confirmation === 'true') query = query.eq('status_code', 'resolved_awaiting_confirmation');
  if (filters.reopened === 'true') query = query.eq('status_code', 'reopened');
  return query;
}

function requireSupervisor(actor) {
  if (actor?.user?.profile_type !== 'internal' || actor.user.role_code !== 'housekeeping_supervisor') {
    const error = new Error('Active Supervisor profile required.');
    error.code = '42501';
    throw error;
  }
}

export async function getSupervisorDutyStatus(client, actor) {
  requireSupervisor(actor);
  const result = await client
    .from('hospital_ticket_users')
    .select('id,duty_status,duty_started_at,duty_ended_at,last_seen_at,cug_number,cug_number_display')
    .eq('id', actor.user.id)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data || {
    id: actor.user.id,
    duty_status: 'off_duty',
    duty_started_at: null,
    duty_ended_at: null,
    last_seen_at: null,
    cug_number: null,
    cug_number_display: null,
  };
}

export async function setSupervisorDuty(client, actor, onDuty, body = {}) {
  requireSupervisor(actor);
  const result = await client.rpc('rpc_set_hospital_supervisor_duty', {
    p_actor_user_id: actor.user.id,
    p_on_duty: Boolean(onDuty),
    p_cug_number: body.cug_number || body.cugNumber || null,
  });
  if (result.error) throw result.error;
  return result.data;
}

export async function listIncomingSupervisorTickets(client, actor) {
  requireSupervisor(actor);
  const notifications = await client
    .from('hospital_ticket_notifications')
    .select('id,notification_type,title,body,action_status,action_expires_at,metadata,created_at,ticket:hospital_tickets(' + TICKET_SELECT + ')')
    .eq('recipient_user_id', actor.user.id)
    .eq('notification_type', 'incoming_supervisor_ticket')
    .eq('action_status', 'active')
    .order('created_at', { ascending: false })
    .limit(100);
  if (notifications.error) throw notifications.error;
  const now = new Date();
  return (notifications.data || [])
    .filter((row) => row.ticket?.status_code === 'awaiting_supervisor_acceptance'
      && row.ticket?.acceptance_status === 'awaiting'
      && row.ticket?.acceptance_due_at
      && new Date(row.ticket.acceptance_due_at) > now
      && canViewHospitalTicket(actor, row.ticket))
    .map((row) => ({
      notification_id: row.id,
      action_expires_at: row.action_expires_at,
      metadata: row.metadata || {},
      ticket: hospitalTicketForActor(actor, row.ticket),
    }));
}

export async function listHospitalNotifications(client, actor, limit = 200) {
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 200);
  const result = await client
    .from('hospital_ticket_notifications')
    .select('*,ticket:hospital_tickets(id,ticket_no,client_id,block_id,location_id,floor_name,department_name,location_text,exact_landmark_snapshot,priority,status_code,block:hospital_blocks(id,block_name),location:hospital_locations(id,floor_name,department_name,location_name,location_code,room_number,area_name,ward_name),category:hospital_ticket_categories(id,category_name))')
    .eq('recipient_user_id', actor.user.id)
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (result.error) throw result.error;

  const rows = result.data || [];
  const visibleTicketIds = rows
    .map((row) => row.ticket)
    .filter((ticket) => ticket?.id && canViewHospitalTicket(actor, ticket))
    .map((ticket) => ticket.id);
  const complaintPhotos = await firstComplaintPhotos(client, [...new Set(visibleTicketIds)]);

  return rows.map((row) => {
    const ticket = row.ticket && canViewHospitalTicket(actor, row.ticket) ? row.ticket : null;
    const beforeImage = ticket?.id ? complaintPhotos.get(ticket.id) || null : null;
    return {
      ...row,
      ticket: ticket ? {
        id: ticket.id,
        ticket_no: ticket.ticket_no,
        priority: ticket.priority,
        status_code: ticket.status_code,
        block_name: ticket.block?.block_name || null,
        floor_name: ticket.floor_name || ticket.location?.floor_name || null,
        department_name: ticket.department_name || ticket.location?.department_name || null,
        location_text: ticket.location_text
          || ticket.location?.location_name
          || ticket.location?.ward_name
          || ticket.location?.area_name
          || ticket.exact_landmark_snapshot
          || null,
        category_name: ticket.category?.category_name || null,
      } : null,
      before_image: beforeImage,
      before_image_url: beforeImage?.signed_url || null,
    };
  });
}

export async function listHospitalTickets(client, actor, filters = {}) {
  let query = client.from('hospital_tickets').select(TICKET_SELECT).eq('client_id', actor.user.client_id).order('raised_at', { ascending: false }).limit(500);
  query = applyTicketFilters(query, { ...filters, actorUserId: actor.user.id });
  const result = await query;
  if (result.error) throw result.error;
  const search = cleanHospitalText(filters.search, 120).toLowerCase();
  const visibleTickets = (result.data || []).filter((ticket) => canViewHospitalTicket(actor, ticket)).filter((ticket) => {
    if (!search) return true;
    return [ticket.ticket_no, ticket.title, ticket.description, ticket.floor_name, ticket.department_name, ticket.location_text, ticket.block?.block_name, ticket.assignee?.display_name]
      .some((value) => String(value || '').toLowerCase().includes(search));
  });
  const complaintPhotos = await firstComplaintPhotos(client, visibleTickets.map((ticket) => ticket.id));
  return visibleTickets.map((ticket) => hospitalTicketForActor(actor, ticket, {
    complaint_photo: complaintPhotos.get(ticket.id) || null,
  }));
}

async function firstComplaintPhotos(client, ticketIds) {
  if (!ticketIds.length) return new Map();
  const { data, error } = await client
    .from('hospital_ticket_attachments')
    .select('id,ticket_id,attachment_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes,is_client_visible,created_at')
    .in('ticket_id', ticketIds)
    .eq('attachment_type', 'complaint_photo')
    .eq('is_client_visible', true)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const byTicket = new Map();
  for (const attachment of data || []) {
    if (byTicket.has(attachment.ticket_id)) continue;
    const safe = {
      id: attachment.id,
      ticket_id: attachment.ticket_id,
      attachment_type: attachment.attachment_type,
      original_filename: attachment.original_filename,
      mime_type: attachment.mime_type,
      size_bytes: attachment.size_bytes,
      is_client_visible: attachment.is_client_visible,
      created_at: attachment.created_at,
      signed_url: null,
    };
    if (attachment.storage_bucket && attachment.storage_path) {
      const signed = await client.storage
        .from(attachment.storage_bucket)
        .createSignedUrl(attachment.storage_path, 300);
      if (!signed.error) safe.signed_url = signed.data?.signedUrl || null;
    }
    byTicket.set(attachment.ticket_id, safe);
  }
  return byTicket;
}

export async function getHospitalTicket(client, actor, ticketId) {
  const identifier = cleanHospitalText(ticketId, 80);
  const identifierColumn = hospitalTicketIdentifierColumn(identifier);
  const ticketResult = await client.from('hospital_tickets').select(TICKET_SELECT).eq(identifierColumn, identifier).maybeSingle();
  if (ticketResult.error) throw ticketResult.error;
  if (!ticketResult.data || !canViewHospitalTicket(actor, ticketResult.data)) {
    const error = new Error('Ticket was not found in your authorized scope.'); error.code = '42501'; throw error;
  }
  const ticket = ticketResult.data;
  const [events, comments, attachments] = await Promise.all([
    client.from('hospital_ticket_events').select('*').eq('ticket_id', ticket.id).order('created_at'),
    client.from('hospital_ticket_comments').select('*').eq('ticket_id', ticket.id).order('created_at'),
    client.from('hospital_ticket_attachments').select('*').eq('ticket_id', ticket.id).order('created_at'),
  ]);
  for (const result of [events, comments, attachments]) if (result.error) throw result.error;
  const isClient = actor.user.profile_type === 'client';
  return {
    ticket: hospitalTicketForActor(actor, ticket),
    timeline: isClient ? (events.data || []).filter(clientCanSeeHospitalEvent).map(clientHospitalEventView) : events.data || [],
    comments: (comments.data || []).filter((row) => !isClient || row.is_client_visible),
    attachments: (attachments.data || []).filter((row) => !isClient || row.is_client_visible),
    sla: hospitalSlaState(ticket),
    allowed_actions: allowedActionsForTicket(actor, ticket),
  };
}

export function hospitalTicketForActor(actor, ticket, extra = {}) {
  const assignmentState = ticket?.metadata?.assignment_state
    || (ticket?.current_assignee_user_id ? 'assigned' : 'unassigned');
  const assignmentFailureReason = ticket?.metadata?.assignment_failure_reason || null;
  const cancellation = ticket?.metadata?.cancellation || null;
  const enrichedTicket = {
    ...ticket,
    cancellation_reason_code: cancellation?.reason_code || null,
    cancellation_reason_text: cancellation?.reason_text || null,
    cancelled_at: cancellation?.cancelled_at || null,
  };
  if (actor?.user?.profile_type !== 'client') {
    return { ...enrichedTicket, ...extra, assignment_state: assignmentState, assignment_failure_reason: assignmentFailureReason };
  }
  const safeTicket = { ...enrichedTicket };
  for (const key of [
    'idempotency_key',
    'metadata',
    'raised_by_user_id',
    'current_assignee_user_id',
    'supervisor_user_id',
    'operations_executive_user_id',
    'facility_manager_user_id',
    'project_head_user_id',
    'resolved_by_user_id',
  ]) {
    delete safeTicket[key];
  }
  if (safeTicket.assignee && typeof safeTicket.assignee === 'object') {
    safeTicket.assignee = {
      display_name: safeTicket.assignee.display_name || '',
      role_code: safeTicket.assignee.role_code || '',
    };
  }
  return { ...safeTicket, ...extra, assignment_state: assignmentState, assignment_failure_reason: assignmentFailureReason };
}

export function clientCanSeeHospitalEvent(event) {
  if (event?.event_type === 'progress_update' || event?.event_type === 'assistance_requested') {
    return event?.event_data?.is_client_visible === true;
  }
  if (event?.event_type === 'photo_uploaded') return event?.event_data?.is_client_visible === true;
  return true;
}

export function clientHospitalEventView(event) {
  const safeEvent = { ...event };
  delete safeEvent.actor_user_id;
  delete safeEvent.event_data;
  if (safeEvent.event_type === 'manual_escalation') safeEvent.remarks = 'Ticket escalated for operational support.';
  return safeEvent;
}

export function hospitalTicketIdentifierColumn(identifier) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identifier)
    ? 'id'
    : 'ticket_no';
}

export async function createHospitalTicket(client, actor, body, idempotencyHeader) {
  const payload = normalizeHospitalTicketCreate({ ...body, idempotency_key: body?.idempotency_key || idempotencyHeader });
  const errors = validateHospitalTicketCreate(payload);
  if (errors.length) { const error = new Error(errors.join(' ')); error.code = '22023'; throw error; }
  if (!['doctor', 'hospital_management'].includes(actor.user.role_code)) { const error = new Error('Only client users can raise complaints.'); error.code = '42501'; throw error; }
  payload.blockId = cleanHospitalUuid(payload.blockId, 'block_id');
  payload.floorId = cleanHospitalUuid(payload.floorId, 'floor_id');
  payload.departmentId = cleanHospitalUuid(payload.departmentId, 'department_id');
  payload.locationId = cleanHospitalUuid(payload.locationId, 'location_id');
  payload.categoryId = cleanHospitalUuid(payload.categoryId, 'category_id');
  await validateHospitalCreateHierarchy(client, actor, payload);
  const sla = slaMinutes();
  const result = await client.rpc('rpc_create_hospital_ticket', {
    p_actor_user_id: actor.user.id,
    p_block_id: payload.blockId,
    p_location_id: payload.locationId || null,
    p_category_id: payload.categoryId,
    p_priority: payload.priority,
    p_title: payload.title,
    p_description: payload.description,
    p_idempotency_key: payload.idempotencyKey,
    p_supervisor_sla_minutes: sla.supervisor,
    p_floor_id: payload.floorId || null,
    p_department_id: payload.departmentId || null,
    p_exact_landmark: payload.exactLandmark || null,
  });
  if (result.error) throw result.error;
  if (payload.exactLandmark && result.data?.ticket?.location_id) {
    await applyExactLandmarkSnapshot(client, result.data?.ticket?.id, payload.exactLandmark);
  }
  await safeWriteHospitalLifecycleNotifications(client, {
    action: 'ticket_created',
    actor,
    afterTicket: result.data?.ticket,
  });
  return result.data;
}

async function validateHospitalCreateHierarchy(client, actor, payload) {
  const block = await client
    .from('hospital_blocks')
    .select('id,client_id,is_active')
    .eq('id', payload.blockId)
    .maybeSingle();
  if (block.error) throw block.error;
  if (!block.data || block.data.client_id !== actor.user.client_id || block.data.is_active !== true) {
    const error = new Error('Selected block is outside your complaint scope.');
    error.code = '42501';
    throw error;
  }

  if (!scopeAllows(actor.scopes, { clientId: actor.user.client_id, blockId: payload.blockId, locationId: payload.locationId || undefined, permission: 'create' })) {
    const error = new Error('Selected hierarchy is outside your complaint scope.');
    error.code = '42501';
    throw error;
  }

  const floorResult = await client
    .from('hospital_floors')
    .select('id,client_id,block_id,floor_code,floor_name,floor_number,sort_order,is_known_service_floor,is_confirmed_building_floor,verification_status,is_active,metadata')
    .eq('id', payload.floorId)
    .maybeSingle();
  if (floorResult.error) throw floorResult.error;
  const floor = floorResult.data;
  if (!floor || floor.client_id !== actor.user.client_id || floor.block_id !== payload.blockId || !isUsableHospitalFloor(floor)) {
    const error = new Error('Selected floor is outside the selected block.');
    error.code = '42501';
    throw error;
  }

  let department = null;
  if (payload.departmentId) {
    const departmentResult = await client
      .from('hospital_departments')
      .select('id,client_id,block_id,floor_id,is_active')
      .eq('id', payload.departmentId)
      .maybeSingle();
    if (departmentResult.error) throw departmentResult.error;
    department = departmentResult.data;
    if (!department || department.client_id !== actor.user.client_id || department.block_id !== payload.blockId || department.is_active !== true) {
      const error = new Error('Selected department is outside the selected block.');
      error.code = '42501';
      throw error;
    }
    if (payload.floorId && department.floor_id && department.floor_id !== payload.floorId) {
      const error = new Error('Selected department is outside the selected floor.');
      error.code = '42501';
      throw error;
    }
  }

  const location = await client
    .from('hospital_locations')
    .select('id,client_id,block_id,floor_id,department_id,is_active')
    .eq('id', payload.locationId)
    .maybeSingle();
  if (location.error) throw location.error;
  if (!location.data || location.data.client_id !== actor.user.client_id || location.data.block_id !== payload.blockId || location.data.is_active !== true) {
    const error = new Error('Selected location is outside your complaint scope.');
    error.code = '42501';
    throw error;
  }
  if (location.data.floor_id !== payload.floorId) {
    const error = new Error('Selected location is outside the selected floor.');
    error.code = '42501';
    throw error;
  }
  if (payload.departmentId && location.data.department_id && location.data.department_id !== payload.departmentId) {
    const error = new Error('Selected location is outside the selected department.');
    error.code = '42501';
    throw error;
  }
}

async function applyExactLandmarkSnapshot(client, ticketId, exactLandmark) {
  const id = cleanHospitalText(ticketId, 80);
  const landmark = cleanHospitalText(exactLandmark, 180);
  if (!id || !landmark) return;
  const current = await client
    .from('hospital_tickets')
    .select('id,site_name_snapshot,block_name_snapshot,floor_name,department_name,room_area_snapshot,location_text,location_path_snapshot')
    .eq('id', id)
    .maybeSingle();
  if (current.error || !current.data) {
    if (current.error) throw current.error;
    return;
  }
  const parts = [
    current.data.site_name_snapshot,
    current.data.block_name_snapshot,
    current.data.floor_name,
    current.data.department_name,
    current.data.room_area_snapshot,
    current.data.location_text,
    landmark,
  ].map((value) => cleanHospitalText(value, 240)).filter(Boolean);
  const seen = new Set();
  const path = parts.filter((part) => {
    const key = part.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(' > ');
  const updated = await client
    .from('hospital_tickets')
    .update({
      exact_landmark_snapshot: landmark,
      location_path_snapshot: path || current.data.location_path_snapshot,
    })
    .eq('id', id);
  if (updated.error) throw updated.error;
}

export async function performHospitalAction(client, actor, ticketId, action, expectedVersion, payload = {}) {
  const current = await getHospitalTicket(client, actor, ticketId);
  const effectiveAction = actor.user.role_code === 'admin'
    && action === 'manual_escalation'
    && current.ticket.status_code === 'escalated_operations_executive'
    ? 'escalate_facility'
    : action;
  const requiredPermission = actor.user.profile_type === 'client' ? 'view' : 'update';
  if (!scopeAllows(actor.scopes, {
    clientId: current.ticket.client_id,
    blockId: current.ticket.block_id,
    locationId: current.ticket.location_id,
    permission: requiredPermission,
  })) {
    const error = new Error('This action is outside your authorized scope.');
    error.code = '42501';
    throw error;
  }
  const errors = validateHospitalAction({ role: actor.user.role_code, status: current.ticket.status_code, action: effectiveAction, payload });
  if (errors.length) { const error = new Error(errors.join(' ')); error.code = '42501'; throw error; }
  if (!Number.isInteger(Number(expectedVersion))) { const error = new Error('Ticket version is required.'); error.code = '22023'; throw error; }
  if (current.ticket.version !== Number(expectedVersion)) {
    const error = new Error('Ticket version conflict.');
    error.code = '40001';
    throw error;
  }
  if (effectiveAction === 'accept' && current.ticket.status_code === 'awaiting_supervisor_acceptance') {
    const result = await client.rpc('rpc_accept_hospital_supervisor_ticket', {
      p_ticket_id: current.ticket.id,
      p_actor_user_id: actor.user.id,
      p_expected_version: Number(expectedVersion),
      p_confirmed_location: payload.confirmed_location === true || payload.confirmedLocation === true,
    });
    if (result.error) throw result.error;
    const detail = await getHospitalTicket(client, actor, current.ticket.id);
    await safeWriteHospitalLifecycleNotifications(client, {
      action: effectiveAction,
      actor,
      beforeTicket: current.ticket,
      afterTicket: detail.ticket,
    });
    return detail;
  }
  if (
    ['accept', 'take_over'].includes(effectiveAction)
    && current.ticket.acceptance_status === 'awaiting'
    && (
      (actor.user.role_code === 'operations_executive' && current.ticket.status_code === 'escalated_operations_executive')
      || (actor.user.role_code === 'facility_manager' && current.ticket.status_code === 'escalated_facility_manager')
      || (actor.user.role_code === 'project_head' && current.ticket.status_code === 'escalated_project_head')
    )
  ) {
    const result = await client.rpc('rpc_accept_hospital_escalation_ticket', {
      p_ticket_id: current.ticket.id,
      p_actor_user_id: actor.user.id,
      p_expected_version: Number(expectedVersion),
    });
    if (result.error) throw result.error;
    const detail = await getHospitalTicket(client, actor, current.ticket.id);
    await safeWriteHospitalLifecycleNotifications(client, {
      action: effectiveAction,
      actor,
      beforeTicket: current.ticket,
      afterTicket: detail.ticket,
    });
    return detail;
  }
  if (effectiveAction === 'reassign_supervisor') {
    return performManualHospitalReassignment(client, actor, current.ticket, {
      targetRole: 'housekeeping_supervisor',
      remarks: payload.remarks || 'Manually reassigned to the block Housekeeping Supervisor.',
      eventType: 'manual_reassignment',
    });
  }
  if (effectiveAction === 'assign_support' && payload.target_role) {
    return performManualHospitalReassignment(client, actor, current.ticket, {
      targetRole: cleanHospitalText(payload.target_role, 80),
      remarks: payload.remarks || 'Manually reassigned for operational support.',
      eventType: 'manual_reassignment',
    });
  }
  if (effectiveAction === 'cancel') {
    return performClientTicketCancellation(client, actor, current.ticket, payload);
  }
  if (effectiveAction === 'resolve') {
    await requireCurrentOperationalOwner(client, actor, current.ticket);
    await requireCompletionEvidence(client, current.ticket.id);
  }
  const requiredRole = ['manual_escalation', 'escalate_operations'].includes(effectiveAction)
    ? 'operations_executive'
    : effectiveAction === 'escalate_facility'
      ? 'facility_manager'
      : null;
  if (requiredRole) {
    const assignee = await client.from('hospital_ticket_users').select('id')
      .eq('client_id', current.ticket.client_id).eq('role_code', requiredRole).eq('is_active', true).limit(1);
    if (assignee.error) throw assignee.error;
    if (!(assignee.data || []).length) {
      const reason = `no_active_${requiredRole}`;
      const recorded = await client.rpc('rpc_record_hospital_assignment_failure', {
        p_ticket_id: current.ticket.id,
        p_expected_version: Number(expectedVersion),
        p_stage: requiredRole,
        p_reason: reason,
      });
      if (recorded.error) throw recorded.error;
      const error = new Error(`Escalation is blocked because no active ${requiredRole.replaceAll('_', ' ')} is mapped.`);
      error.code = '55000';
      throw error;
    }
  }
  const result = await client.rpc('rpc_hospital_ticket_action', {
    p_ticket_id: current.ticket.id,
    p_actor_user_id: actor.user.id,
    p_action: effectiveAction,
    p_expected_version: Number(expectedVersion),
    p_payload: payload,
    p_operations_sla_minutes: slaMinutes().operations,
  });
  if (result.error) throw result.error;
  const detail = await getHospitalTicket(client, actor, current.ticket.id);
  if (effectiveAction === 'resolve') {
    await safeWriteContactAwaitingConfirmationNotification(client, {
      beforeTicket: current.ticket,
      afterTicket: detail.ticket,
    });
  }
  await safeWriteHospitalLifecycleNotifications(client, {
    action: effectiveAction,
    actor,
    beforeTicket: current.ticket,
    afterTicket: detail.ticket,
  });
  return detail;
}

async function safeWriteContactAwaitingConfirmationNotification(client, { beforeTicket = null, afterTicket = null } = {}) {
  const ticket = afterTicket || beforeTicket || {};
  if (ticket.status_code !== 'resolved_awaiting_confirmation' || !ticket.raised_by_client_contact_id) return { inserted: 0 };
  const ticketId = cleanHospitalText(ticket.id || beforeTicket?.id, 80);
  const ticketNo = cleanHospitalText(ticket.ticket_no || beforeTicket?.ticket_no, 80) || 'This ticket';
  const contactId = cleanHospitalText(ticket.raised_by_client_contact_id, 80);
  const version = Number(ticket.version || beforeTicket?.version || 0);
  const cycle = Number(ticket.reopen_count ?? beforeTicket?.reopen_count ?? 0);
  if (!ticketId || !contactId) return { inserted: 0 };
  const row = {
    ticket_id: ticketId,
    recipient_user_id: null,
    recipient_client_contact_id: contactId,
    notification_type: 'awaiting_confirmation',
    title: 'Work Completed',
    body: `QPMS has completed ticket ${ticketNo}. Please review the work and confirm the service.`,
    priority: cleanHospitalText(ticket.priority || beforeTicket?.priority, 20) || null,
    current_owner_role: cleanHospitalText(ticket.current_assignee_role || beforeTicket?.current_assignee_role, 80) || null,
    escalation_level: Number(ticket.current_escalation_level_no || beforeTicket?.current_escalation_level_no || 0) || null,
    dedupe_key: hospitalLifecycleNotificationDedupeKey({
      ticketId,
      recipientUserId: contactId,
      notificationType: 'awaiting_confirmation',
      version,
      cycle,
    }),
    metadata: {
      ticket_id: ticketId,
      ticket_no: ticketNo,
      ticket_version: version,
      reopen_count: cycle,
      recipient_identity_type: 'client_contact',
      app_scope: 'qpms_client',
      target_screen: 'ticket_feedback',
    },
  };
  try {
    const result = await client
      .from('hospital_ticket_notifications')
      .upsert(row, { onConflict: 'dedupe_key', ignoreDuplicates: true });
    if (result.error) throw result.error;
    return { inserted: 1 };
  } catch (error) {
    console.warn('[Hospital Notifications] contact confirmation write skipped', {
      ticketId,
      contactId,
      code: error?.code || null,
      message: error?.message || 'unknown',
    });
    return { inserted: 0, failed: true };
  }
}

async function requireCurrentOperationalOwner(client, actor, ticket) {
  if (actor.user.profile_type !== 'internal' || actor.user.role_code === 'admin') return;
  if (ticket.current_assignee_user_id === actor.user.id) return;
  const error = new Error('Only the current operational owner can resolve this ticket.');
  error.code = '42501';
  throw error;
}

async function requireCompletionEvidence(client, ticketId) {
  const result = await client
    .from('hospital_ticket_attachments')
    .select('id')
    .eq('ticket_id', ticketId)
    .eq('attachment_type', 'completion_photo')
    .limit(1);
  if (result.error) throw result.error;
  if ((result.data || []).length > 0) return;
  const error = new Error('Upload completion evidence before resolving this ticket.');
  error.code = '22023';
  throw error;
}

async function performClientTicketCancellation(client, actor, ticket, payload = {}) {
  const reasonCode = cleanHospitalText(payload.reason_code || payload.reasonCode, 80);
  const reasonText = cleanHospitalText(payload.reason_text || payload.reasonText || cancellationReasonLabel(reasonCode), 500);
  const now = new Date().toISOString();
  const updated = await client
    .from('hospital_tickets')
    .update({
      status_code: 'cancelled',
      escalation_due_at: null,
      acceptance_status: ticket.acceptance_status === 'awaiting'
        ? 'not_required'
        : ticket.acceptance_status || 'not_required',
      version: ticket.version + 1,
      updated_at: now,
      metadata: {
        ...(ticket.metadata || {}),
        cancellation: {
          by_user_id: actor.user.id,
          by_role: actor.user.role_code,
          reason_code: reasonCode,
          reason_text: reasonText,
          cancelled_at: now,
        },
      },
    })
    .eq('id', ticket.id)
    .eq('version', ticket.version)
    .select(TICKET_SELECT)
    .maybeSingle();
  if (updated.error) throw updated.error;
  if (!updated.data) {
    const error = new Error('Ticket version conflict.');
    error.code = '40001';
    throw error;
  }

  const event = await client.from('hospital_ticket_events').insert({
    ticket_id: ticket.id,
    event_type: 'ticket_cancelled_by_client',
    from_status: ticket.status_code,
    to_status: 'cancelled',
    actor_user_id: actor.user.id,
    actor_name: actor.user.display_name,
    actor_role: actor.user.role_code,
    remarks: reasonText,
    event_data: {
      reason_code: reasonCode,
      cancelled_by_client: true,
      is_client_visible: true,
    },
  });
  if (event.error) throw event.error;

  if (ticket.current_assignee_user_id) {
    const notification = await client.from('hospital_ticket_notifications').insert({
      ticket_id: ticket.id,
      recipient_user_id: ticket.current_assignee_user_id,
      notification_type: 'ticket_cancelled',
      title: 'Ticket Cancelled by Client',
      body: `${ticket.ticket_no} was cancelled by the client.`,
      priority: ticket.priority,
      current_owner_role: ticket.current_assignee_role,
      escalation_level: ticket.current_escalation_level_no,
      metadata: {
        ticket_no: ticket.ticket_no,
        reason_code: reasonCode,
      },
    });
    if (notification.error) throw notification.error;
  }
  const notifications = await client.from('hospital_ticket_notifications')
    .update({
      action_status: 'superseded',
      superseded_at: now,
      superseded_reason: 'ticket_cancelled_by_client',
    })
    .eq('ticket_id', ticket.id)
    .eq('notification_type', 'incoming_supervisor_ticket')
    .eq('action_status', 'active');
  if (notifications.error) throw notifications.error;

  return getHospitalTicket(client, actor, ticket.id);
}

function cancellationReasonLabel(code) {
  return {
    raised_by_mistake: 'Raised by mistake',
    issue_already_resolved: 'Issue already resolved / no longer required',
    duplicate_complaint: 'Duplicate complaint',
    wrong_location_or_category: 'Wrong location or complaint category',
    other: 'Other',
  }[code] || 'Client cancelled the ticket';
}

async function performManualHospitalReassignment(client, actor, ticket, { targetRole, remarks, eventType }) {
  const normalizedTargetRole = cleanHospitalText(targetRole, 80);
  if (!['housekeeping_supervisor', 'operations_executive', 'facility_manager', 'project_head'].includes(normalizedTargetRole)) {
    const error = new Error('Unsupported reassignment target role.');
    error.code = '22023';
    throw error;
  }
  let assigneeQuery = client.from('hospital_ticket_users')
    .select('id,display_name,role_code')
    .eq('client_id', ticket.client_id)
    .eq('role_code', normalizedTargetRole)
    .eq('is_active', true)
    .order('created_at')
    .limit(1);
  if (normalizedTargetRole === 'housekeeping_supervisor') {
    assigneeQuery = client.from('hospital_ticket_users')
      .select('id,display_name,role_code,scopes:hospital_ticket_user_scopes!inner(block_id,can_update)')
      .eq('client_id', ticket.client_id)
      .eq('role_code', normalizedTargetRole)
      .eq('is_active', true)
      .eq('scopes.block_id', ticket.block_id)
      .eq('scopes.can_update', true)
      .order('created_at')
      .limit(1);
  }
  const assigneeResult = await assigneeQuery;
  if (assigneeResult.error) throw assigneeResult.error;
  const assignee = (assigneeResult.data || [])[0];
  if (!assignee?.id) {
    const error = new Error(`No active ${normalizedTargetRole.replaceAll('_', ' ')} is available for this ticket.`);
    error.code = '22023';
    throw error;
  }

  const update = {
    current_assignee_user_id: assignee.id,
    version: ticket.version + 1,
    updated_at: new Date().toISOString(),
    metadata: {
      ...(ticket.metadata || {}),
      last_manual_reassignment: {
        by_user_id: actor.user.id,
        by_role: actor.user.role_code,
        to_user_id: assignee.id,
        to_role: normalizedTargetRole,
        preserves_sla_deadline: true,
      },
    },
  };
  if (normalizedTargetRole === 'housekeeping_supervisor') update.supervisor_user_id = assignee.id;
  if (normalizedTargetRole === 'operations_executive') update.operations_executive_user_id = assignee.id;
  if (normalizedTargetRole === 'facility_manager') update.facility_manager_user_id = assignee.id;
  if (normalizedTargetRole === 'project_head') update.project_head_user_id = assignee.id;

  const updated = await client.from('hospital_tickets')
    .update(update)
    .eq('id', ticket.id)
    .eq('version', ticket.version)
    .select(TICKET_SELECT)
    .maybeSingle();
  if (updated.error) throw updated.error;
  if (!updated.data) {
    const error = new Error('Ticket version conflict.');
    error.code = '40001';
    throw error;
  }

  const now = new Date().toISOString();
  const history = await client.from('hospital_ticket_assignment_history').insert({
    ticket_id: ticket.id,
    from_user_id: ticket.current_assignee_user_id || null,
    to_user_id: assignee.id,
    assignment_type: 'manual_reassignment',
    reason: cleanHospitalText(remarks, 500),
    assigned_by_user_id: actor.user.id,
    source: 'manual',
    previous_status: ticket.status_code,
    resulting_status: ticket.status_code,
    assigned_at: now,
    metadata: {
      target_role: normalizedTargetRole,
      previous_escalation_due_at: ticket.escalation_due_at || null,
      previous_escalation_level_no: ticket.current_escalation_level_no || null,
      preserves_sla_deadline: true,
    },
  });
  if (history.error) throw history.error;
  const event = await client.from('hospital_ticket_events').insert({
    ticket_id: ticket.id,
    event_type: eventType,
    from_status: ticket.status_code,
    to_status: ticket.status_code,
    actor_user_id: actor.user.id,
    actor_name: actor.user.display_name,
    actor_role: actor.user.role_code,
    remarks: cleanHospitalText(remarks, 500),
    event_data: {
      target_user_id: assignee.id,
      target_role: normalizedTargetRole,
      preserved_escalation_due_at: ticket.escalation_due_at || null,
      preserved_escalation_level_no: ticket.current_escalation_level_no || null,
      manual_reassignment: true,
    },
  });
  if (event.error) throw event.error;
  const detail = await getHospitalTicket(client, actor, ticket.id);
  await safeWriteHospitalLifecycleNotifications(client, {
    action: 'manual_reassignment',
    actor,
    beforeTicket: ticket,
    afterTicket: detail.ticket,
    targetUserId: assignee.id,
  });
  return detail;
}

export function buildHospitalLifecycleNotificationRows({
  action,
  actor,
  beforeTicket = null,
  afterTicket = null,
  targetUserId = null,
} = {}) {
  const ticket = afterTicket || beforeTicket || {};
  const beforeStatus = beforeTicket?.status_code || '';
  const afterStatus = ticket?.status_code || '';
  const ticketId = cleanHospitalText(ticket.id || beforeTicket?.id, 80);
  const ticketNo = cleanHospitalText(ticket.ticket_no || beforeTicket?.ticket_no, 80) || 'This ticket';
  const raisedByUserId = cleanHospitalText(ticket.raised_by_user_id || beforeTicket?.raised_by_user_id, 80);
  const version = Number(ticket.version || beforeTicket?.version || 0);
  const cycle = Number(ticket.reopen_count ?? beforeTicket?.reopen_count ?? 0);
  const priority = cleanHospitalText(ticket.priority || beforeTicket?.priority, 20) || null;
  const rows = [];
  const clientMetadata = {
    ticket_id: ticketId,
    ticket_no: ticketNo,
    ticket_version: version,
    reopen_count: cycle,
    app_scope: 'qpms_client',
  };

  const pushClientRow = (notificationType, title, body, targetScreen = 'ticket_detail') => {
    if (!ticketId || !raisedByUserId) return;
    rows.push({
      ticket_id: ticketId,
      recipient_user_id: raisedByUserId,
      notification_type: notificationType,
      title,
      body,
      priority,
      current_owner_role: cleanHospitalText(ticket.current_assignee_role || beforeTicket?.current_assignee_role, 80) || null,
      escalation_level: Number(ticket.current_escalation_level_no || beforeTicket?.current_escalation_level_no || 0) || null,
      dedupe_key: hospitalLifecycleNotificationDedupeKey({
        ticketId,
        recipientUserId: raisedByUserId,
        notificationType,
        version,
        cycle,
      }),
      metadata: {
        ...clientMetadata,
        target_screen: targetScreen,
      },
    });
  };

  if (action === 'ticket_created') {
    pushClientRow(
      'ticket_created',
      'Ticket Raised Successfully',
      `${ticketNo} has been raised and our team has been notified.`,
    );
  } else if (action === 'accept' && beforeStatus !== 'accepted' && afterStatus === 'accepted') {
    pushClientRow(
      'ticket_accepted',
      'Ticket Accepted',
      `Your ticket ${ticketNo} has been accepted by the QPMS team.`,
    );
  } else if (action === 'start_work' && beforeStatus !== 'in_progress' && afterStatus === 'in_progress') {
    pushClientRow(
      'work_started',
      'Work Started',
      `Work has started on ticket ${ticketNo}.`,
    );
  } else if (action === 'feedback' && beforeStatus === 'resolved_awaiting_confirmation' && afterStatus === 'reopened') {
    pushClientRow(
      'ticket_reopened_client',
      'Ticket Reopened',
      `${ticketNo} has been reopened and the QPMS team has been notified.`,
    );
  } else if (action === 'manual_reassignment') {
    const recipientUserId = cleanHospitalText(targetUserId, 80);
    if (ticketId && recipientUserId) {
      rows.push({
        ticket_id: ticketId,
        recipient_user_id: recipientUserId,
        notification_type: 'ticket_assigned_internal',
        title: 'Ticket Assigned',
        body: `${ticketNo} has been assigned to you.`,
        priority,
        current_owner_role: cleanHospitalText(ticket.current_assignee_role || beforeTicket?.current_assignee_role, 80) || null,
        escalation_level: Number(ticket.current_escalation_level_no || beforeTicket?.current_escalation_level_no || 0) || null,
        dedupe_key: hospitalLifecycleNotificationDedupeKey({
          ticketId,
          recipientUserId,
          notificationType: 'ticket_assigned_internal',
          version,
          cycle,
        }),
        metadata: {
          ticket_id: ticketId,
          ticket_no: ticketNo,
          ticket_version: version,
          reopen_count: cycle,
          app_scope: 'myqpms_internal',
          target_screen: 'ticket_detail',
        },
      });
    }
  }

  return rows;
}

export function hospitalLifecycleNotificationDedupeKey({
  ticketId,
  recipientUserId,
  notificationType,
  version = 0,
  cycle = 0,
} = {}) {
  if (!ticketId || !recipientUserId || !notificationType) return null;
  return [
    'hospital_ticket_notification',
    cleanHospitalText(notificationType, 80),
    cleanHospitalText(ticketId, 80),
    cleanHospitalText(recipientUserId, 80),
    String(Number(version) || 0),
    String(Number(cycle) || 0),
  ].join(':');
}

async function safeWriteHospitalLifecycleNotifications(client, context) {
  await standardizeHospitalLifecycleNotificationCopy(client, context);
  const rows = buildHospitalLifecycleNotificationRows(context);
  if (!rows.length) return { inserted: 0 };
  try {
    const result = await client
      .from('hospital_ticket_notifications')
      .upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true });
    if (result.error) throw result.error;
    return { inserted: rows.length };
  } catch (error) {
    console.warn('[Hospital Notifications] lifecycle write skipped', {
      action: context?.action || null,
      ticketId: context?.afterTicket?.id || context?.beforeTicket?.id || null,
      code: error?.code || null,
      message: error?.message || 'unknown',
    });
    return { inserted: 0, failed: true };
  }
}

async function standardizeHospitalLifecycleNotificationCopy(client, context) {
  const ticket = context?.afterTicket || context?.beforeTicket || {};
  const ticketId = cleanHospitalText(ticket.id, 80);
  const ticketNo = cleanHospitalText(ticket.ticket_no, 80) || 'This ticket';
  if (!ticketId) return;
  try {
    if (context.action === 'resolve' && ticket.status_code === 'resolved_awaiting_confirmation') {
      const dedupeKey = hospitalLifecycleNotificationDedupeKey({
        ticketId,
        recipientUserId: ticket.raised_by_user_id,
        notificationType: 'awaiting_confirmation',
        version: ticket.version,
        cycle: ticket.reopen_count,
      });
      const result = await client
        .from('hospital_ticket_notifications')
        .update({
          title: 'Ticket Resolved - Please Confirm',
          body: `QPMS has marked ${ticketNo} as resolved. Please review the work and confirm your satisfaction.`,
          metadata: {
            ticket_id: ticketId,
            ticket_no: ticketNo,
            ticket_version: ticket.version || null,
            reopen_count: ticket.reopen_count ?? null,
            app_scope: 'qpms_client',
            target_screen: 'ticket_feedback',
          },
        })
        .eq('ticket_id', ticketId)
        .eq('recipient_user_id', ticket.raised_by_user_id)
        .eq('notification_type', 'awaiting_confirmation')
        .eq('dedupe_key', dedupeKey);
      if (result.error) throw result.error;
    }
    if (context.action === 'feedback' && ticket.status_code === 'reopened') {
      const result = await client
        .from('hospital_ticket_notifications')
        .update({
          title: 'Ticket Reopened by Client',
          body: `${ticketNo} was marked Not Satisfied and requires further action.`,
          priority: ticket.priority || null,
          current_owner_role: ticket.current_assignee_role || null,
          escalation_level: ticket.current_escalation_level_no || null,
        })
        .eq('ticket_id', ticketId)
        .eq('notification_type', 'ticket_reopened');
      if (result.error) throw result.error;
    }
  } catch (error) {
    console.warn('[Hospital Notifications] copy standardization skipped', {
      action: context?.action || null,
      ticketId,
      code: error?.code || null,
      message: error?.message || 'unknown',
    });
  }
}

export function hospitalSlaState(ticket, now = new Date()) {
  let dueAt = ticket.escalation_due_at || null;
  if (!dueAt && ['open', 'awaiting_supervisor_acceptance', 'assigned', 'accepted', 'in_progress', 'reopened'].includes(ticket.status_code)) dueAt = ticket.supervisor_sla_due_at;
  if (!dueAt && ticket.status_code === 'escalated_operations_executive') dueAt = ticket.operations_sla_due_at;
  if (!dueAt && ticket.status_code === 'escalated_project_head') dueAt = ticket.project_head_sla_due_at;
  if (!dueAt && ticket.status_code === 'escalated_hospital_dean') dueAt = ticket.dean_sla_due_at;
  if (!dueAt) return { state: 'not_applicable', due_at: null, remaining_seconds: 0 };
  const remaining = Math.floor((new Date(dueAt).getTime() - now.getTime()) / 1000);
  return {
    state: remaining < 0 ? 'breached' : remaining <= 300 ? 'near_breach' : 'healthy',
    due_at: dueAt,
    remaining_seconds: remaining,
    current_owner_role: ticket.current_assignee_role || null,
    escalation_level: ticket.current_escalation_level_no || null,
    final_escalation: ticket.final_escalation === true,
  };
}

export function allowedActionsForTicket(actor, ticket) {
  return hospitalAllowedActions(actor.user).filter((action) => {
    const mapped = action === 'manual_escalation' ? 'manual_escalation' : action;
    return validateHospitalAction({
      role: actor.user.role_code,
      status: ticket.status_code,
      action: mapped,
      payload: action === 'progress'
        ? { remarks: 'check' }
        : action === 'resolve'
          ? { resolution_action: 'check', resolution_remarks: 'check' }
          : action === 'feedback'
            ? { rating: 5, satisfaction_status: 'satisfied' }
            : action === 'cancel'
              ? { reason_code: 'raised_by_mistake' }
              : {},
    }).length === 0;
  });
}

export async function hospitalDashboard(client, actor) {
  const tickets = await listHospitalTickets(client, actor, {});
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  const count = (status) => tickets.filter((row) => row.status_code === status).length;
  const urgent = tickets.filter((row) => !['closed', 'cancelled', 'resolved_awaiting_confirmation'].includes(row.status_code)).map((ticket) => ({ ...ticket, sla: hospitalSlaState(ticket, now) })).sort((a, b) => {
    const rank = (item) => item.sla.state === 'breached' ? 0 : item.sla.state === 'near_breach' ? 1 : 2;
    return rank(a) - rank(b) || a.sla.remaining_seconds - b.sla.remaining_seconds || ['critical', 'high', 'medium', 'low'].indexOf(a.priority) - ['critical', 'high', 'medium', 'low'].indexOf(b.priority) || new Date(a.raised_at) - new Date(b.raised_at);
  }).slice(0, 20);
  return {
    counts: {
      new_complaints: tickets.filter((row) => row.status_code === 'open' && now - new Date(row.raised_at) <= 10 * 60 * 1000).length,
      awaiting_supervisor_acceptance: count('awaiting_supervisor_acceptance'),
      open: count('open'), assigned: count('assigned'),
      in_progress: count('accepted') + count('in_progress'),
      near_sla_breach: urgent.filter((row) => row.sla.state === 'near_breach').length,
      escalated: count('escalated_operations_executive') + count('escalated_facility_manager') + count('escalated_project_head'),
      resolved_awaiting_confirmation: count('resolved_awaiting_confirmation'),
      reopened: count('reopened'),
      closed_today: tickets.filter((row) => row.status_code === 'closed' && row.closed_at && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(row.closed_at)) === today).length,
    },
    urgent_tickets: urgent,
  };
}

export async function createAttachmentUpload(client, actor, ticketId, body) {
  const detail = await getHospitalTicket(client, actor, ticketId);
  const type = cleanHospitalText(body.attachment_type, 40);
  if (!['complaint_photo', 'progress_photo', 'completion_photo', 'supporting_document'].includes(type)) { const error = new Error('Unsupported attachment type.'); error.code = '22023'; throw error; }
  const mime = cleanHospitalText(body.mime_type, 80).toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) { const error = new Error('Only JPEG, PNG, and WebP images are supported.'); error.code = '22023'; throw error; }
  const existing = await client.from('hospital_ticket_attachments').select('id').eq('ticket_id', detail.ticket.id).eq('attachment_type', type);
  if (existing.error) throw existing.error;
  if (type === 'complaint_photo' && (existing.data || []).length >= 3) { const error = new Error('A maximum of three complaint photos is allowed.'); error.code = '22023'; throw error; }
  const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const path = `${actor.user.client_id}/${detail.ticket.id}/${type}/${randomUUID()}.${extension}`;
  const signed = await client.storage.from('hospital-ticket-attachments').createSignedUploadUrl(path);
  if (signed.error) throw signed.error;
  return { storage_path: path, signed_url: signed.data.signedUrl, token: signed.data.token, expires_in: 7200 };
}

export async function completeAttachment(client, actor, ticketId, body) {
  const detail = await getHospitalTicket(client, actor, ticketId);
  const path = cleanHospitalText(body.storage_path, 500);
  if (!path.startsWith(`${actor.user.client_id}/${detail.ticket.id}/`)) { const error = new Error('Attachment path is outside this ticket.'); error.code = '42501'; throw error; }
  const size = Number(body.size_bytes);
  if (!Number.isInteger(size) || size < 1 || size > 10485760) { const error = new Error('Attachment size must be between 1 byte and 10 MB.'); error.code = '22023'; throw error; }
  const object = await client.storage.from('hospital-ticket-attachments').list(path.substring(0, path.lastIndexOf('/')), { search: path.split('/').pop(), limit: 1 });
  if (object.error) throw object.error;
  if (!(object.data || []).some((row) => row.name === path.split('/').pop())) { const error = new Error('Uploaded object was not found.'); error.code = '22023'; throw error; }
  const inserted = await client.rpc('rpc_complete_hospital_attachment', {
    p_ticket_id: detail.ticket.id,
    p_actor_user_id: actor.user.id,
    p_attachment_type: body.attachment_type,
    p_storage_path: path,
    p_original_filename: cleanHospitalText(body.original_filename, 240),
    p_mime_type: cleanHospitalText(body.mime_type, 80).toLowerCase(),
    p_size_bytes: size,
    p_is_client_visible: body.is_client_visible === true || body.attachment_type === 'complaint_photo' || body.attachment_type === 'completion_photo',
  });
  if (inserted.error) throw inserted.error;
  return inserted.data;
}

export async function signedAttachmentDownload(client, actor, ticketId, attachmentId) {
  const detail = await getHospitalTicket(client, actor, ticketId);
  const attachment = detail.attachments.find((row) => row.id === attachmentId);
  if (!attachment) { const error = new Error('Attachment was not found in your authorized view.'); error.code = '42501'; throw error; }
  const signed = await client.storage.from(attachment.storage_bucket).createSignedUrl(attachment.storage_path, 300);
  if (signed.error) throw signed.error;
  return { signed_url: signed.data.signedUrl, expires_in: 300 };
}
