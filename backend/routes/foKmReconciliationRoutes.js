import express from 'express';
import { adminKmApprovalAuthorization } from '../services/foKmRecalculationAuthorizationService.js';
import { reconcileSupportedKm, sharedKmReconciliationEnabled } from '../services/foKmIncrementalReconciliationService.js';
import { evidencePages, attendanceDayBounds, kmError } from '../services/foKmEvidenceService.js';

export function createKmReconciliationRouter({ requireAuth, getClient, reconcile = reconcileSupportedKm, environment = process.env }) {
  const router = express.Router();
  router.post('/reconcile-supported', requireAuth, async (req, res) => {
    try {
      const admin = adminKmApprovalAuthorization(req.profile, req.authUser, 'Explicit selected-period evidence reconciliation');
      if (!sharedKmReconciliationEnabled(environment)) throw kmError('KM_SHARED_RECONCILIATION_INACTIVE','Shared KM reconciliation is inactive; no database work was started.',503);
      const { employee_code: code, from_date: from, to_date: to } = req.body || {};
      if (!/^[A-Z0-9_-]{2,40}$/.test(code || '')) throw kmError('km_employee_invalid', 'Select an employee.', 400);
      const [a] = attendanceDayBounds(from), [b] = attendanceDayBounds(to);
      if (b < a || b - a > 30 * 86400000) throw kmError('km_period_invalid', 'Choose at most 31 days.', 400);
      const client = getClient();
      const rows = await evidencePages(() => client.from('fo_attendance').select('id,attendance_date').eq('employee_code', code).gte('attendance_date', from).lte('attendance_date', to).order('attendance_date').order('id'), { maximum: 100 });
      const results = [];
      for (const row of rows) {
        try { results.push(await reconcile(client, { attendance_id: row.id }, { environment, persist: true, adminAuthorization: admin, trigger: 'admin_recalculation', maxGoogleDirectionsCalls: 6, deadlineAt: Date.now() + 20000 })); }
        catch (error) { results.push({ attendance_id: row.id, date: row.attendance_date, status: error.code === 'KM_SHARED_SCHEMA_UNAVAILABLE' ? 'deferred' : 'failed', financial_posted: false, code: error.code || 'KM_FAILED', message: error.code === 'KM_SHARED_SCHEMA_UNAVAILABLE' ? error.message : 'Calculation or posting failed; no financial success is assumed.' }); }
      }
      res.json({ ok: !results.some(r => ['failed','deferred'].includes(r.status)), selected_period: { from, to }, results });
    } catch (error) { res.status(error.statusCode || 500).json({ ok: false, code: error.code, message: error.statusCode ? error.message : 'Reconciliation failed; payable values were not assumed saved.' }); }
  });
  return router;
}
