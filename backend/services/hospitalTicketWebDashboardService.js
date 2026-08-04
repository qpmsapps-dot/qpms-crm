import { resolveCurrentUserAccess } from './accessControlService.js';
import { hospitalSlaState } from './hospitalTicketService.js';

const WEB_ROLE_KEYS = new Set([
  'ADMIN',
  'QPMSADMIN',
  'DEVELOPER',
  'MANAGEMENT',
  'MD',
  'COO',
  'GM',
  'TOPMANAGEMENT',
  'PROJECTCOORDINATOR',
  'BRANCHHEAD',
  'OPERATIONSMANAGER',
  'OPERATIONSMANAGER',
  'OPERATIONS',
  'OPERATIONSEXECUTIVE',
  'FACILITYMANAGER',
  'PROJECTHEAD',
  'EXISTINGBUSINESSOPERATIONSTEAM',
  'DEMOVIEWER',
]);

const SAFE_PAGE_SIZE_MAX = 100;
const ACTIVE_SUPERVISOR_SLA_STATUSES = ['open', 'awaiting_supervisor_acceptance', 'assigned', 'accepted', 'in_progress', 'reopened'];
const ESCALATED_STATUSES = ['escalated_operations_executive', 'escalated_facility_manager', 'escalated_project_head'];
const CLOSED_STATUSES = ['closed', 'cancelled'];

const TICKET_WEB_SELECT = `
  *,
  client:hospital_clients(id,client_code,client_name),
  block:hospital_blocks(id,block_code,block_name),
  category:hospital_ticket_categories(id,category_code,category_name),
  assignee:hospital_ticket_users!hospital_tickets_current_assignee_user_id_fkey(id,display_name,role_code),
  supervisor:hospital_ticket_users!hospital_tickets_supervisor_user_id_fkey(id,display_name,role_code),
  resolved_by:hospital_ticket_users!hospital_tickets_resolved_by_user_id_fkey(id,display_name,role_code),
  accepted_by:hospital_ticket_users!hospital_tickets_accepted_by_user_id_fkey(id,display_name,role_code)
`;

function clean(value, maxLength = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function roleKey(role) {
  return clean(role, 80).toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function parsePositiveInt(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function isoStart(value) {
  const text = clean(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return `${text}T00:00:00+05:30`;
}

function isoEnd(value) {
  const text = clean(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return `${text}T23:59:59.999+05:30`;
}

function truthy(value) {
  return ['true', '1', 'yes'].includes(clean(value, 8).toLowerCase());
}

function escapeLike(value) {
  return clean(value, 120).replace(/[\\%_,]/g, (match) => `\\${match}`);
}

function isWebManagementProfile(profile) {
  if (!profile || profile.is_active !== true || profile.web_access_enabled === false) return false;
  const status = roleKey(profile.status || 'ACTIVE');
  if (['INACTIVE', 'DISABLED', 'DEACTIVATED'].includes(status)) return false;
  return WEB_ROLE_KEYS.has(roleKey(profile.role));
}

function scopeValue(scope = {}) {
  return clean(scope.scope_id || scope.scope_code || scope.scope_text, 80);
}

function assignmentHasPermission(assignment, permission) {
  return (assignment.permissions || []).some((code) => clean(code).toLowerCase() === permission);
}

function assignmentModuleAllowed(assignment) {
  const moduleCode = clean(assignment.module?.code).toLowerCase();
  return ['client_ticketing', 'hospital_operations'].includes(moduleCode);
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

export async function resolveHospitalWebAccess({ client, authUser, profile }) {
  if (!authUser?.id) {
    return { allowed: false, status: 401, code: 'authentication_required', message: 'Supabase Bearer token required.' };
  }

  const unified = await resolveCurrentUserAccess({
    client,
    authUser,
    profile,
    requestedPermission: 'hospital_ticket.view',
  });

  const unifiedAssignments = (unified.assignments || [])
    .filter(assignmentModuleAllowed)
    .filter((assignment) => assignmentHasPermission(assignment, 'hospital_ticket.view'));

  if (unifiedAssignments.length) {
    return {
      allowed: true,
      source: 'unified',
      broad: unifiedAssignments.some((assignment) => (assignment.scopes || []).some((scope) => scope.scope_type === 'global')),
      assignments: unifiedAssignments,
      clientIds: unique(unifiedAssignments.map((assignment) => assignment.client?.id)),
      blockIds: unique(unifiedAssignments.flatMap((assignment) => (assignment.scopes || [])
        .filter((scope) => scope.scope_type === 'hospital_block')
        .map(scopeValue))),
    };
  }

  if (unified.source === 'unified_denied') {
    return { allowed: false, status: 403, code: unified.code || 'access_denied', message: unified.message || 'Hospital ticket dashboard access denied.' };
  }

  if (isWebManagementProfile(profile)) {
    return { allowed: true, source: 'legacy_web_management', broad: true, assignments: [] };
  }

  const legacyAssignments = (unified.assignments || [])
    .filter((assignment) => assignment.assignment_source === 'legacy_hospital' || assignment.source === 'legacy_hospital')
    .filter((assignment) => assignmentHasPermission(assignment, 'hospital_ticket.view'));

  if (legacyAssignments.length) {
    return {
      allowed: true,
      source: 'legacy_hospital',
      broad: false,
      assignments: legacyAssignments,
      clientIds: unique(legacyAssignments.map((assignment) => assignment.client?.id)),
      blockIds: unique(legacyAssignments.flatMap((assignment) => (assignment.scopes || [])
        .filter((scope) => scope.scope_type === 'hospital_block')
        .map(scopeValue))),
      locationIds: unique(legacyAssignments.flatMap((assignment) => (assignment.scopes || [])
        .filter((scope) => scope.scope_type === 'location')
        .map(scopeValue))),
    };
  }

  return { allowed: false, status: 403, code: 'hospital_web_access_denied', message: 'Hospital ticket dashboard access denied.' };
}

function applyAccessScope(query, access) {
  if (access.broad) return query;
  if (access.clientIds?.length) query = query.in('client_id', access.clientIds);
  if (access.blockIds?.length && access.locationIds?.length) {
    query = query.or(`block_id.in.(${access.blockIds.join(',')}),location_id.in.(${access.locationIds.join(',')})`);
  } else if (access.blockIds?.length) {
    query = query.in('block_id', access.blockIds);
  } else if (access.locationIds?.length) {
    query = query.in('location_id', access.locationIds);
  }
  return query;
}

function applyFilters(query, filters = {}, { includePaginationFilters = true } = {}) {
  const search = escapeLike(filters.search);
  if (search) query = query.or(`ticket_no.ilike.%${search}%,title.ilike.%${search}%,description.ilike.%${search}%`);
  if (filters.client_id) query = query.eq('client_id', clean(filters.client_id, 80));
  if (filters.block_id) query = query.eq('block_id', clean(filters.block_id, 80));
  if (filters.status) query = query.eq('status_code', clean(filters.status, 80));
  if (filters.priority) query = query.eq('priority', clean(filters.priority, 20).toLowerCase());
  if (filters.category_id) query = query.eq('category_id', clean(filters.category_id, 80));
  if (filters.assigned_user_id) query = query.eq('current_assignee_user_id', clean(filters.assigned_user_id, 80));
  if (filters.escalation_level) query = query.eq('current_escalation_level', clean(filters.escalation_level, 80));
  const from = isoStart(filters.date_from);
  const to = isoEnd(filters.date_to);
  if (from) query = query.gte('raised_at', from);
  if (to) query = query.lte('raised_at', to);
  if (truthy(filters.reopened)) query = query.or('status_code.eq.reopened,reopen_count.gt.0');
  if (truthy(filters.unassigned)) query = query.is('current_assignee_user_id', null);
  if (includePaginationFilters && truthy(filters.overdue)) {
    const nowIso = new Date().toISOString();
    query = query.or([
      `and(status_code.not.in.(resolved_awaiting_confirmation,closed,cancelled),escalation_due_at.lt.${nowIso})`,
      `and(status_code.in.(${ACTIVE_SUPERVISOR_SLA_STATUSES.join(',')}),supervisor_sla_due_at.lt.${nowIso})`,
      `and(status_code.eq.escalated_operations_executive,operations_sla_due_at.lt.${nowIso})`,
      `and(status_code.eq.escalated_project_head,project_head_sla_due_at.lt.${nowIso})`,
    ].join(','));
  }
  return query;
}

function ticketSla(ticket) {
  const sla = hospitalSlaState(ticket);
  return {
    ...sla,
    overdue: sla.state === 'breached',
  };
}

function uatIndicator(ticket) {
  const metadata = ticket.metadata || {};
  const title = clean(ticket.title, 200).toUpperCase();
  const dataSet = clean(metadata.demo_dataset_id || metadata.pilot_name || metadata.source, 80);
  if (metadata.is_demo === true || metadata.is_test === true || dataSet) return true;
  return title.startsWith('INTERNAL UAT') || title.includes('SAFE TO CANCEL') || title.startsWith('PHASE ');
}

function safeUser(user) {
  if (!user) return null;
  return {
    display_name: user.display_name || null,
    role_code: user.role_code || null,
  };
}

function locationPath(ticket) {
  return [
    ticket.block_name_snapshot || ticket.block?.block_name,
    ticket.floor_name,
    ticket.department_name,
    ticket.location_text,
    ticket.exact_landmark_snapshot,
  ].map((value) => clean(value, 240)).filter(Boolean);
}

function listRow(ticket, attachmentCount = 0) {
  const sla = ticketSla(ticket);
  return {
    id: ticket.id,
    ticket_no: ticket.ticket_no,
    client: ticket.client ? { id: ticket.client.id, name: ticket.client.client_name, code: ticket.client.client_code } : { id: ticket.client_id, name: ticket.site_name_snapshot || null },
    block: ticket.block ? { id: ticket.block.id, name: ticket.block.block_name, code: ticket.block.block_code } : { id: ticket.block_id, name: ticket.block_name_snapshot || null },
    floor_name: ticket.floor_name || null,
    department_name: ticket.department_name || null,
    location_text: ticket.location_text || ticket.room_area_snapshot || null,
    landmark: ticket.exact_landmark_snapshot || null,
    location_path: locationPath(ticket),
    title: ticket.title,
    description_preview: clean(ticket.description, 180),
    category: ticket.category ? { id: ticket.category.id, name: ticket.category.category_name, code: ticket.category.category_code } : { id: ticket.category_id },
    priority: ticket.priority,
    status_code: ticket.status_code,
    current_assignee: safeUser(ticket.assignee),
    accepted_by: safeUser(ticket.accepted_by),
    supervisor: safeUser(ticket.supervisor),
    current_escalation_level: ticket.current_escalation_level,
    current_escalation_level_no: ticket.current_escalation_level_no,
    acceptance_status: ticket.acceptance_status,
    acceptance_due_at: ticket.acceptance_due_at,
    acceptance_timeout_at: ticket.acceptance_timeout_at,
    broadcasted_at: ticket.broadcasted_at,
    raised_at: ticket.raised_at,
    updated_at: ticket.updated_at,
    assigned_at: ticket.assigned_at,
    accepted_at: ticket.accepted_at,
    work_started_at: ticket.work_started_at,
    resolved_at: ticket.resolved_at,
    closed_at: ticket.closed_at,
    supervisor_sla_due_at: ticket.supervisor_sla_due_at,
    operations_sla_due_at: ticket.operations_sla_due_at,
    escalation_due_at: ticket.escalation_due_at,
    project_head_sla_due_at: ticket.project_head_sla_due_at,
    final_escalation: ticket.final_escalation === true,
    sla,
    rating: ticket.client_rating,
    satisfaction_status: ticket.client_satisfaction_status,
    reopen_count: ticket.reopen_count || 0,
    attachment_count: attachmentCount,
    unassigned: !ticket.current_assignee_user_id,
    overdue: sla.overdue,
    uat: uatIndicator(ticket),
  };
}

function safeEvent(event) {
  return {
    id: event.id,
    event_type: event.event_type,
    from_status: event.from_status,
    to_status: event.to_status,
    actor_name: event.actor_name,
    actor_role: event.actor_role,
    remarks: event.remarks,
    created_at: event.created_at,
  };
}

function safeComment(comment) {
  return {
    id: comment.id,
    author_name: comment.author_name,
    author_role: comment.author_role,
    comment_type: comment.comment_type,
    comment_text: comment.comment_text,
    is_client_visible: comment.is_client_visible,
    created_at: comment.created_at,
  };
}

async function safeAttachment(client, attachment) {
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
  if (!attachment.storage_bucket || !attachment.storage_path) return safe;
  const signed = await client.storage
    .from(attachment.storage_bucket)
    .createSignedUrl(attachment.storage_path, 300);
  if (!signed.error) safe.signed_url = signed.data?.signedUrl || null;
  return safe;
}

async function attachmentCounts(client, ticketIds) {
  if (!ticketIds.length) return new Map();
  const { data, error } = await client
    .from('hospital_ticket_attachments')
    .select('ticket_id')
    .in('ticket_id', ticketIds);
  if (error) throw error;
  const counts = new Map();
  for (const row of data || []) counts.set(row.ticket_id, (counts.get(row.ticket_id) || 0) + 1);
  return counts;
}

export async function listWebHospitalTickets(client, access, filters = {}) {
  const page = parsePositiveInt(filters.page, 1, 100000);
  const pageSize = parsePositiveInt(filters.page_size || filters.pageSize, 25, SAFE_PAGE_SIZE_MAX);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = client
    .from('hospital_tickets')
    .select(TICKET_WEB_SELECT, { count: 'exact' });
  query = applyAccessScope(query, access);
  query = applyFilters(query, filters);
  query = query.order('raised_at', { ascending: false }).order('ticket_no', { ascending: false }).range(from, to);

  const { data, error, count } = await query;
  if (error) throw error;
  const ids = (data || []).map((ticket) => ticket.id);
  const counts = await attachmentCounts(client, ids);
  return {
    tickets: (data || []).map((ticket) => listRow(ticket, counts.get(ticket.id) || 0)),
    pagination: {
      page,
      page_size: pageSize,
      total: count || 0,
      total_pages: Math.max(1, Math.ceil((count || 0) / pageSize)),
    },
  };
}

export async function summarizeWebHospitalTickets(client, access, filters = {}) {
  let query = client.from('hospital_tickets').select('id,status_code,current_assignee_user_id,current_assignee_role,current_escalation_level_no,supervisor_sla_due_at,operations_sla_due_at,project_head_sla_due_at,escalation_due_at,final_escalation,reopen_count,acceptance_status,acceptance_due_at', { count: 'exact' });
  query = applyAccessScope(query, access);
  query = applyFilters(query, filters, { includePaginationFilters: false });
  const { data, error } = await query.limit(10000);
  if (error) throw error;
  const rows = data || [];
  let onDutyQuery = client
    .from('hospital_ticket_users')
    .select('id', { count: 'exact', head: true })
    .eq('role_code', 'housekeeping_supervisor')
    .eq('profile_type', 'internal')
    .eq('is_active', true)
    .eq('duty_status', 'on_duty');
  if (!access.broad && access.clientIds?.length) onDutyQuery = onDutyQuery.in('client_id', access.clientIds);
  const onDutyResult = await onDutyQuery;
  if (onDutyResult.error && onDutyResult.error.code !== '42703') throw onDutyResult.error;
  const now = new Date();
  const isOverdue = (ticket) => hospitalSlaState(ticket, now).state === 'breached';
  const countStatus = (status) => rows.filter((ticket) => ticket.status_code === status).length;
  return {
    total: rows.length,
    open: countStatus('open'),
    assigned: countStatus('assigned'),
    awaiting_supervisor_acceptance: countStatus('awaiting_supervisor_acceptance'),
    accepted: countStatus('accepted'),
    in_progress: countStatus('in_progress'),
    escalated: rows.filter((ticket) => ESCALATED_STATUSES.includes(ticket.status_code)).length,
    resolved: countStatus('resolved_awaiting_confirmation'),
    closed: countStatus('closed'),
    reopened: rows.filter((ticket) => ticket.status_code === 'reopened' || Number(ticket.reopen_count || 0) > 0).length,
    overdue: rows.filter(isOverdue).length,
    unassigned: rows.filter((ticket) => !ticket.current_assignee_user_id && !CLOSED_STATUSES.includes(ticket.status_code)).length,
    on_duty_supervisors: onDutyResult.count || 0,
  };
}

export async function getWebHospitalTicketDetail(client, access, ticketId) {
  const identifier = clean(ticketId, 80);
  const column = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identifier) ? 'id' : 'ticket_no';
  let query = client.from('hospital_tickets').select(TICKET_WEB_SELECT).eq(column, identifier);
  query = applyAccessScope(query, access);
  const { data: ticket, error } = await query.maybeSingle();
  if (error) throw error;
  if (!ticket) {
    const notFound = new Error('Ticket was not found in your authorised scope.');
    notFound.statusCode = 404;
    throw notFound;
  }
  const [events, comments, attachments, assignmentHistory] = await Promise.all([
    client.from('hospital_ticket_events').select('*').eq('ticket_id', ticket.id).order('created_at', { ascending: true }),
    client.from('hospital_ticket_comments').select('*').eq('ticket_id', ticket.id).order('created_at', { ascending: true }),
    client.from('hospital_ticket_attachments').select('id,ticket_id,attachment_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes,is_client_visible,created_at').eq('ticket_id', ticket.id).order('created_at', { ascending: true }),
    client.from('hospital_ticket_assignment_history').select('id,from_user_id,to_user_id,assignment_type,reason,assigned_at,source,previous_status,resulting_status').eq('ticket_id', ticket.id).order('assigned_at', { ascending: true }),
  ]);
  for (const result of [events, comments, attachments]) {
    if (result.error) throw result.error;
  }
  if (assignmentHistory.error && assignmentHistory.error.code !== '42P01') throw assignmentHistory.error;
  const safeAttachments = await Promise.all((attachments.data || []).map((attachment) => safeAttachment(client, attachment)));
  return {
    ticket: {
      ...listRow(ticket, safeAttachments.length),
      description: ticket.description,
      raised_by: {
        name: ticket.raised_by_name,
        role: ticket.raised_by_role,
      },
      resolved_by: safeUser(ticket.resolved_by),
      resolution_action: ticket.resolution_action || null,
      resolution_remarks: ticket.resolution_remarks || null,
      client_feedback: ticket.client_feedback || null,
      awaiting_confirmation_at: ticket.awaiting_confirmation_at || null,
      reopened_at: ticket.reopened_at || null,
      cancelled_at: ticket.cancelled_at || null,
      assignment_failure_reason: ticket.metadata?.assignment_failure_reason || null,
    },
    timeline: (events.data || []).map(safeEvent),
    comments: (comments.data || []).map(safeComment),
    attachments: safeAttachments,
    assignment_history: assignmentHistory.data || [],
  };
}

export function hospitalWebAccessResponse(access) {
  return {
    source: access.source,
    broad: access.broad === true,
    client_ids: access.clientIds || [],
    block_ids: access.blockIds || [],
  };
}
