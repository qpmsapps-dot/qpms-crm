import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const api = await readFile(new URL('../src/services/api.js', import.meta.url), 'utf8');
const crm = await readFile(new URL('../src/pages/CRM.jsx', import.meta.url), 'utf8');
const repository = await readFile(new URL('../src/services/workflowRepository.js', import.meta.url), 'utf8');
const server = await readFile(new URL('../backend/server.js', import.meta.url), 'utf8');

test('MOM send and draft routes require JWT, Lead Management, and MOM access', () => {
  assert.match(
    server,
    /app\.post\('\/send-lead-mom',\s*requireSupabaseJwt,\s*requireLeadManagementAccess,\s*requireLeadMomAccess,\s*routeSendMom\('lead'\)\)/,
  );
  assert.match(
    server,
    /'\/api\/lead-management\/leads\/:leadId\/mom',[\s\S]*requireSupabaseJwt,[\s\S]*requireLeadManagementAccess,[\s\S]*requireLeadMomAccess,[\s\S]*saveLeadMomDraftManagement/,
  );
  const legacyRoute = server.match(
    /app\.post\('\/api\/leads\/:leadId\/send-mom'[\s\S]*?\n\}\);/,
  )?.[0] || '';
  assert.match(legacyRoute, /canManageLeadMom\(actor, lead\)/);
  assert.doesNotMatch(legacyRoute, /requireRoles\(\[/);
});

test('MOM authorization returns distinct not-found and forbidden responses', () => {
  assert.match(server, /status\(404\)[\s\S]*code: 'lead_not_found'/);
  assert.match(server, /status\(403\)[\s\S]*code: 'lead_mom_access_denied'/);
  assert.match(server, /You do not have permission to send MOM for this lead\./);
});

test('MOM sender and recipients are derived server-side', () => {
  assert.match(server, /safeLeadMomSender\(request\.leadActor\)/);
  assert.match(server, /leadMomContactRecipients\(request\.authorizedLeadContacts\)/);
  assert.match(server, /\[sent \? 'sent_by' : 'updated_by'\]: sender/);
  assert.doesNotMatch(server, /request\.body\?\.sent_by/);
});

test('web uses the centralized MOM role helper and Lead API error handling', () => {
  assert.match(crm, /const canSendMom = canSendLeadMom\(user\)/);
  assert.match(crm, /\{canSendMom \? \(/);
  assert.match(crm, /You do not have permission to send MOM for this lead\./);
  assert.match(api, /sendAuthenticatedLeadMom[\s\S]*leadApiRequest/);
  assert.match(api, /saveAuthenticatedLeadMomDraft[\s\S]*leadApiRequest/);
});

test('production MOM draft persistence no longer writes lead_mom from the browser', () => {
  const saveFunction = repository.match(
    /export async function saveLeadMomRemote[\s\S]*?\n\}/,
  )?.[0] || '';
  assert.match(saveFunction, /saveAuthenticatedLeadMomDraft/);
  assert.doesNotMatch(saveFunction, /supabase\.from\('lead_mom'\)\.upsert/);
});
