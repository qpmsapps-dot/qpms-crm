import express from 'express';
import { adminKmApprovalAuthorization } from '../services/foKmRecalculationAuthorizationService.js';
import { createOctoberRecoveryService } from '../services/foOctoberRecoveryService.js';
import { recoveryCsv } from '../services/foOctoberRecoveryReportingService.js';

export function createOctoberRecoveryRouter({ requireAuth, getClient, service = createOctoberRecoveryService() }) {
  const router = express.Router();
  function handler(method) {
    return async (req, res) => {
      try {
        adminKmApprovalAuthorization(req.profile, req.authUser, 'October recovery');
        const result = await service[method]({ client: getClient(), profile: req.profile, authUser: req.authUser }, req.method === 'GET' ? req.query : req.body || {});
        if (req.path.endsWith('.csv')) {
          res.type('text/csv').attachment('october-2026-km-recovery.csv').send(recoveryCsv(result.rows));
        } else res.json(result);
      } catch (error) {
        const missing = ['42P01', 'PGRST205', '42883', 'PGRST202'].includes(error.code);
        const messages = {
          recovery_approval_inactive: 'Approval is inactive pending explicit scoped exception and permission approval.',
          recovery_requests_inactive: 'Request storage is inactive or your Admin identity is not authorized.',
          recovery_overlapping_credit: 'An approved recovery already covers this journey window. No second credit was added.',
          recovery_already_included_distance: 'Saved travel legs already include this distance. Verify inclusion before proposing additional KM.',
          recovery_snapshot_stale: 'Attendance, travel or settlement evidence changed. Reject this stale request and prepare a fresh reviewed request.',
          recovery_saved_baseline_unknown: 'Existing saved payable KM or amount is unknown. Financial reconciliation is required before an addition.',
          recovery_recorded_transport_mismatch_or_ineligible: 'Requested mode differs from the recorded mode or is not petrol eligible. No transport mode was changed.',
          recovery_inclusion_or_mode_unverified: 'Verify inclusion, official journey total and petrol eligibility; approval was not applied.',
          recovery_decision_conflict: 'This request already has a different decision. Refresh the recorded result; no duplicate credit was added.',
          recovery_idempotency_conflict: 'The retry key belongs to different request details. Refresh before creating a distinct journey.',
        };
        res.status(Number(error.statusCode || (missing ? 503 : ['40001','23505','55000','40P01','55P03'].includes(error.code) ? 409 : error.code === '22023' ? 422 : error.code === '42501' ? 403 : 500)))
          .json({ ok: false, code: missing ? 'RECOVERY_SCHEMA_NOT_ACTIVATED' : error.code || 'RECOVERY_FAILED',
            message: missing ? 'Recovery migration and permissions have not been activated. Nothing was saved.' : messages[error.message] || (error.statusCode ? error.message : 'Recovery request failed. Refresh evidence before retrying; no financial success is assumed.') });
      }
    };
  }
  router.get('/october-recovery', requireAuth, handler('list'));
  router.get('/october-recovery.csv', requireAuth, handler('list'));
  router.post('/october-recovery/evidence', requireAuth, handler('evidence'));
  router.post('/october-recovery/requests', requireAuth, handler('submit'));
  router.post('/october-recovery/decision', requireAuth, handler('decide'));
  return router;
}
