import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import cors from 'cors';
import express from 'express';
import { createCorsOptions, resolveAllowedOrigins } from '../services/corsPolicyService.js';

test('configured Vite loopback origin permits both localhost spellings', () => {
  assert.deepEqual(resolveAllowedOrigins('http://localhost:5173'), [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);
  assert.deepEqual(resolveAllowedOrigins('http://127.0.0.1:5173'), [
    'http://127.0.0.1:5173',
    'http://localhost:5173',
  ]);
});

test('production-only configuration does not add development origins', () => {
  assert.deepEqual(
    resolveAllowedOrigins('https://myqpms.example,https://admin.myqpms.example'),
    ['https://myqpms.example', 'https://admin.myqpms.example'],
  );
});

test('authenticated Vite preflight permits Authorization and Content-Type', async (t) => {
  const app = express();
  app.use(cors(createCorsOptions(resolveAllowedOrigins('http://localhost:5173'))));
  app.get('/api/test', (_request, response) => response.json({ ok: true }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/test`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://127.0.0.1:5173',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173');
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  assert.match(response.headers.get('access-control-allow-headers') || '', /authorization/i);
  assert.match(response.headers.get('access-control-allow-headers') || '', /content-type/i);
});

test('unconfigured browser origins remain blocked', async () => {
  const options = createCorsOptions(resolveAllowedOrigins('https://myqpms.example'));
  await assert.rejects(
    () => new Promise((resolve, reject) => {
      options.origin('http://127.0.0.1:5173', (error, allowed) => {
        if (error) reject(error);
        else resolve(allowed);
      });
    }),
    /CORS blocked/,
  );
});
