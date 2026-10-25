import express from 'express';
import { adminKmApprovalAuthorization } from '../services/foKmRecalculationAuthorizationService.js';
import { reconcileSupportedKm, sharedKmReconciliationEnabled, sharedKmPreviewEnabled } from '../services/foKmIncrementalReconciliationService.js';
import { evidencePages, attendanceDayBounds, kmError } from '../services/foKmEvidenceService.js';

export function createKmReconciliationRouter({ requireAuth, getClient, reconcile = reconcileSupportedKm, environment = process.env }) {
  const router = express.Router();
  router.post('/reconcile-supported', requireAuth, async (req, res) => {
    try {
      const admin = adminKmApprovalAuthorization(req.profile, req.authUser, 'Explicit selected-period evidence reconciliation');
      if (req.body?.dry_run !== undefined && typeof req.body.dry_run !== 'boolean') throw kmError('km_dry_run_invalid', 'dry_run must be a boolean.', 400);
      const dryRun = req.body?.dry_run === true;
      if (!(dryRun ? sharedKmPreviewEnabled(environment) : sharedKmReconciliationEnabled(environment))) throw kmError('KM_SHARED_RECONCILIATION_INACTIVE','Shared KM reconciliation is inactive; no database work was started.',503);
      const { employee_code: code, from_date: from, to_date: to } = req.body || {};
      if (!/^[A-Z0-9_-]{2,40}$/.test(code || '')) throw kmError('km_employee_invalid', 'Select an employee.', 400);
      const [a] = attendanceDayBounds(from), [b] = attendanceDayBounds(to);
      if (b < a || b - a > 30 * 86400000) throw kmError('km_period_invalid', 'Choose at most 31 days.', 400);
      const scopedReference = req.body?.authorization_reference;
      if (scopedReference !== undefined && (!/^[A-Z0-9_-]{8,100}$/.test(scopedReference) || typeof scopedReference !== 'string' || from !== to || dryRun)) throw kmError('km_scope_selection_invalid', 'A scoped posting requires one date and a valid authorization reference.', 400);
      const scopedAttendance = req.body?.attendance_id;
      if (scopedReference !== undefined && (typeof scopedAttendance !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scopedAttendance))) throw kmError('km_scope_attendance_required', 'Select the exact authorized attendance.', 400);
      const client = getClient();
      const rows = await evidencePages(() => {
        let query = client.from('fo_attendance').select('id,attendance_date').eq('employee_code', code).gte('attendance_date', from).lte('attendance_date', to);
        if (scopedReference !== undefined) query = query.eq('id', scopedAttendance);
        return query.order('attendance_date').order('id');
      }, { maximum: 100 });
      const results = [];
      for (const row of rows) {
        try { results.push(await reconcile(client, { attendance_id: row.id }, { environment, persist: !dryRun, adminAuthorization: admin, scopedAuthorizationReference: scopedReference, trigger: 'admin_recalculation', maxGoogleDirectionsCalls: 6, deadlineAt: Date.now() + 20000 })); }
        catch (error) { results.push({ attendance_id: row.id, date: row.attendance_date, status: error.code === 'KM_SHARED_SCHEMA_UNAVAILABLE' ? 'deferred' : 'failed', financial_posted: false, code: error.code || 'KM_FAILED', message: error.code === 'KM_SHARED_SCHEMA_UNAVAILABLE' ? error.message : 'Calculation or posting failed; no financial success is assumed.' }); }
      }
      res.json({ ok: !results.some(r => ['failed','deferred'].includes(r.status)), mode: dryRun ? 'calculation_only' : 'posting', selected_period: { from, to }, results });
    } catch (error) { res.status(error.statusCode || 500).json({ ok: false, code: error.code, message: error.statusCode ? error.message : 'Reconciliation failed; payable values were not assumed saved.' }); }
  });
  return router;
}
