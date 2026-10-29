import express from 'express';
import { provisionalReview, uploadProvisional, proposeProvisional, decideProvisional, withdrawProvisional } from '../services/retailProvisionalService.js';

export function createRetailProvisionalRouter({ getClient }) {
  const router = express.Router();
  const run = handler => async (req, res) => {
    try { res.json({ ok: true, result: await handler(getClient(), req.profile, req.body, req) }); }
    catch (e) {
      const status = e.statusCode || ({ '42501': 403, '40001': 409, '23505': 409, P0001: 409, '22023': 400, '22P02': 400, PGRST202: 503, '42P01': 503 }[e.code]) || 500;
      res.status(status).json({ ok: false, message: status === 503 ? 'Provisional Store Master setup is awaiting authorized installation.' : status >= 500 ? 'Provisional Store Master is unavailable.' : e.message });
    }
  };
  router.get('/', run((c, p) => provisionalReview(c, p)));
  router.post('/upload', express.raw({ type: 'application/octet-stream', limit: '10mb' }), run((c, p, bytes, req) => {
    let filename;
    try { filename = decodeURIComponent(req.get('x-file-name') || ''); }
    catch { throw Object.assign(Error('Invalid filename.'), { statusCode: 400 }); }
    return uploadProvisional(c, p, bytes, filename);
  }));
  router.post('/propose', run(proposeProvisional));
  router.post('/decide', run(decideProvisional));
  router.post('/withdraw', run(withdrawProvisional));
  router.use((e, req, res, next) => {
    if (!e) return next();
    res.status(e.type === 'entity.too.large' ? 413 : 400).json({ ok: false, message: 'Invalid upload. Select an .xlsx file up to 10 MB.' });
  });
  return router;
}
