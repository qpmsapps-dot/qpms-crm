import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('PATCH preserves contacts when omitted and replaces them when supplied', () => {
  assert.match(
    server,
    /contacts:\s*Array\.isArray\(request\.body\?\.contacts\)\s*\?\s*request\.body\.contacts\s*:\s*existingContacts/,
  );
  assert.match(server, /p_contacts:\s*merged\.contacts/);
  assert.match(server, /rpc_update_bd_lead_atomic/);
});
