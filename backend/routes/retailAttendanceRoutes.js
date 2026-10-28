import express from 'express';
import { ATTENDANCE_MAX_FILE_BYTES } from '../shared/retailAttendance.js';
import { attendanceAccess, previewRetailAttendance, commitRetailAttendance, retailAttendanceReport, retailAttendanceEmployees, retailAttendanceHistory } from '../services/retailAttendanceService.js';

export function createRetailAttendanceRouter({ getClient, environment = process.env }) {
  const router = express.Router(); // Mounted AFTER the established Retail JWT middleware.
  router.use((req, res, next) => {
    if (environment.RETAIL_ATTENDANCE_ENABLED !== 'true') return res.status(503).json({ ok: false, message: 'Attendance dashboard is awaiting approved rollout.' });
    try { attendanceAccess(req.profile); next(); } catch (error) { res.status(error.statusCode || 403).json({ ok: false, message: error.message }); }
  });
  const run = handler => async (req, res) => {
    try { res.json({ ok: true, ...(await handler(req)) }); }
    catch (error) {
      const conflict = ['23505', '40001'].includes(error.code);
      const status = error.statusCode || (conflict ? 409 : error.code === 'P0001' ? 409 : 500);
      res.status(status).json({ ok: false, message: status >= 500 ? 'Attendance service unavailable. Contact your administrator.' : conflict ? 'Data changed or file already exists. Preview again before importing.' : error.message });
    }
  };
  router.get('/summary', run(async req => ({ report: await retailAttendanceReport(getClient(), req.profile, req.query) })));
  router.get('/history', run(async req => ({ history: await retailAttendanceHistory(getClient(), req.profile, req.query) })));
  router.get('/employees', run(async req => ({ rows: await retailAttendanceEmployees(getClient(), req.profile, req.query) })));
  router.post('/preview', (req, res, next) => {
    try { attendanceAccess(req.profile, true); next(); } catch (e) { res.status(e.statusCode || 403).json({ ok: false, message: e.message }); }
  }, express.raw({ type: 'application/octet-stream', limit: ATTENDANCE_MAX_FILE_BYTES }), run(async req => {
    let filename;
    try { filename = decodeURIComponent(req.get('x-file-name') || ''); } catch { filename = ''; }
    return { preview: await previewRetailAttendance(getClient(), req.profile, req.body, filename) };
  }));
  router.post('/commit', run(async req => ({ batch_id: await commitRetailAttendance(getClient(), req.profile, req.body || {}) })));
  router.use((error, req, res, next) => {
    if (!error) return next();
    return res.status(error.type === 'entity.too.large' ? 413 : 400).json({ ok: false, message: 'Invalid or oversized upload; maximum 15 MB.' });
  });
  return router;
}
