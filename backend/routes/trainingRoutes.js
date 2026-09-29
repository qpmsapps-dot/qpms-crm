import express from 'express';
import * as defaultTrainingService from '../services/trainingService.js';
import * as defaultEvidenceService from '../services/trainingEvidenceService.js';
import { safeTrainingError } from '../services/trainingAccessService.js';

function trainingLog(request, operation, result, sessionId = null) {
  console.info('[Training]', {
    route: request.originalUrl || request.url,
    operation,
    result,
    session_id: sessionId || request.params?.id || null,
    actor_profile_id: request.profile?.id || null,
  });
}
export function createTrainingRouter({
  requireAuth,
  getClient,
  service = defaultTrainingService,
  evidenceService = defaultEvidenceService,
}) {
  if (typeof requireAuth !== 'function') throw new Error('createTrainingRouter requires requireAuth middleware.');
  if (typeof getClient !== 'function') throw new Error('createTrainingRouter requires getClient.');
  const router = express.Router();
  router.use(requireAuth);

  const route = (operation, handler, { status = 200 } = {}) => async (request, response) => {
    try {
      const result = await handler(request, getClient());
      trainingLog(request, operation, 'success', result?.session?.id || result?.id);
      response.status(status).json({ ok: true, ...result });
    } catch (error) {
      trainingLog(request, operation, 'failed');
      safeTrainingError(response, error);
    }
  };

  router.get('/categories', route('list_categories', async (request, client) => ({
    categories: await service.listTrainingCategories(client, request.profile),
  })));

  router.get('/types', route('list_types', async (request, client) => ({
    training_types: await service.listTrainingTypes(client, request.profile),
  })));

  router.get('/topics', route('list_topics', async (request, client) => ({
    topics: await service.listTrainingTopics(client, request.profile, request.query || {}),
  })));

  router.get('/site-staff', route('site_staff', async (request, client) => ({
    staff: await service.searchTrainingSiteStaff(client, request.profile, request.query || {}),
  })));

  router.post('/sessions', route('create_session', async (request, client) => ({
    ...(await service.createTrainingSession(client, request.profile, request.body || {})),
  }), { status: 201 }));

  router.get('/sessions', route('list_sessions', async (request, client) => ({
    sessions: await service.listTrainingSessions(client, request.profile, request.query || {}),
  })));

  router.get('/sessions/:id', route('get_session', async (request, client) => ({
    ...(await service.getTrainingSession(client, request.profile, request.params.id)),
  })));

  router.patch('/sessions/:id', route('update_session', async (request, client) => ({
    ...(await service.updateTrainingSession(client, request.profile, request.params.id, request.body || {})),
  })));

  router.post('/sessions/:id/attendees', route('add_attendee', async (request, client) => ({
    attendee: await service.addTrainingAttendee(client, request.profile, request.params.id, request.body || {}),
  }), { status: 201 }));

  router.delete('/sessions/:id/attendees/:attendeeId', route('remove_attendee', async (request, client) => ({
    attendee: await service.removeTrainingAttendee(client, request.profile, request.params.id, request.params.attendeeId),
  })));

  router.put('/sessions/:id/topics', route('set_topics', async (request, client) => ({
    topics: await service.setTrainingTopics(client, request.profile, request.params.id, request.body || {}),
  })));

  router.patch('/sessions/:id/topics/:sessionTopicId', route('update_topic', async (request, client) => ({
    topic: await service.updateTrainingTopic(client, request.profile, request.params.id, request.params.sessionTopicId, request.body || {}),
  })));

  router.post('/sessions/:id/evidence/upload-url', route('evidence_upload_url', async (request, client) => ({
    upload: await evidenceService.createTrainingEvidenceUploadUrl(client, request.profile, request.params.id, request.body || {}),
  })));

  router.post('/sessions/:id/evidence/complete', route('evidence_complete', async (request, client) => ({
    evidence: await evidenceService.completeTrainingEvidence(client, request.profile, request.params.id, request.body || {}),
  }), { status: 201 }));

  router.delete('/sessions/:id/evidence/:evidenceId', route('evidence_delete', async (request, client) => ({
    evidence: await evidenceService.deleteTrainingEvidence(client, request.profile, request.params.id, request.params.evidenceId),
  })));

  router.get('/sessions/:id/evidence/:evidenceId/view-url', route('evidence_view_url', async (request, client) => ({
    view: await evidenceService.createTrainingEvidenceViewUrl(client, request.profile, request.params.id, request.params.evidenceId),
  })));

  router.post('/sessions/:id/submit', route('submit_session', async (request, client) => ({
    ...(await service.submitTrainingSession(client, request.profile, request.params.id, {
      verifyEvidenceObjects: evidenceService.verifyTrainingEvidenceObjects,
    })),
  })));

  router.post('/sessions/:id/cancel', route('cancel_session', async (request, client) => ({
    ...(await service.cancelTrainingSession(client, request.profile, request.params.id)),
  })));

  return router;
}
