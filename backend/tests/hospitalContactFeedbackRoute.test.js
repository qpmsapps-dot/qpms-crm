import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync('backend/server.js', 'utf8');

function contactFeedbackRoute() {
  return server.slice(
    server.indexOf("app.post('/api/hospital-client/tickets/:ticketId/feedback'"),
    server.indexOf("app.post('/api/hospital-client/tickets/:ticketId/attachments/sign-upload'"),
  );
}

test('registered contact feedback route is contact-token scoped', () => {
  const route = contactFeedbackRoute();
  assert.match(route, /app\.post\('\/api\/hospital-client\/tickets\/:ticketId\/feedback'/);
  assert.match(route, /const tokenPayload = hospitalContactAuth\(request, response\)/);
  assert.match(route, /loadContactTicketForRequest\(client, tokenPayload, request\.params\.ticketId\)/);
  assert.match(route, /\.eq\('raised_by_client_contact_id', contact\.id\)/);
  assert.doesNotMatch(route, /hospital_ticket_users/);
});

test('registered contact feedback closes or reopens existing ticket fields', () => {
  const route = contactFeedbackRoute();
  assert.match(route, /ticket\.status_code !== 'resolved_awaiting_confirmation'/);
  assert.match(route, /status_code: 'closed'/);
  assert.match(route, /current_escalation_level: 'completed'/);
  assert.match(route, /client_rating: rating/);
  assert.match(route, /client_feedback: comments/);
  assert.match(route, /client_satisfaction_status: 'satisfied'/);
  assert.match(route, /closed_at: now/);
  assert.match(route, /status_code: 'reopened'/);
  assert.match(route, /client_satisfaction_status: 'not_satisfied'/);
  assert.match(route, /reopened_at: now/);
  assert.match(route, /reopen_count: Number\(ticket\.reopen_count \|\| 0\) \+ 1/);
});

test('registered contact feedback writes existing lifecycle events and internal notifications', () => {
  const route = contactFeedbackRoute();
  assert.match(route, /event_type: satisfied \? 'client_satisfied' : 'client_not_satisfied'/);
  assert.match(route, /event_type: 'ticket_reopened'/);
  assert.match(route, /notification_type: satisfied \? 'client_satisfied' : 'ticket_reopened'/);
  assert.match(route, /source: 'nims_client_contact_mobile'/);
  assert.match(route, /client_contact_id: contact\.id/);
  assert.match(route, /app_scope: 'myqpms_internal'/);
});
