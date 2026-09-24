import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import test from 'node:test';

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(url, child, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Backend exited early with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return response;
    } catch {
      // The isolated test backend may still be starting; retry until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the read-only UAT backend health endpoint.');
}

test('read-only UAT server starts HTTP/auth routes without autonomous workers', async (t) => {
  const port = await availablePort();
  const output = [];
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      READ_ONLY_UAT_MODE: 'true',
      SUPABASE_URL: 'http://127.0.0.1:9',
      SUPABASE_ANON_KEY: 'local-read-only-uat-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'local-read-only-uat-service-role-key',
      EMAIL_USER: '',
      EMAIL_PASS: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const health = await waitForHealth(baseUrl, child);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);

  for (const path of ['/api/pre-sales/dashboard', '/api/pre-sales/leads', '/api/pre-sales/owners']) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 401, `${path} must remain protected by authentication`);
    assert.match((await response.json()).message, /Bearer token required/i);
  }

  const unauthenticatedMutation = await fetch(`${baseUrl}/api/pre-sales/leads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(unauthenticatedMutation.status, 401, 'authentication must run before the UAT mutation guard');
  assert.match((await unauthenticatedMutation.json()).message, /Bearer token required/i);

  await new Promise((resolve) => setTimeout(resolve, 200));
  const logs = output.join('');
  assert.match(logs, /READ_ONLY_UAT_MODE enabled/);
  assert.doesNotMatch(logs, /\[myQPMS FO stale cleanup\] (cleanup started|run complete)/);
  assert.doesNotMatch(logs, /\[myQPMS Daily Report Scheduler\] started/);
  assert.doesNotMatch(logs, /\[myQPMS End Day KM Auto Recalc\] started/);
  assert.doesNotMatch(logs, /\[Hospital Ticketing SLA\] worker failed/);
});
