import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const server = await readFile(new URL('../server.js', import.meta.url), 'utf8');

test('client contacts route uses authenticated Hospital Ticket access before the dynamic detail route', () => {
  const route = "app.get('/api/web/hospital-tickets/client-contacts', requireSupabaseJwtAllowMissingProfile, requireHospitalWebAccess";
  assert.match(server, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(server.indexOf(route) < server.indexOf("app.get('/api/web/hospital-tickets/:ticketId'"));
  assert.match(server, /listWebHospitalClientContacts\(client, request\.hospitalWebAccess, request\.query \|\| \{\}\)/);
});
