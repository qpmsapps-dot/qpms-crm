import { leadActor } from '../services/leadManagementService.js';
import { createRequireWritablePreSalesEnvironment } from '../services/readOnlyUatMode.js';
import { canAccessTender, claimTenderTask, decideTenderReview, listTenderWorkspace, reserveTenderUpload, submitTenderVersion, tenderWorkbookUrl } from '../services/tenderWorkflowService.js';

function sendError(response, error) { response.status(Number(error.statusCode || 500)).json({ ok: false, code: error.code || 'tender_failed', message: error.statusCode >= 500 ? 'Tender request failed.' : error.message }); }
export function registerTenderRoutes({ app, requireJwt, getClient }) {
  const access = (request, response, next) => { request.tenderActor = leadActor(request.profile, request.authUser); if (!canAccessTender(request.tenderActor)) return response.status(403).json({ ok: false, code: 'tender_access_denied', message: 'Tender access is required.' }); next(); };
  const guards = [requireJwt, access]; const mutations = [...guards, createRequireWritablePreSalesEnvironment()];
  const handler = (fn) => async (request, response) => { try { response.json({ ok: true, ...(await fn(getClient(), request.tenderActor, request)) }); } catch (error) { sendError(response, error); } };
  app.get('/api/tender/workspace', ...guards, handler(async (client, actor) => ({ items: await listTenderWorkspace(client, actor) })));
  app.post('/api/tender/packages/:packageId/claim', ...mutations, handler(async (client, actor, request) => ({ package: await claimTenderTask(client, actor, request.params.packageId, request.get('Idempotency-Key')) })));
  app.post('/api/tender/packages/:packageId/versions/upload-url', ...mutations, handler(async (client, actor, request) => reserveTenderUpload(client, actor, request.params.packageId, request.body, request.get('Idempotency-Key'))));
  app.post('/api/tender/packages/:packageId/versions/:versionId/submit', ...mutations, handler(async (client, actor, request) => ({ result: await submitTenderVersion(client, actor, request.params.packageId, request.params.versionId, request.body?.file_size, request.get('Idempotency-Key')) })));
  app.post('/api/tender/reviews/:reviewId/decision', ...mutations, handler(async (client, actor, request) => ({ result: await decideTenderReview(client, actor, request.params.reviewId, request.body, request.get('Idempotency-Key')) })));
  app.get('/api/tender/versions/:versionId/url', ...guards, handler(async (client, actor, request) => tenderWorkbookUrl(client, actor, request.params.versionId)));
}
