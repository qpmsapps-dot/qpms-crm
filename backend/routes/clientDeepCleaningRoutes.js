import express from 'express';
import {
  completeClientDeepCleaningUpload,
  createClientDeepCleaningSubmission,
  createClientDeepCleaningUploadUrl,
  createClientDeepCleaningUploadViewUrl,
  deleteClientDeepCleaningUpload,
  listClientDeepCleaningSubmissions,
  loadOwnedSubmission,
  safeClientDeepCleaningError,
  searchRelianceRetailStores,
  submitClientDeepCleaningSubmission,
  updateClientDeepCleaningDraft,
} from '../services/clientDeepCleaningService.js';

export function createClientDeepCleaningRouter({ requireAuth, getClient }) {
  if (typeof requireAuth !== 'function') {
    throw new Error('createClientDeepCleaningRouter requires requireAuth middleware.');
  }
  if (typeof getClient !== 'function') {
    throw new Error('createClientDeepCleaningRouter requires getClient.');
  }

  const router = express.Router();
  router.use(requireAuth);

  router.get('/stores', async (request, response) => {
    try {
      const result = await searchRelianceRetailStores(
        getClient(),
        request.profile,
        request.query || {},
      );
      response.json({ ok: true, ...result });
    } catch (error) {
      safeClientDeepCleaningError(response, error);
    }
  });

  router.post('/submissions', async (request, response) => {
    try {
      const row = await createClientDeepCleaningSubmission(
        getClient(),
        request.profile,
        request.body || {},
      );
      response.status(201).json({ ok: true, submission: row });
    } catch (error) {
      safeClientDeepCleaningError(response, error);
    }
  });

  router.get('/submissions', async (request, response) => {
    try {
      const result = await listClientDeepCleaningSubmissions(
        getClient(),
        request.profile,
        request.query || {},
      );
      response.json({ ok: true, ...result });
    } catch (error) {
      safeClientDeepCleaningError(response, error);
    }
  });

  router.get('/submissions/:id', async (request, response) => {
    try {
      const submission = await loadOwnedSubmission(
        getClient(),
        request.profile,
        request.params.id,
        { includeUploads: true },
      );
      response.json({ ok: true, submission });
    } catch (error) {
      safeClientDeepCleaningError(response, error);
    }
  });

  router.patch('/submissions/:id', async (request, response) => {
    try {
      const submission = await updateClientDeepCleaningDraft(
        getClient(),
        request.profile,
        request.params.id,
        request.body || {},
      );
      response.json({ ok: true, submission });
    } catch (error) {
      safeClientDeepCleaningError(response, error);
    }
  });

  router.post('/submissions/:id/upload-url', async (request, response) => {
    try {
      const upload = await createClientDeepCleaningUploadUrl(
        getClient(),
        request.profile,
        request.params.id,
        request.body || {},
      );
      response.json({ ok: true, upload });
    } catch (error) {
      safeClientDeepCleaningError(response, error);
    }
  });

  router.post('/submissions/:id/uploads/complete', async (request, response) => {
    try {
      const upload = await completeClientDeepCleaningUpload(
        getClient(),
        request.profile,
        request.params.id,
        request.body || {},
      );
      response.status(201).json({ ok: true, upload });
    } catch (error) {
      safeClientDeepCleaningError(response, error);
    }
  });

  router.delete('/submissions/:id/uploads/:uploadId', async (request, response) => {
    try {
      const upload = await deleteClientDeepCleaningUpload(
        getClient(),
        request.profile,
        request.params.id,
        request.params.uploadId,
      );
      response.json({ ok: true, upload });
    } catch (error) {
      safeClientDeepCleaningError(response, error);
    }
  });

  router.get('/submissions/:id/uploads/:uploadId/view-url', async (request, response) => {
    try {
      const view = await createClientDeepCleaningUploadViewUrl(
        getClient(),
        request.profile,
        request.params.id,
        request.params.uploadId,
      );
      response.json({ ok: true, view });
    } catch (error) {
      safeClientDeepCleaningError(response, error);
    }
  });

  router.post('/submissions/:id/submit', async (request, response) => {
    try {
      const submission = await submitClientDeepCleaningSubmission(
        getClient(),
        request.profile,
        request.params.id,
      );
      response.json({ ok: true, submission });
    } catch (error) {
      safeClientDeepCleaningError(response, error);
    }
  });

  return router;
}
