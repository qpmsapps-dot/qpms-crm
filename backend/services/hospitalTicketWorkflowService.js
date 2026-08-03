const ACTIVE_STATUSES = new Set(['open', 'awaiting_supervisor_acceptance', 'assigned', 'accepted', 'in_progress', 'reopened']);
const PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const PRIORITY_SLA_MINUTES = {
  critical: 10,
  high: 10,
  medium: 15,
  low: 20,
};
const ESCALATION_LEVELS = [
  { level: 1, code: 'supervisor', role: 'housekeeping_supervisor', label: 'Supervisor' },
  { level: 2, code: 'operations_executive', role: 'operations_executive', label: 'Operations Executive' },
  { level: 3, code: 'facility_manager', role: 'facility_manager', label: 'Facility Manager' },
  { level: 4, code: 'project_head', role: 'project_head', label: 'Project Head' },
];

export function cleanHospitalText(value, maxLength = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function normalizeHospitalTicketCreate(body = {}) {
  return {
    blockId: cleanHospitalText(body.block_id || body.blockId, 80),
    floorId: cleanHospitalText(body.floor_id || body.floorId, 80),
    departmentId: cleanHospitalText(body.department_id || body.departmentId, 80),
    locationId: cleanHospitalText(body.location_id || body.locationId, 80),
    categoryId: cleanHospitalText(body.category_id || body.categoryId, 80),
    priority: cleanHospitalText(body.priority, 20).toLowerCase(),
    title: cleanHospitalText(body.title, 160),
    description: cleanHospitalText(body.description, 1500),
    exactLandmark: cleanHospitalText(body.exact_landmark || body.exactLandmark, 180),
    idempotencyKey: cleanHospitalText(body.idempotency_key || body.idempotencyKey, 160),
  };
}

export function validateHospitalTicketCreate(payload) {
  const errors = [];
  if (!payload.blockId) errors.push('Block is required.');
  if (!payload.locationId && !cleanHospitalText(payload.exactLandmark, 180)) errors.push('Select a room/area or provide an exact location landmark.');
  if (!payload.locationId && !cleanHospitalText(payload.departmentId, 80)) errors.push('Select a department/unit for landmark-only tickets.');
  if (!payload.categoryId) errors.push('Category is required.');
  if (!PRIORITIES.has(payload.priority)) errors.push('Priority must be low, medium, high, or critical.');
  if (!payload.title) errors.push('Title is required.');
  if (!payload.description) errors.push('Description is required.');
  if (!payload.idempotencyKey) errors.push('Idempotency key is required.');
  return errors;
}

export function validateHospitalAction({ role, status, action, payload = {} }) {
  const allowed = {
    accept: role === 'housekeeping_supervisor' && ['awaiting_supervisor_acceptance', 'open', 'assigned', 'reopened'].includes(status),
    start_work: role === 'housekeeping_supervisor' && ['accepted', 'reopened'].includes(status),
    progress:
      (role === 'housekeeping_supervisor' && ACTIVE_STATUSES.has(status) && status !== 'awaiting_supervisor_acceptance')
      || (role === 'operations_executive' && status === 'escalated_operations_executive')
      || (role === 'facility_manager' && ['escalated_facility_manager', 'reopened'].includes(status))
      || (role === 'project_head' && status === 'escalated_project_head'),
    request_assistance: role === 'housekeeping_supervisor' && ACTIVE_STATUSES.has(status) && status !== 'awaiting_supervisor_acceptance',
    manual_escalation: role === 'housekeeping_supervisor' && ACTIVE_STATUSES.has(status) && status !== 'awaiting_supervisor_acceptance',
    escalate_facility: role === 'operations_executive' && status === 'escalated_operations_executive',
    take_over:
      (role === 'operations_executive' && status === 'escalated_operations_executive')
      || (role === 'facility_manager' && status === 'escalated_facility_manager')
      || (role === 'project_head' && status === 'escalated_project_head'),
    reassign_supervisor: role === 'operations_executive'
      && !['closed', 'cancelled', 'resolved_awaiting_confirmation'].includes(status),
    assign_support: role === 'facility_manager'
      && !['closed', 'cancelled', 'resolved_awaiting_confirmation'].includes(status),
    resolve:
      (role === 'housekeeping_supervisor' && ['accepted', 'in_progress', 'reopened'].includes(status))
      || (role === 'operations_executive' && status === 'escalated_operations_executive')
      || (role === 'facility_manager' && ['escalated_facility_manager', 'reopened'].includes(status))
      || (role === 'project_head' && status === 'escalated_project_head'),
    feedback: ['doctor', 'hospital_management'].includes(role) && status === 'resolved_awaiting_confirmation',
  };
  if (!allowed[action]) return ['This status transition is not allowed.'];
  const errors = [];
  if (['progress', 'request_assistance', 'assign_support'].includes(action) && !cleanHospitalText(payload.remarks)) errors.push('Remarks are required.');
  if (action === 'resolve') {
    if (!cleanHospitalText(payload.resolution_action)) errors.push('Resolution action is required.');
    if (!cleanHospitalText(payload.resolution_remarks)) errors.push('Resolution remarks are required.');
  }
  if (action === 'feedback') {
    const rating = Number(payload.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.push('Rating must be from 1 to 5.');
    if (!['satisfied', 'not_satisfied'].includes(payload.satisfaction_status)) errors.push('Select Satisfied or Not Satisfied.');
    if (payload.satisfaction_status === 'not_satisfied' && !cleanHospitalText(payload.comments)) errors.push('A reopening reason is required.');
  }
  return errors;
}

export function slaMinutes(environment = process.env) {
  const supervisor = Number(environment.HOSPITAL_SUPERVISOR_SLA_MINUTES || PRIORITY_SLA_MINUTES.low);
  const operations = Number(environment.HOSPITAL_OPERATIONS_SLA_MINUTES || PRIORITY_SLA_MINUTES.medium);
  return {
    supervisor: Number.isInteger(supervisor) && supervisor > 0 ? supervisor : PRIORITY_SLA_MINUTES.low,
    operations: Number.isInteger(operations) && operations > 0 ? operations : PRIORITY_SLA_MINUTES.medium,
    matrix: {
      critical: PRIORITY_SLA_MINUTES.critical,
      high: PRIORITY_SLA_MINUTES.high,
      medium: PRIORITY_SLA_MINUTES.medium,
      low: PRIORITY_SLA_MINUTES.low,
    },
  };
}

export function normalizedHospitalSlaPriority(priority) {
  const value = cleanHospitalText(priority || 'medium', 20).toLowerCase();
  if (value === 'high') return 'critical';
  if (value === 'critical' || value === 'medium' || value === 'low') return value;
  return 'medium';
}

export function prioritySlaMinutes(priority) {
  return PRIORITY_SLA_MINUTES[cleanHospitalText(priority || 'medium', 20).toLowerCase()] || PRIORITY_SLA_MINUTES.medium;
}

export function hospitalEscalationLevels() {
  return ESCALATION_LEVELS.map((level) => ({ ...level }));
}

export function hospitalEscalationRoleForLevel(level) {
  return ESCALATION_LEVELS.find((item) => item.level === Number(level)) || ESCALATION_LEVELS[0];
}

export function safeHospitalError(response, error) {
  const conflict = error?.code === '40001' || /version conflict/i.test(error?.message || '');
  const forbidden = error?.code === '42501';
  const invalid = error?.code === '22023';
  response.status(conflict ? 409 : forbidden ? 403 : invalid ? 400 : error?.statusCode || 500).json({
    ok: false,
    code: conflict ? 'ticket_version_conflict' : forbidden ? 'hospital_access_denied' : invalid ? 'invalid_ticket_request' : 'hospital_ticket_failed',
    message: conflict
      ? 'This ticket changed after it was loaded. Refresh and try again.'
      : forbidden || invalid
        ? error.message
        : 'Hospital Ticketing request failed. Please try again.',
  });
}

export const hospitalPriorityCodes = PRIORITIES;
