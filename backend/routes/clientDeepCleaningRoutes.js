import express from 'express';
import {closeEvidenceMutationRoutes} from '../services/compatibilityAdmission.js';
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
  closeEvidenceMutationRoutes(router);
  router.use(requireAuth);

  // Scheduled Deep Cleaning tasks: TN zone FO only; other states geographic FO scope.
  router.get('/schedules', async (request, response) => {
    try {
      const indiaDay = () => new Date(Date.now()+330*60000).toISOString().slice(0,10);
      const from = request.query?.from || indiaDay();
      const to = request.query?.to || new Date(Date.now()+330*60000+30*86400000).toISOString().slice(0,10);
      const {data,error}=await getClient().rpc('rpc_retail_cleaning_fo_schedules',{
        p_actor:request.profile?.id,p_from:from,p_to:to
      });
      if(error)throw Object.assign(error,{statusCode:error.code==='42501'?403:error.code==='22023'?400:503});
      response.json({ok:true,...data});
    }catch(error){safeClientDeepCleaningError(response,error);}
  });

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
