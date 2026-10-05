import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serverSource = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('FO Check-In route is registered before the JSON fallback', () => {
  const checkInRoute = serverSource.indexOf("'/api/fo/site-visits/validate-checkin-location'");
  const jsonFallback = serverSource.indexOf("app.use('/api/fo/site-visits'");

  assert.ok(checkInRoute >= 0, 'Check-In validation route must be registered');
  assert.ok(jsonFallback > checkInRoute, 'JSON fallback must follow the Check-In route');
  assert.match(
    serverSource.slice(jsonFallback, jsonFallback + 500),
    /response\.status\(404\)\.json/,
  );
});
