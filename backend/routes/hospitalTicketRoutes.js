import express from 'express';

import { createHospitalAuthMiddleware, hospitalAllowedActions } from '../services/hospitalTicketAuthService.js';
import {
  completeAttachment,
  createAttachmentUpload,
  createHospitalTicket,
  getSupervisorDutyStatus,
  getHospitalTicket,
  hospitalDashboard,
  listIncomingSupervisorTickets,
  listHospitalTickets,
  listHospitalRoutingAssignments,
  listHospitalRoutingShifts,
  listHospitalDepartments,
  listHospitalFloors,
  listHospitalHierarchyLocations,
  loadHospitalMasters,
  loadHospitalLocationHierarchy,
  nimsSupervisorCoverageReport,
  performHospitalAction,
  setSupervisorDuty,
  signedAttachmentDownload,
} from '../services/hospitalTicketService.js';
import {
  disableHospitalPushDevice,
  dispatchHospitalNotificationPushes,
  listHospitalPushDevices,
  registerHospitalPushDevice,
} from '../services/hospitalTicketPushService.js';
import { safeHospitalError } from '../services/hospitalTicketWorkflowService.js';

const ACTION_ROUTES = {
  accept: 'accept',
  'start-work': 'start_work',
  progress: 'progress',
  'request-assistance': 'request_assistance',
  escalate: null,
  'take-over': 'take_over',
  'reassign-supervisor': 'reassign_supervisor',
  'assign-support': 'assign_support',
  resolve: 'resolve',
  feedback: 'feedback',
};

export function createHospitalTicketRouter({ anonClient, serviceClient }) {
  const router = express.Router();
  router.use(createHospitalAuthMiddleware({ anonClient, serviceClient }));

  router.get('/me', (request, response) => response.json({
    ok: true,
    user: request.hospitalActor.user,
    scopes: request.hospitalActor.scopes,
    allowed_actions: hospitalAllowedActions(request.hospitalActor.user),
  }));

  router.get('/me/duty', async (request, response) => {
    try { response.json({ ok: true, duty: await getSupervisorDutyStatus(serviceClient, request.hospitalActor) }); }
    catch (error) { safeHospitalError(response, error); }
  });
  router.post('/me/duty/start', async (request, response) => {
    try { response.json({ ok: true, duty: await setSupervisorDuty(serviceClient, request.hospitalActor, true, request.body || {}) }); }
    catch (error) { safeHospitalError(response, error); }
  });
  router.post('/me/duty/end', async (request, response) => {
    try { response.json({ ok: true, duty: await setSupervisorDuty(serviceClient, request.hospitalActor, false, request.body || {}) }); }
    catch (error) { safeHospitalError(response, error); }
  });
  router.get('/me/push-devices', async (request, response) => {
    try { response.json({ ok: true, devices: await listHospitalPushDevices(serviceClient, request.hospitalActor) }); }
    catch (error) { safeHospitalError(response, error); }
  });
  router.post('/me/push-devices', async (request, response) => {
    try { response.status(201).json({ ok: true, device: await registerHospitalPushDevice(serviceClient, request.hospitalActor, request.body || {}) }); }
    catch (error) { safeHospitalError(response, error); }
  });
  router.delete('/me/push-devices/:deviceId', async (request, response) => {
    try { response.json({ ok: true, device: await disableHospitalPushDevice(serviceClient, request.hospitalActor, request.params.deviceId) }); }
    catch (error) { safeHospitalError(response, error); }
  });

  router.get('/blocks', masterHandler('blocks'));
  router.get('/locations', masterHandler('locations'));
  router.get('/categories', masterHandler('categories'));
  router.get('/floors', async (request, response) => {
    try { response.json({ ok: true, floors: await listHospitalFloors(serviceClient, request.hospitalActor, request.query) }); }
    catch (error) { safeHospitalError(response, error); }
  });
  router.get('/departments', async (request, response) => {
    try { response.json({ ok: true, departments: await listHospitalDepartments(serviceClient, request.hospitalActor, request.query) }); }
    catch (error) { safeHospitalError(response, error); }
  });
  router.get('/hierarchy/locations', async (request, response) => {
    try { response.json({ ok: true, locations: await listHospitalHierarchyLocations(serviceClient, request.hospitalActor, request.query) }); }
    catch (error) { safeHospitalError(response, error); }
  });
  router.get('/hierarchy', async (request, response) => {
    try { response.json({ ok: true, hierarchy: await loadHospitalLocationHierarchy(serviceClient, request.hospitalActor, request.query) }); }
    catch (error) { safeHospitalError(response, error); }
  });

  router.get('/routing/shifts', async (request, response) => {
    try { response.json({ ok: true, shifts: await listHospitalRoutingShifts(serviceClient, request.hospitalActor) }); }
    catch (error) { safeHospitalError(response, error); }
  });
  router.get('/routing/assignments', async (request, response) => {
    try { response.json({ ok: true, assignments: await listHospitalRoutingAssignments(serviceClient, request.hospitalActor) }); }
    catch (error) { safeHospitalError(response, error); }
  });
  router.get('/routing/coverage', async (request, response) => {
    try { response.json({ ok: true, coverage: nimsSupervisorCoverageReport(request.hospitalActor) }); }
    catch (error) { safeHospitalError(response, error); }
  });

  router.get('/dashboard', async (request, response) => {
    try { response.json({ ok: true, ...(await hospitalDashboard(serviceClient, request.hospitalActor)) }); }
    catch (error) { safeHospitalError(response, error); }
  });

  router.get('/', async (request, response) => {
    try { response.json({ ok: true, tickets: await listHospitalTickets(serviceClient, request.hospitalActor, request.query) }); }
    catch (error) { safeHospitalError(response, error); }
  });

  router.get('/supervisor/incoming', async (request, response) => {
    try { response.json({ ok: true, incoming: await listIncomingSupervisorTickets(serviceClient, request.hospitalActor) }); }
    catch (error) { safeHospitalError(response, error); }
  });

  router.post('/', async (request, response) => {
    try {
      const result = await createHospitalTicket(serviceClient, request.hospitalActor, request.body, request.headers['idempotency-key']);
      const detail = await getHospitalTicket(serviceClient, request.hospitalActor, result.ticket.id);
      runHospitalPushDispatch(serviceClient, 'ticket_created');
      response.status(result.idempotent_replay ? 200 : 201).json({ ok: true, ...detail, idempotent_replay: result.idempotent_replay });
    } catch (error) { safeHospitalError(response, error); }
  });

  router.get('/notifications', async (request, response) => {
    try {
      const result = await serviceClient.from('hospital_ticket_notifications').select('*,ticket:hospital_tickets(ticket_no)').eq('recipient_user_id', request.hospitalActor.user.id).order('created_at', { ascending: false }).limit(200);
      if (result.error) throw result.error;
      response.json({ ok: true, notifications: result.data || [] });
    } catch (error) { safeHospitalError(response, error); }
  });

  router.post('/notifications/:notificationId/read', async (request, response) => {
    try {
      const result = await serviceClient.from('hospital_ticket_notifications').update({ read_at: new Date().toISOString(), delivery_status: 'read', read_status: true }).eq('id', request.params.notificationId).eq('recipient_user_id', request.hospitalActor.user.id).select('id').maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) { const error = new Error('Notification was not found.'); error.code = '42501'; throw error; }
      response.json({ ok: true });
    } catch (error) { safeHospitalError(response, error); }
  });

  router.get('/:ticketId', async (request, response) => {
    try { response.json({ ok: true, ...(await getHospitalTicket(serviceClient, request.hospitalActor, request.params.ticketId)) }); }
    catch (error) { safeHospitalError(response, error); }
  });

  for (const [path, action] of Object.entries(ACTION_ROUTES)) {
    router.post(`/:ticketId/${path}`, async (request, response) => {
      try {
        const effectiveAction = path === 'escalate'
          ? request.hospitalActor.user.role_code === 'operations_executive' ? 'escalate_facility' : 'manual_escalation'
          : action;
        const result = await performHospitalAction(serviceClient, request.hospitalActor, request.params.ticketId, effectiveAction, request.body?.version, request.body || {});
        runHospitalPushDispatch(serviceClient, `ticket_action_${path}`);
        response.json({ ok: true, ...result });
      } catch (error) { safeHospitalError(response, error); }
    });
  }

  router.post('/:ticketId/attachments/sign-upload', async (request, response) => {
    try { response.json({ ok: true, ...(await createAttachmentUpload(serviceClient, request.hospitalActor, request.params.ticketId, request.body || {})) }); }
    catch (error) { safeHospitalError(response, error); }
  });
  router.post('/:ticketId/attachments/complete', async (request, response) => {
    try { response.status(201).json({ ok: true, attachment: await completeAttachment(serviceClient, request.hospitalActor, request.params.ticketId, request.body || {}) }); }
    catch (error) { safeHospitalError(response, error); }
  });
  router.get('/:ticketId/attachments/:attachmentId/sign-download', async (request, response) => {
    try { response.json({ ok: true, ...(await signedAttachmentDownload(serviceClient, request.hospitalActor, request.params.ticketId, request.params.attachmentId)) }); }
    catch (error) { safeHospitalError(response, error); }
  });

  function masterHandler(key) {
    return async (request, response) => {
      try { response.json({ ok: true, [key]: (await loadHospitalMasters(serviceClient, request.hospitalActor))[key] }); }
      catch (error) { safeHospitalError(response, error); }
    };
  }

  return router;
}

function runHospitalPushDispatch(serviceClient, source) {
  setImmediate(() => {
    dispatchHospitalNotificationPushes(serviceClient)
      .catch((error) => console.warn('[Hospital Push] dispatch failed after route action', {
        source,
        code: error?.code || null,
        message: error?.message || 'unknown',
      }));
  });
}
