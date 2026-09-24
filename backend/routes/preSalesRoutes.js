import {
  addCallUpdate,
  assignPreSalesOwner,
  completeFollowup,
  createHandoff,
  createMeeting,
  getPreSalesDashboard,
  getPreSalesLead,
  listCallHistory,
  listBdHandoffAssignees,
  listFollowups,
  listHandoffs,
  listMeetings,
  listPreSalesLeads,
  listPreSalesOwners,
  rescheduleFollowup,
  updateMeeting,
} from '../services/preSalesService.js';
import { createRequireWritablePreSalesEnvironment } from '../services/readOnlyUatMode.js';

function respondError(response, error) {
  const status = Number(error?.statusCode || error?.status || 500);
  response.status(status).json({
    ok: false,
    code: error?.code || 'pre_sales_request_failed',
    message: status >= 500 ? 'Pre-Sales service is temporarily unavailable.' : error.message,
  });
}

function handler(getClient, action) {
  return async (request, response) => {
    try {
      const result = await action(getClient(), request.leadActor, request);
      response.json({ ok: true, ...result });
    } catch (error) {
      if (Number(error?.statusCode || 500) >= 500) {
        console.error('[myQPMS Pre-Sales] request failed', { code: error?.code || null, message: error?.message || 'Unknown error' });
      }
      respondError(response, error);
    }
  };
}

export function registerPreSalesRoutes({
  app,
  requireJwt,
  requireLeadAccess,
  getClient,
  createLeadHandler,
  updateLeadHandler,
}) {
  const guards = [requireJwt, requireLeadAccess];
  const mutationGuards = [...guards, createRequireWritablePreSalesEnvironment()];

  app.get('/api/pre-sales/dashboard', ...guards, handler(getClient, async (client, actor) => ({ dashboard: await getPreSalesDashboard(client, actor) })));
  app.get('/api/pre-sales/bd-assignees', ...guards, handler(getClient, async (client) => ({ items: await listBdHandoffAssignees(client) })));
  app.get('/api/pre-sales/owners', ...guards, handler(getClient, async (client, actor) => ({ items: await listPreSalesOwners(client, actor) })));
  app.get('/api/pre-sales/leads', ...guards, handler(getClient, async (client, actor, request) => listPreSalesLeads(client, actor, request.query)));
  app.post('/api/pre-sales/leads', ...mutationGuards, createLeadHandler);
  app.get('/api/pre-sales/leads/:leadId', ...guards, handler(getClient, async (client, actor, request) => ({ lead: await getPreSalesLead(client, actor, request.params.leadId) })));
  app.patch('/api/pre-sales/leads/:leadId', ...mutationGuards, updateLeadHandler);
  app.patch('/api/pre-sales/leads/:leadId/owner', ...mutationGuards, handler(getClient, async (client, actor, request) => ({ lead: await assignPreSalesOwner(client, actor, request.params.leadId, request.body?.owner_profile_id) })));

  app.get('/api/pre-sales/leads/:leadId/call-history', ...guards, handler(getClient, async (client, actor, request) => ({ items: await listCallHistory(client, actor, request.params.leadId) })));
  app.post('/api/pre-sales/leads/:leadId/call-update', ...mutationGuards, handler(getClient, async (client, actor, request) => addCallUpdate(client, actor, request.params.leadId, request.body)));

  app.get('/api/pre-sales/followups', ...guards, handler(getClient, async (client, actor, request) => ({ items: await listFollowups(client, actor, request.query) })));
  app.patch('/api/pre-sales/followups/:followupId/complete', ...mutationGuards, handler(getClient, async (client, actor, request) => ({ followup: await completeFollowup(client, actor, request.params.followupId, request.body) })));
  app.patch('/api/pre-sales/followups/:followupId/reschedule', ...mutationGuards, handler(getClient, async (client, actor, request) => ({ followup: await rescheduleFollowup(client, actor, request.params.followupId, request.body) })));

  app.get('/api/pre-sales/leads/:leadId/meetings', ...guards, handler(getClient, async (client, actor, request) => ({ items: await listMeetings(client, actor, request.params.leadId) })));
  app.post('/api/pre-sales/leads/:leadId/meetings', ...mutationGuards, handler(getClient, async (client, actor, request) => ({ meeting: await createMeeting(client, actor, request.params.leadId, request.body) })));
  app.patch('/api/pre-sales/meetings/:meetingId', ...mutationGuards, handler(getClient, async (client, actor, request) => ({ meeting: await updateMeeting(client, actor, request.params.meetingId, request.body) })));

  app.get('/api/pre-sales/leads/:leadId/handoffs', ...guards, handler(getClient, async (client, actor, request) => ({ items: await listHandoffs(client, actor, request.params.leadId) })));
  app.post('/api/pre-sales/leads/:leadId/handover', ...mutationGuards, handler(getClient, async (client, actor, request) => ({ handoff: await createHandoff(client, actor, request.params.leadId, request.body) })));
}
