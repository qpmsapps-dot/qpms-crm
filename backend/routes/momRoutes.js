import express from 'express';
import * as defaultService from '../services/momService.js';
import { safeMomError } from '../services/momAccessService.js';

export function createMomRouter({ requireAuth, getClient, service = defaultService }) {
  if (typeof requireAuth !== 'function') throw new Error('createMomRouter requires requireAuth middleware.');
  if (typeof getClient !== 'function') throw new Error('createMomRouter requires getClient.');
  const router = express.Router();
  router.use(requireAuth);
  const route = (handler, status = 200) => async (request, response) => {
    try {
      const result = await handler(request, getClient());
      response.status(status).json({ ok: true, ...result });
    } catch (error) {
      console.warn('[MoM]', { route: request.originalUrl || request.url, actor_profile_id: request.profile?.id || null, code: error?.code || null });
      safeMomError(response, error);
    }
  };
  router.get('/statuses', route(async (request, client) => ({ statuses: await service.listMomStatuses(client, request.profile, request.query || {}) })));
  router.get('/by-visit/:visitId', route(async (request, client) => ({ record: await service.getMomByVisit(client, request.profile, request.params.visitId) })));
  router.get('/:id', route(async (request, client) => ({ record: await service.getMom(client, request.profile, request.params.id) })));
  router.put('/:id/draft', route(async (request, client) => ({ record: await service.saveMom(client, request.profile, { ...(request.body || {}), id: request.params.id }) })));
  router.post('/:id/submit', route(async (request, client) => ({ record: await service.saveMom(client, request.profile, { ...(request.body || {}), id: request.params.id }, { submit: true }) })));
  router.post('/:id/attachments/upload-url', route(async (request, client) => ({ upload: await service.createMomAttachmentUploadUrl(client, request.profile, request.params.id, request.body || {}) })));
  router.post('/:id/attachments/complete', route(async (request, client) => ({ attachment: await service.completeMomAttachment(client, request.profile, request.params.id, request.body || {}) })));
  router.get('/:id/attachments/:attachmentId/view-url', route(async (request, client) => ({ view: await service.createMomAttachmentViewUrl(client, request.profile, request.params.id, request.params.attachmentId) })));
  return router;
}
