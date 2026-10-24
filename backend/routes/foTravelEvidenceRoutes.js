import express from 'express';
import { createTravelEvidenceService } from '../services/foTravelEvidenceService.js';
import { adminKmApprovalAuthorization } from '../services/foKmRecalculationAuthorizationService.js';

export function createTravelEvidenceRouter({ requireAuth, getClient, calculate = createTravelEvidenceService() }) {
  const router = express.Router();
  router.post('/travel-evidence', requireAuth, async (req, res) => {
    try {
      // Deny before even acquiring the service-role client.
      adminKmApprovalAuthorization(req.profile, req.authUser, 'Read-only travel evidence');
      res.json(await calculate({ client: getClient(), payload: req.body || {}, profile: req.profile, authUser: req.authUser }));
    } catch (error) {
      const status = Number(error.statusCode || (error.code === '57014' ? 504 : 500));
      res.status(status).json({ ok: false, code: error.code || 'KM_EVIDENCE_FAILED',
        message: status >= 500 ? 'Travel evidence could not be calculated. Nothing was saved; retry this date.' : error.message });
    }
  });
  return router;
}
