import { resolveCurrentUserAccess } from './accessControlService.js';
import { randomUUID } from 'node:crypto';
import {
  clientCanSeeHospitalEvent,
  clientHospitalEventView,
  hospitalSlaState,
} from './hospitalTicketService.js';
import { activeWebProfile, hasCooWebVisibility, normalizeWebRoleKey } from './webRoleAccessService.js';

const GLOBAL_WEB_ROLE_KEYS = new Set([
  'ADMIN',
  'QPMSADMIN',
  'DEVELOPER',
  'ITADMIN',
  'MANAGEMENTITADMIN',
  'MANAGEMENT',
  'MD',
  'COO',
  'GM',
  'TOPMANAGEMENT',
  'EXECUTIVEASSISTANT',
  'EXECUTIVEASSISTANTTOCOO',
]);

const SAFE_PAGE_SIZE_MAX = 100;
const ACTIVE_SUPERVISOR_SLA_STATUSES = ['open', 'awaiting_supervisor_acceptance', 'assigned', 'accepted', 'in_progress', 'reopened'];
const ESCALATED_STATUSES = ['escalated_operations_executive', 'escalated_facility_manager', 'escalated_project_head', 'escalated_hospital_dean'];
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
  return normalizeWebRoleKey(role);
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
  if (!activeWebProfile(profile)) return false;
  if (hasCooWebVisibility(profile.role)) return true;
  return GLOBAL_WEB_ROLE_KEYS.has(roleKey(profile.role));
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

export function assignmentAllowsInternalView(assignment) {
  const userType = clean(assignment.role?.user_type, 40).toLowerCase();
  const applicationTarget = clean(assignment.module?.application_target, 40).toLowerCase();
  return !['client', 'hospital_client', 'requester'].includes(userType) && applicationTarget !== 'client_mobile';
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

export function scopedAccessFromAssignments(assignments = []) {
  const clientIds = [];
  const blockIds = [];
  const locationIds = [];
  const authorizedClientIds = [];
  let broad = false;

  for (const assignment of assignments) {
    const assignmentClientId = clean(assignment.client?.id, 80);
    if (assignmentClientId) authorizedClientIds.push(assignmentClientId);
    const scopes = assignment.scopes || [];
    if (!scopes.length) {
      if (assignmentClientId) clientIds.push(assignmentClientId);
      continue;
    }
    for (const scope of scopes) {
      const type = clean(scope.scope_type, 40).toLowerCase();
      const value = scopeValue(scope);
      if (type === 'global') broad = true;
      else if (type === 'client') {
        clientIds.push(value || assignmentClientId);
        authorizedClientIds.push(value || assignmentClientId);
      } else if (type === 'all_client') {
        clientIds.push(assignmentClientId || value);
        authorizedClientIds.push(assignmentClientId || value);
      }
      else if (type === 'hospital_block') blockIds.push(value);
      else if (type === 'location') locationIds.push(value);
    }
  }

  return {
    broad,
    clientIds: unique(clientIds),
    blockIds: unique(blockIds),
    locationIds: unique(locationIds),
    authorizedClientIds: unique(authorizedClientIds),
  };
}

function hasUsableScope(access = {}) {
  return access.broad === true || Boolean(
    access.clientIds?.length || access.blockIds?.length || access.locationIds?.length,
  );
}

export async function resolveHospitalWebAccess({ client, authUser, profile }) {
  if (!authUser?.id) {
    return { allowed: false, status: 401, code: 'authentication_required', message: 'Supabase Bearer token required.' };
  }
  if (!profile || !activeWebProfile(profile) || profile.web_access_enabled !== true) {
    return {
      allowed: false,
      status: 403,
      code: 'hospital_web_profile_inactive',
      message: 'An active web-enabled profile is required for Hospital Ticketing.',
    };
  }

  if (isWebManagementProfile(profile)) {
    return {
      allowed: true,
      source: 'global_web_management',
      broad: true,
      assignments: [],
      clientIds: [],
      blockIds: [],
      locationIds: [],
      authorizedClientIds: [],
      qpmsViewAllowed: true,
      clientViewAllowed: true,
    };
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
    const scope = scopedAccessFromAssignments(unifiedAssignments);
    if (!hasUsableScope(scope)) {
      return {
        allowed: false,
        status: 403,
        code: 'hospital_web_scope_required',
        message: 'Hospital Ticketing access requires a valid client, block, location, or global scope.',
      };
    }
    return {
      allowed: true,
      source: 'unified',
      assignments: unifiedAssignments,
      qpmsViewAllowed: unifiedAssignments.some(assignmentAllowsInternalView),
      clientViewAllowed: true,
      ...scope,
    };
  }

  if (unified.source === 'unified_denied') {
    return { allowed: false, status: 403, code: unified.code || 'access_denied', message: unified.message || 'Hospital ticket dashboard access denied.' };
  }

  const legacyAssignments = (unified.assignments || [])
    .filter((assignment) => assignment.assignment_source === 'legacy_hospital' || assignment.source === 'legacy_hospital')
    .filter((assignment) => assignmentHasPermission(assignment, 'hospital_ticket.view'));

  if (legacyAssignments.length) {
    const scope = scopedAccessFromAssignments(legacyAssignments);
    if (!hasUsableScope(scope)) {
      return {
        allowed: false,
        status: 403,
        code: 'hospital_web_scope_required',
        message: 'Hospital Ticketing access requires a valid client, block, or location scope.',
      };
    }
    return {
      allowed: true,
      source: 'legacy_hospital',
      assignments: legacyAssignments,
      qpmsViewAllowed: legacyAssignments.some(assignmentAllowsInternalView),
      clientViewAllowed: true,
      ...scope,
    };
  }

  return { allowed: false, status: 403, code: 'hospital_web_access_denied', message: 'Hospital ticket dashboard access denied.' };
}

export function applyAccessScope(query, access) {
  if (access.broad) return query;
  const clauses = [];
  if (access.clientIds?.length) clauses.push(`client_id.in.(${access.clientIds.join(',')})`);
  if (access.blockIds?.length) clauses.push(`block_id.in.(${access.blockIds.join(',')})`);
  if (access.locationIds?.length) clauses.push(`location_id.in.(${access.locationIds.join(',')})`);
  if (!clauses.length) throw httpError(403, 'hospital_web_scope_required', 'Hospital Ticketing scope is unavailable.');
  if (clauses.length > 1) return query.or(clauses.join(','));
  if (access.clientIds?.length) return query.in('client_id', access.clientIds);
  if (access.blockIds?.length) return query.in('block_id', access.blockIds);
  return query.in('location_id', access.locationIds);
}

export function hospitalWebAccessAllowsClient(access = {}, clientId) {
  if (access.broad === true) return true;
  const id = clean(clientId, 80);
  return Boolean(id && (access.authorizedClientIds || []).includes(id));
}

export async function resolveWebHospitalClientFilter(client, access, filters = {}) {
  const next = { ...filters };
  const presentation = clean(filters.presentation || 'qpms', 20).toLowerCase();
  if (presentation === 'qpms' && access.qpmsViewAllowed !== true) {
    throw httpError(403, 'hospital_qpms_view_access_denied', 'Internal QPMS Hospital Ticketing access is required.');
  }
  if (presentation === 'client' && access.clientViewAllowed !== true) {
    throw httpError(403, 'hospital_client_view_access_denied', 'Hospital Client View access is required.');
  }
  const requestedCode = clean(filters.client_code || filters.clientCode, 80).toUpperCase();
  if (requestedCode) {
    const { data, error } = await client
      .from('hospital_clients')
      .select('id,client_code,client_name,is_active')
      .eq('client_code', requestedCode)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw httpError(404, 'hospital_client_not_found', 'Hospital Ticketing client was not found.');
    next.client_id = data.id;
    next.client = data;
  }
  if (next.client_id && !hospitalWebAccessAllowsClient(access, next.client_id)) {
    throw httpError(403, 'hospital_client_access_denied', 'Hospital Ticketing access is not available for this client.');
  }
  return next;
}

export async function listWebHospitalClientContacts(client, access, filters = {}) {
  const scopedFilters = await resolveWebHospitalClientFilter(client, access, {
    ...filters,
    presentation: 'client',
  });
  if (!scopedFilters.client_id) {
    throw httpError(400, 'hospital_client_required', 'A Hospital Ticketing client is required.');
  }

  const { data, error } = await client
    .from('hospital_client_contacts')
    .select('full_name,designation,mobile')
    .eq('client_id', scopedFilters.client_id)
    .eq('is_active', true)
    .order('full_name', { ascending: true });
  if (error) throw error;

  const contacts = (data || []).map((contact) => ({
    full_name: clean(contact.full_name, 160),
    designation: clean(contact.designation, 160),
    mobile: clean(contact.mobile, 40),
  }));
  return { contacts, total: contacts.length };
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
  if (truthy(filters.dean_escalated)) query = query.not('dean_escalated_at', 'is', null);
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
      `and(status_code.eq.escalated_hospital_dean,dean_sla_due_at.lt.${nowIso})`,
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

function listRow(ticket, attachmentCount = 0, beforeImage = null) {
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
    dean_sla_due_at: ticket.dean_sla_due_at,
    dean_escalated_at: ticket.dean_escalated_at,
    ticket_source: ticket.ticket_source || null,
    final_escalation: ticket.final_escalation === true,
    sla,
    rating: ticket.client_rating,
    satisfaction_status: ticket.client_satisfaction_status,
    reopen_count: ticket.reopen_count || 0,
    attachment_count: attachmentCount,
    before_image: beforeImage,
    before_image_url: beforeImage?.signed_url || null,
    unassigned: !ticket.current_assignee_user_id,
    overdue: sla.overdue,
    uat: uatIndicator(ticket),
  };
}

function clientSafeListRow(ticket, attachmentCount = 0) {
  const row = listRow(ticket, attachmentCount);
  row.raised_by = { name: clean(ticket.raised_by_name, 160) || null };
  delete row.current_assignee;
  delete row.accepted_by;
  delete row.supervisor;
  delete row.current_escalation_level;
  delete row.current_escalation_level_no;
  delete row.acceptance_status;
  delete row.acceptance_due_at;
  delete row.acceptance_timeout_at;
  delete row.broadcasted_at;
  delete row.supervisor_sla_due_at;
  delete row.operations_sla_due_at;
  delete row.escalation_due_at;
  delete row.project_head_sla_due_at;
  delete row.dean_sla_due_at;
  delete row.dean_escalated_at;
  delete row.ticket_source;
  delete row.final_escalation;
  delete row.sla;
  delete row.unassigned;
  delete row.overdue;
  delete row.uat;
  return row;
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

function clientSafeEvent(event) {
  return {
    id: event.id,
    event_type: event.event_type,
    from_status: event.from_status,
    to_status: event.to_status,
    remarks: event.remarks,
    created_at: event.created_at,
  };
}

function clientSafeComment(comment) {
  return {
    id: comment.id,
    comment_type: comment.comment_type,
    comment_text: comment.comment_text,
    created_at: comment.created_at,
  };
}

function webActorName(actor = {}) {
  return clean(
    actor.profile?.display_name
      || actor.profile?.full_name
      || actor.profile?.employee_code
      || actor.profile?.email
      || actor.authUser?.email
      || 'QPMS Web User',
    160,
  );
}

function webActorRole(actor = {}) {
  return clean(actor.profile?.role || 'web_user', 80) || 'web_user';
}

function isTerminalTicket(ticket) {
  return ['closed', 'cancelled'].includes(clean(ticket?.status_code, 80).toLowerCase());
}

function resendOwnerRoleForTicket(ticket) {
  const status = clean(ticket?.status_code, 80).toLowerCase();
  if (status === 'awaiting_supervisor_acceptance') return 'housekeeping_supervisor';
  if (status === 'escalated_operations_executive') return 'operations_executive';
  if (status === 'escalated_facility_manager') return 'facility_manager';
  if (status === 'escalated_project_head') return 'project_head';
  return clean(ticket?.current_assignee_role, 80).toLowerCase();
}

function isValidInternalNotificationRecipient(user, { clientId, role }) {
  if (!user?.id || user.client_id !== clientId || user.profile_type !== 'internal' || user.is_active !== true) return false;
  if (role && clean(user.role_code, 80).toLowerCase() !== role) return false;
  const metadata = user.metadata || {};
  return !(
    metadata.test_user === true
    || metadata.demo === true
    || metadata.demo_user === true
    || metadata.uat_only === true
    || metadata.do_not_use_for_real_staff === true
  );
}

async function loadValidCurrentRecipient(client, ticket, role) {
  if (!ticket.current_assignee_user_id) return null;
  const result = await client
    .from('hospital_ticket_users')
    .select('id,client_id,profile_type,role_code,display_name,is_active,metadata')
    .eq('id', ticket.current_assignee_user_id)
    .maybeSingle();
  if (result.error) throw result.error;
  if (isValidInternalNotificationRecipient(result.data, { clientId: ticket.client_id, role })) return result.data;
  return null;
}

async function pickCanonicalRecipient(client, ticket, role) {
  if (!role || role === 'housekeeping_supervisor') return null;
  const picked = await client.rpc('hospital_pick_ticket_owner', {
    p_client_id: ticket.client_id,
    p_role: role,
  });
  if (picked.error) throw picked.error;
  const user = picked.data || null;
  return isValidInternalNotificationRecipient(user, { clientId: ticket.client_id, role }) ? user : null;
}

async function currentResendRecipients(client, ticket) {
  const role = resendOwnerRoleForTicket(ticket);
  if (role === 'housekeeping_supervisor' && ticket.status_code === 'awaiting_supervisor_acceptance') {
    const supervisors = await client.rpc('hospital_ticket_on_duty_supervisors', {
      p_client_id: ticket.client_id,
      p_block_id: ticket.block_id || null,
      p_location_id: ticket.location_id || null,
    });
    if (supervisors.error) throw supervisors.error;
    return (supervisors.data || []).filter((user) => isValidInternalNotificationRecipient(user, {
      clientId: ticket.client_id,
      role: 'housekeeping_supervisor',
    }));
  }
  const current = await loadValidCurrentRecipient(client, ticket, role);
  if (current) return [current];
  const canonical = await pickCanonicalRecipient(client, ticket, role);
  return canonical ? [canonical] : [];
}

export async function resendWebHospitalTicketNotification(client, access, ticketId, filters = {}, actor = {}) {
  if (access.qpmsViewAllowed !== true) {
    throw httpError(403, 'hospital_notify_again_denied', 'Internal QPMS Hospital Ticketing access is required to resend notifications.');
  }
  filters = await resolveWebHospitalClientFilter(client, access, {
    ...filters,
    presentation: 'qpms',
  });
  const identifier = clean(ticketId, 80);
  const column = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identifier) ? 'id' : 'ticket_no';
  let query = client.from('hospital_tickets').select(TICKET_WEB_SELECT).eq(column, identifier);
  query = applyAccessScope(query, access);
  if (filters.client_id) query = query.eq('client_id', filters.client_id);
  const ticketResult = await query.maybeSingle();
  if (ticketResult.error) throw ticketResult.error;
  const ticket = ticketResult.data;
  if (!ticket?.id) throw httpError(404, 'hospital_ticket_not_found', 'Ticket was not found in your authorised scope.');
  if (isTerminalTicket(ticket)) {
    throw httpError(409, 'hospital_ticket_notification_resend_not_allowed', 'Notifications can only be resent for active tickets.');
  }
  const recipients = await currentResendRecipients(client, ticket);
  if (!recipients.length) {
    throw httpError(409, 'hospital_notification_recipient_unavailable', 'No valid current recipient is available for this ticket.');
  }
  const now = new Date().toISOString();
  const resendId = randomUUID();
  const awaitingSupervisorAcceptance = ticket.status_code === 'awaiting_supervisor_acceptance';
  const notificationRows = recipients.map((recipient) => ({
    ticket_id: ticket.id,
    recipient_user_id: recipient.id,
    notification_type: awaitingSupervisorAcceptance ? 'incoming_supervisor_ticket' : 'manual_resend',
    title: 'Ticket Notification Reminder',
    body: `Ticket ${ticket.ticket_no} needs your attention.`,
    priority: ticket.priority || null,
    current_owner_role: recipient.role_code || ticket.current_assignee_role || null,
    escalation_level: Number(ticket.current_escalation_level_no || 0) || null,
    action_status: awaitingSupervisorAcceptance ? 'active' : 'not_actionable',
    action_expires_at: awaitingSupervisorAcceptance ? ticket.acceptance_due_at || null : null,
    dedupe_key: `hospital_ticket_manual_resend:${ticket.id}:${recipient.id}:${resendId}`,
    metadata: {
      notification_reason: 'manual_resend',
      resend_id: resendId,
      ticket_id: ticket.id,
      ticket_no: ticket.ticket_no,
      recipient_user_id: recipient.id,
      recipient_role: recipient.role_code,
      triggered_at: now,
      triggered_by_auth_user_id: actor.authUser?.id || null,
      triggered_by_profile_id: actor.profile?.id || null,
      app_scope: 'myqpms_internal',
      target_screen: ticket.status_code === 'awaiting_supervisor_acceptance' ? 'incoming_ticket' : 'ticket_detail',
    },
  }));
  const inserted = await client
    .from('hospital_ticket_notifications')
    .insert(notificationRows)
    .select('id,recipient_user_id,notification_type');
  if (inserted.error) throw inserted.error;
  const notificationIds = (inserted.data || []).map((row) => row.id).filter(Boolean);
  const event = await client.from('hospital_ticket_events').insert({
    ticket_id: ticket.id,
    event_type: 'notification_resent',
    from_status: ticket.status_code,
    to_status: ticket.status_code,
    actor_user_id: null,
    actor_name: webActorName(actor),
    actor_role: webActorRole(actor),
    remarks: `Notification resent to ${recipients.map((recipient) => recipient.display_name).filter(Boolean).join(', ') || 'current recipient'}.`,
    event_data: {
      notification_reason: 'manual_resend',
      resend_id: resendId,
      recipient_user_ids: recipients.map((recipient) => recipient.id),
      recipient_roles: recipients.map((recipient) => recipient.role_code),
      triggered_at: now,
      triggered_by_auth_user_id: actor.authUser?.id || null,
      triggered_by_profile_id: actor.profile?.id || null,
      workflow_state_unchanged: true,
    },
  });
  if (event.error) throw event.error;
  return {
    ticket: listRow(ticket),
    notification_ids: notificationIds,
    recipients: recipients.map((recipient) => ({
      id: recipient.id,
      display_name: recipient.display_name,
      role_code: recipient.role_code,
    })),
  };
}

async function firstComplaintAttachments(client, ticketIds) {
  if (!ticketIds.length) return new Map();
  const { data, error } = await client
    .from('hospital_ticket_attachments')
    .select('id,ticket_id,attachment_type,storage_bucket,storage_path,original_filename,mime_type,size_bytes,is_client_visible,created_at')
    .in('ticket_id', ticketIds)
    .eq('attachment_type', 'complaint_photo')
    .order('created_at', { ascending: true });
  if (error) throw error;
  const byTicket = new Map();
  for (const attachment of data || []) {
    if (byTicket.has(attachment.ticket_id)) continue;
    byTicket.set(attachment.ticket_id, await safeAttachment(client, attachment));
  }
  return byTicket;
}

export async function listWebHospitalTickets(client, access, filters = {}) {
  filters = await resolveWebHospitalClientFilter(client, access, filters);
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
  const includeImages = truthy(filters.include_images);
  const [counts, complaintAttachments] = await Promise.all([
    attachmentCounts(client, ids),
    includeImages ? firstComplaintAttachments(client, ids) : Promise.resolve(new Map()),
  ]);
  const clientPresentation = clean(filters.presentation, 20).toLowerCase() === 'client';
  return {
    tickets: (data || []).map((ticket) => clientPresentation
      ? clientSafeListRow(ticket, counts.get(ticket.id) || 0)
      : listRow(ticket, counts.get(ticket.id) || 0, complaintAttachments.get(ticket.id) || null)),
    pagination: {
      page,
      page_size: pageSize,
      total: count || 0,
      total_pages: Math.max(1, Math.ceil((count || 0) / pageSize)),
    },
  };
}

export async function summarizeWebHospitalTickets(client, access, filters = {}) {
  filters = await resolveWebHospitalClientFilter(client, access, filters);
  let query = client.from('hospital_tickets').select(`
    id,status_code,priority,current_assignee_user_id,current_assignee_role,current_escalation_level_no,
    supervisor_sla_due_at,operations_sla_due_at,project_head_sla_due_at,dean_sla_due_at,dean_escalated_at,
    escalation_due_at,final_escalation,reopen_count,acceptance_status,acceptance_due_at,raised_at,closed_at,updated_at,
    category:hospital_ticket_categories(id,category_name),
    block:hospital_blocks(id,block_name),
    assignee:hospital_ticket_users!hospital_tickets_current_assignee_user_id_fkey(id,display_name)
  `, { count: 'exact' });
  query = applyAccessScope(query, access);
  query = applyFilters(query, filters, { includePaginationFilters: false });
  const { data, error } = await query.limit(10000);
  if (error) throw error;
  const rows = data || [];
  let onDutyCount = 0;
  if (access.broad || access.clientIds?.length) {
    let onDutyQuery = client
      .from('hospital_ticket_users')
      .select('id', { count: 'exact', head: true })
      .eq('role_code', 'housekeeping_supervisor')
      .eq('profile_type', 'internal')
      .eq('is_active', true)
      .eq('duty_status', 'on_duty');
    if (!access.broad) onDutyQuery = onDutyQuery.in('client_id', access.clientIds);
    const onDutyResult = await onDutyQuery;
    if (onDutyResult.error && onDutyResult.error.code !== '42703') throw onDutyResult.error;
    onDutyCount = onDutyResult.count || 0;
  }
  const now = new Date();
  const isOverdue = (ticket) => hospitalSlaState(ticket, now).state === 'breached';
  const countStatus = (status) => rows.filter((ticket) => ticket.status_code === status).length;
  const counts = {
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
    dean_escalations: rows.filter((ticket) => ticket.dean_escalated_at || ticket.current_escalation_level_no === 5).length,
    overdue: rows.filter(isOverdue).length,
    unassigned: rows.filter((ticket) => !ticket.current_assignee_user_id && !CLOSED_STATUSES.includes(ticket.status_code)).length,
    on_duty_supervisors: onDutyCount,
    cancelled: countStatus('cancelled'),
    active: rows.filter((ticket) => !CLOSED_STATUSES.includes(ticket.status_code)).length,
    under_process: rows.filter((ticket) => ['assigned', 'accepted', 'in_progress'].includes(ticket.status_code)).length,
    awaiting_client_confirmation: countStatus('resolved_awaiting_confirmation'),
  };
  const grouped = (values, keyFor, labelFor) => {
    const map = new Map();
    for (const value of values) {
      const key = keyFor(value);
      if (!key) continue;
      const current = map.get(key) || { key, label: labelFor(value), count: 0 };
      current.count += 1;
      map.set(key, current);
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  };
  const activeRows = rows.filter((ticket) => !CLOSED_STATUSES.includes(ticket.status_code));
  const ageing = [
    { key: 'under_1_day', label: '< 1 day', min: 0, max: 1, count: 0 },
    { key: '1_3_days', label: '1-3 days', min: 1, max: 4, count: 0 },
    { key: '4_7_days', label: '4-7 days', min: 4, max: 8, count: 0 },
    { key: 'over_7_days', label: '> 7 days', min: 8, max: Number.POSITIVE_INFINITY, count: 0 },
  ];
  for (const ticket of activeRows) {
    const ageDays = Math.max(0, (now.getTime() - new Date(ticket.raised_at).getTime()) / 86400000);
    const bucket = ageing.find((item) => ageDays >= item.min && ageDays < item.max);
    if (bucket) bucket.count += 1;
  }
  const trendDays = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(now);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - (13 - index));
    return date.toISOString().slice(0, 10);
  });
  const trend = trendDays.map((date) => ({
    date,
    raised: rows.filter((ticket) => String(ticket.raised_at || '').slice(0, 10) === date).length,
    closed: rows.filter((ticket) => String(ticket.closed_at || '').slice(0, 10) === date).length,
  }));
  const facets = {
    blocks: grouped(rows, (ticket) => ticket.block?.id, (ticket) => ticket.block?.block_name || 'Unknown block'),
    categories: grouped(rows, (ticket) => ticket.category?.id, (ticket) => ticket.category?.category_name || 'Uncategorised'),
    assignees: grouped(rows, (ticket) => ticket.assignee?.id, (ticket) => ticket.assignee?.display_name || 'Unassigned'),
  };
  const clientPresentation = clean(filters.presentation, 20).toLowerCase() === 'client';
  const responseCounts = clientPresentation
    ? Object.fromEntries([
      'total', 'active', 'under_process', 'escalated',
      'awaiting_client_confirmation', 'closed', 'cancelled',
    ].map((key) => [key, counts[key]]))
    : counts;
  return {
    counts: responseCounts,
    analytics: {
      trend,
      status: grouped(rows, (ticket) => ticket.status_code, (ticket) => ticket.status_code),
      category: facets.categories,
      block: facets.blocks,
      ageing: ageing.map(({ key, label, count }) => ({ key, label, count })),
    },
    facets: clientPresentation ? { ...facets, assignees: [] } : facets,
  };
}

export async function getWebHospitalTicketDetail(client, access, ticketId, filters = {}) {
  filters = await resolveWebHospitalClientFilter(client, access, filters);
  const identifier = clean(ticketId, 80);
  const column = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identifier) ? 'id' : 'ticket_no';
  let query = client.from('hospital_tickets').select(TICKET_WEB_SELECT).eq(column, identifier);
  query = applyAccessScope(query, access);
  if (filters.client_id) query = query.eq('client_id', filters.client_id);
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
  const clientPresentation = clean(filters.presentation, 20).toLowerCase() === 'client';
  const visibleEvents = clientPresentation
    ? (events.data || []).filter(clientCanSeeHospitalEvent).map(clientHospitalEventView)
    : events.data || [];
  const visibleComments = (comments.data || []).filter((comment) => !clientPresentation || comment.is_client_visible === true);
  const visibleAttachments = (attachments.data || []).filter((attachment) => !clientPresentation || attachment.is_client_visible === true);
  const safeAttachments = await Promise.all(visibleAttachments.map((attachment) => safeAttachment(client, attachment)));
  const baseTicket = clientPresentation
    ? clientSafeListRow(ticket, safeAttachments.length)
    : listRow(ticket, safeAttachments.length);
  const responseTicket = {
      ...baseTicket,
      description: ticket.description,
      raised_by: {
        name: ticket.raised_by_name,
        role: clientPresentation ? null : ticket.raised_by_role,
      },
      resolved_by: clientPresentation ? null : safeUser(ticket.resolved_by),
      resolution_action: ticket.resolution_action || null,
      resolution_remarks: ticket.resolution_remarks || null,
      client_feedback: ticket.client_feedback || null,
      awaiting_confirmation_at: ticket.awaiting_confirmation_at || null,
      reopened_at: ticket.reopened_at || null,
      cancelled_at: ticket.cancelled_at || null,
    };
  if (!clientPresentation) {
    responseTicket.assignment_failure_reason = ticket.metadata?.assignment_failure_reason || null;
  } else {
    delete responseTicket.resolution_action;
  }
  return {
    ticket: responseTicket,
    timeline: visibleEvents.map(clientPresentation ? clientSafeEvent : safeEvent),
    comments: visibleComments.map(clientPresentation ? clientSafeComment : safeComment),
    attachments: safeAttachments,
    assignment_history: clientPresentation ? [] : assignmentHistory.data || [],
  };
}

export function hospitalWebAccessResponse(access) {
  return {
    source: access.source,
    broad: access.broad === true,
    client_ids: access.clientIds || [],
    block_ids: access.blockIds || [],
    location_ids: access.locationIds || [],
    views: {
      qpms: access.qpmsViewAllowed === true,
      client: access.clientViewAllowed === true,
    },
  };
}
