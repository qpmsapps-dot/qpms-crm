import { randomUUID } from 'node:crypto';

import { canViewHospitalTicket, hospitalAllowedActions, scopeAllows } from './hospitalTicketAuthService.js';
import { cleanHospitalText, normalizeHospitalTicketCreate, slaMinutes, validateHospitalAction, validateHospitalTicketCreate } from './hospitalTicketWorkflowService.js';

const TICKET_SELECT = `
  *,
  block:hospital_blocks(id,block_code,block_name),
  location:hospital_locations(id,floor_name,department_name,location_name,location_code),
  category:hospital_ticket_categories(id,category_code,category_name),
  assignee:hospital_ticket_users!hospital_tickets_current_assignee_user_id_fkey(id,display_name,role_code)
`;

export async function loadHospitalMasters(client, actor) {
  const clientId = actor.user.client_id;
  const [blocksResult, locationsResult, categoriesResult] = await Promise.all([
    client.from('hospital_blocks').select('*').eq('client_id', clientId).eq('is_active', true).order('sort_order'),
    client.from('hospital_locations').select('*').eq('client_id', clientId).eq('is_active', true).order('floor_name'),
    client.from('hospital_ticket_categories').select('*').or(`client_id.is.null,client_id.eq.${clientId}`).eq('is_active', true).order('sort_order'),
  ]);
  for (const result of [blocksResult, locationsResult, categoriesResult]) if (result.error) throw result.error;
  const blocks = (blocksResult.data || []).filter((row) => scopeAllows(actor.scopes, { clientId, blockId: row.id, permission: 'view' }));
  const blockIds = new Set(blocks.map((row) => row.id));
  const locations = (locationsResult.data || []).filter((row) => blockIds.has(row.block_id)
    && scopeAllows(actor.scopes, { clientId, blockId: row.block_id, locationId: row.id, permission: 'view' }));
  return { blocks, locations, categories: categoriesResult.data || [] };
}

function applyTicketFilters(query, filters = {}) {
  if (filters.status) query = query.eq('status_code', cleanHospitalText(filters.status, 60));
  if (filters.block) query = query.eq('block_id', cleanHospitalText(filters.block, 80));
  if (filters.priority) query = query.eq('priority', cleanHospitalText(filters.priority, 20));
  if (filters.category) query = query.eq('category_id', cleanHospitalText(filters.category, 80));
  if (filters.date_from) query = query.gte('raised_at', `${filters.date_from}T00:00:00+05:30`);
  if (filters.date_to) query = query.lte('raised_at', `${filters.date_to}T23:59:59.999+05:30`);
  if (filters.assigned_to_me === 'true') query = query.eq('current_assignee_user_id', filters.actorUserId);
  if (filters.escalated === 'true') query = query.in('status_code', ['escalated_operations_executive', 'escalated_facility_manager']);
  if (filters.awaiting_confirmation === 'true') query = query.eq('status_code', 'resolved_awaiting_confirmation');
  if (filters.reopened === 'true') query = query.eq('status_code', 'reopened');
  return query;
}

export async function listHospitalTickets(client, actor, filters = {}) {
  let query = client.from('hospital_tickets').select(TICKET_SELECT).eq('client_id', actor.user.client_id).order('raised_at', { ascending: false }).limit(500);
  query = applyTicketFilters(query, { ...filters, actorUserId: actor.user.id });
  const result = await query;
  if (result.error) throw result.error;
  const search = cleanHospitalText(filters.search, 120).toLowerCase();
  return (result.data || []).filter((ticket) => canViewHospitalTicket(actor, ticket)).filter((ticket) => {
    if (!search) return true;
    return [ticket.ticket_no, ticket.title, ticket.description, ticket.floor_name, ticket.department_name, ticket.location_text, ticket.block?.block_name, ticket.assignee?.display_name]
      .some((value) => String(value || '').toLowerCase().includes(search));
  }).map((ticket) => hospitalTicketForActor(actor, ticket));
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

export function hospitalTicketForActor(actor, ticket) {
  if (actor?.user?.profile_type !== 'client') return ticket;
  const {
    idempotency_key: _idempotencyKey,
    metadata: _metadata,
    raised_by_user_id: _raisedByUserId,
    current_assignee_user_id: _currentAssigneeUserId,
    supervisor_user_id: _supervisorUserId,
    operations_executive_user_id: _operationsExecutiveUserId,
    facility_manager_user_id: _facilityManagerUserId,
    resolved_by_user_id: _resolvedByUserId,
    ...safeTicket
  } = ticket;
  return safeTicket;
}

export function clientCanSeeHospitalEvent(event) {
  if (event?.event_type === 'progress_update' || event?.event_type === 'assistance_requested') {
    return event?.event_data?.is_client_visible === true;
  }
  if (event?.event_type === 'photo_uploaded') return event?.event_data?.is_client_visible === true;
  return true;
}

export function clientHospitalEventView(event) {
  const { actor_user_id: _actorUserId, event_data: _eventData, ...safeEvent } = event;
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
  const location = await client.from('hospital_locations').select('*').eq('id', payload.locationId).maybeSingle();
  if (location.error) throw location.error;
  if (!location.data || location.data.block_id !== payload.blockId || !scopeAllows(actor.scopes, { clientId: actor.user.client_id, blockId: payload.blockId, locationId: payload.locationId, permission: 'create' })) {
    const error = new Error('Selected location is outside your complaint scope.'); error.code = '42501'; throw error;
  }
  const sla = slaMinutes();
  const result = await client.rpc('rpc_create_hospital_ticket', {
    p_actor_user_id: actor.user.id,
    p_block_id: payload.blockId,
    p_location_id: payload.locationId,
    p_category_id: payload.categoryId,
    p_priority: payload.priority,
    p_title: payload.title,
    p_description: payload.description,
    p_idempotency_key: payload.idempotencyKey,
    p_supervisor_sla_minutes: sla.supervisor,
  });
  if (result.error) throw result.error;
  return result.data;
}

export async function performHospitalAction(client, actor, ticketId, action, expectedVersion, payload = {}) {
  const current = await getHospitalTicket(client, actor, ticketId);
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
  const errors = validateHospitalAction({ role: actor.user.role_code, status: current.ticket.status_code, action, payload });
  if (errors.length) { const error = new Error(errors.join(' ')); error.code = '42501'; throw error; }
  if (!Number.isInteger(Number(expectedVersion))) { const error = new Error('Ticket version is required.'); error.code = '22023'; throw error; }
  const result = await client.rpc('rpc_hospital_ticket_action', {
    p_ticket_id: current.ticket.id,
    p_actor_user_id: actor.user.id,
    p_action: action,
    p_expected_version: Number(expectedVersion),
    p_payload: payload,
    p_operations_sla_minutes: slaMinutes().operations,
  });
  if (result.error) throw result.error;
  return getHospitalTicket(client, actor, current.ticket.id);
}

export function hospitalSlaState(ticket, now = new Date()) {
  let dueAt = null;
  if (['open', 'assigned', 'accepted', 'in_progress'].includes(ticket.status_code)) dueAt = ticket.supervisor_sla_due_at;
  if (ticket.status_code === 'escalated_operations_executive') dueAt = ticket.operations_sla_due_at;
  if (!dueAt) return { state: 'not_applicable', due_at: null, remaining_seconds: 0 };
  const remaining = Math.floor((new Date(dueAt).getTime() - now.getTime()) / 1000);
  return { state: remaining < 0 ? 'breached' : remaining <= 300 ? 'near_breach' : 'healthy', due_at: dueAt, remaining_seconds: remaining };
}

export function allowedActionsForTicket(actor, ticket) {
  return hospitalAllowedActions(actor.user).filter((action) => {
    const mapped = action === 'manual_escalation' ? 'manual_escalation' : action;
    return validateHospitalAction({ role: actor.user.role_code, status: ticket.status_code, action: mapped, payload: action === 'progress' ? { remarks: 'check' } : action === 'resolve' ? { resolution_action: 'check', resolution_remarks: 'check' } : action === 'feedback' ? { rating: 5, satisfaction_status: 'satisfied' } : {} }).length === 0;
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
      open: count('open'), assigned: count('assigned'),
      in_progress: count('accepted') + count('in_progress'),
      near_sla_breach: urgent.filter((row) => row.sla.state === 'near_breach').length,
      escalated: count('escalated_operations_executive') + count('escalated_facility_manager'),
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
