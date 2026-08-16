import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const server = readFileSync('backend/server.js', 'utf8');

function routeBody(startNeedle, endNeedle) {
  const start = server.indexOf(startNeedle);
  assert.notEqual(start, -1, `${startNeedle} route must exist`);
  const end = server.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `${endNeedle} marker must exist after ${startNeedle}`);
  return server.slice(start, end);
}

test('backend supports NIMS contact registration without Supabase Auth provisioning', () => {
  assert.match(server, /hospital_client_contacts/);
  assert.match(server, /'\/api\/admin\/hospital-client-contacts'/);
  assert.match(server, /CREATE_NIMS_CLIENT_CONTACT/);
  assert.match(server, /auth_user_created: false/);
  assert.match(server, /profile_created: false/);
  assert.doesNotMatch(server, /hospital_client_contacts'[\s\S]{0,600}hospital_ticket_users/);
});

test('backend identifies registered mobile contacts and rejects unknown mobiles', () => {
  assert.match(server, /'\/api\/hospital-client\/identify'/);
  assert.match(server, /normalizeIndianMobile/);
  assert.match(server, /mobile_not_registered/);
  assert.match(server, /signHospitalContactToken/);
  assert.match(server, /client_contact_session_required/);
});

test('backend creates contact tickets through the contact RPC and validates ownership', () => {
  assert.match(server, /'\/api\/hospital-client\/tickets'/);
  assert.match(server, /rpc_create_hospital_contact_ticket/);
  assert.match(server, /raised_by_client_contact_id/);
  assert.match(server, /loadContactTicketForRequest/);
  assert.match(server, /Ticket was not found for this registered mobile number/);
});

test('backend provides contact-safe masters and attachment upload completion', () => {
  assert.match(server, /'\/api\/hospital-client\/categories'/);
  assert.match(server, /'\/api\/hospital-client\/hierarchy\/locations'/);
  assert.match(server, /'\/api\/hospital-client\/tickets\/:ticketId\/attachments\/sign-upload'/);
  assert.match(server, /'\/api\/hospital-client\/tickets\/:ticketId\/attachments\/complete'/);
  assert.match(server, /uploaded_by_user_id: null/);
});

test('contact attachments are constrained to the contact-owned ticket and storage path', () => {
  const ownershipHelper = routeBody('async function loadContactTicketForRequest', "app.post('/api/hospital-client/tickets/:ticketId/attachments/sign-upload'");
  assert.match(ownershipHelper, /loadHospitalContact\(client, tokenPayload\)/);
  assert.match(ownershipHelper, /\.eq\('raised_by_client_contact_id', contact\.id\)/);

  const signUpload = routeBody("app.post('/api/hospital-client/tickets/:ticketId/attachments/sign-upload'", "app.post('/api/hospital-client/tickets/:ticketId/attachments/complete'");
  assert.match(signUpload, /loadContactTicketForRequest\(client, tokenPayload, request\.params\.ticketId\)/);
  assert.match(signUpload, /`\$\{contact\.client_id\}\/\$\{ticket\.id\}\/\$\{type\}\//);

  const complete = routeBody("app.post('/api/hospital-client/tickets/:ticketId/attachments/complete'", "app.get('/api/hospital-client/tickets/:ticketId/attachments/:attachmentId/sign-download'");
  assert.match(complete, /loadContactTicketForRequest\(client, tokenPayload, request\.params\.ticketId\)/);
  assert.match(complete, /path\.startsWith\(`\$\{contact\.client_id\}\/\$\{ticket\.id\}\/`\)/);
  assert.match(complete, /attachment_forbidden/);
  assert.match(complete, /metadata: \{ source: 'nims_client_contact_mobile', client_contact_id: contact\.id \}/);

  const download = routeBody("app.get('/api/hospital-client/tickets/:ticketId/attachments/:attachmentId/sign-download'", 'async function requireSupabaseJwt');
  assert.match(download, /loadContactTicketForRequest\(client, tokenPayload, request\.params\.ticketId\)/);
  assert.match(download, /\.eq\('id', request\.params\.attachmentId\)/);
  assert.match(download, /\.eq\('ticket_id', ticket\.id\)/);
  assert.match(download, /\.eq\('is_client_visible', true\)/);
});
