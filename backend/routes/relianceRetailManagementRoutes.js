import express from 'express';
import {createRetailServiceTrackerRouter} from './retailServiceTrackerRoutes.js';
import { createRetailUnifiedRouter } from './retailUnifiedRoutes.js';
import { createRetailProvisionalRouter } from './retailProvisionalRoutes.js';
import { createRetailAttendanceRouter } from './retailAttendanceRoutes.js';
import { createRetailStoreImportRouter } from './retailStoreImportRoutes.js';
import {
  assertRetailAccess,
  assignZoneFo,
  createRetailDeepCleaningSchedule,
  listRetailStores,
  listRetailDeepCleaningRecords,
  listRetailDeepCleaningSchedules,
  listRetailZones,
  moveRetailStore,
  retailAccess,
  retailDashboard,
  saveManpowerBudget,
  saveRetailStore,
  saveRetailZone,
  syncFoZones,
  updateRetailDeepCleaningSchedule,
} from '../services/relianceRetailManagementService.js';

function sendError(response, error) {
  const status = Number(error?.statusCode || (error?.code === '23505' ? 409 : 500));
  response.status(status).json({ ok: false, code: error?.code || 'retail_management_failed', message: status >= 500 ? 'Reliance Retail request failed.' : error.message });
}

export function createRelianceRetailManagementRouter({ requireAuth, getClient }) {
  const router = express.Router();
  router.use(requireAuth);
  router.use('/service-trackers',createRetailServiceTrackerRouter({getClient}));
  router.use('/unified-master', createRetailUnifiedRouter({ getClient }));
  router.use('/provisional-stores', createRetailProvisionalRouter({ getClient }));
  router.use('/store-import', createRetailStoreImportRouter({ getClient }));
  router.use('/attendance', createRetailAttendanceRouter({ getClient }));
  // Legacy direct Store/Zone writes are replaced by the independently reviewed workflow.
  let unifiedInstalled=false;
  router.use(async(req,res,next) => {
    if (!/^\/(stores|zones|fos|history)(\/|$)/.test(req.path)) return next();
    if (!unifiedInstalled) {
      const {error}=await getClient().rpc('rpc_retail_unified_capability');
      if (error?.code==='PGRST202') return next(); // Existing behavior until authorized installation.
      if (error) return res.status(503).json({ok:false,message:'Store Master authorization check is unavailable.'});
      unifiedInstalled=true;
    }
    if (req.method !== 'GET') return res.status(409).json({ok:false,message:'Use Unified Management proposals and independent approval for Store, Zone, FO and AOP changes.'});
    const role=String(req.profile?.role||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    if (!['ADMIN','QPMSADMIN','SUPERADMIN'].includes(role)) return res.status(403).json({ok:false,message:'Use the state-scoped Unified Management view.'});
    return next();
  });
  router.get('/access', (req, res) => res.json({ ok: true, access: retailAccess(req.profile) }));
  router.get('/dashboard', async (req, res) => { try { res.json({ ok: true, dashboard: await retailDashboard(getClient(), req.profile, req.query) }); } catch (e) { sendError(res, e); } });
  router.get('/deep-cleaning/records', async (req, res) => { try { res.json({ ok: true, ...(await listRetailDeepCleaningRecords(getClient(), req.profile)) }); } catch (e) { sendError(res, e); } });
  router.get('/deep-cleaning/schedules', async (req, res) => { try { res.json({ ok: true, ...(await listRetailDeepCleaningSchedules(getClient(), req.profile, req.query)) }); } catch (e) { sendError(res, e); } });
  router.post('/deep-cleaning/schedules', async (req, res) => { try { res.status(201).json({ ok: true, schedule: await createRetailDeepCleaningSchedule(getClient(), req.profile, req.body) }); } catch (e) { sendError(res, e); } });
  router.patch('/deep-cleaning/schedules/:id', async (req, res) => { try { res.json({ ok: true, schedule: await updateRetailDeepCleaningSchedule(getClient(), req.profile, req.params.id, req.body) }); } catch (e) { sendError(res, e); } });
  router.get('/stores', async (req, res) => { try { res.json({ ok: true, ...(await listRetailStores(getClient(), req.profile, req.query)) }); } catch (e) { sendError(res, e); } });
  router.post('/stores', async (req, res) => { try { res.status(201).json({ ok: true, store: await saveRetailStore(getClient(), req.profile, req.body) }); } catch (e) { sendError(res, e); } });
  router.patch('/stores/:id', async (req, res) => { try { res.json({ ok: true, store: await saveRetailStore(getClient(), req.profile, { ...req.body, id: req.params.id }) }); } catch (e) { sendError(res, e); } });
  router.post('/stores/:id/zone', async (req, res) => { try { res.json({ ok: true, store: await moveRetailStore(getClient(), req.profile, req.params.id, req.body?.zone_id, req.body?.reason) }); } catch (e) { sendError(res, e); } });
  router.put('/stores/:id/manpower', async (req, res) => { try { res.json({ ok: true, budget: await saveManpowerBudget(getClient(), req.profile, req.params.id, req.body) }); } catch (e) { sendError(res, e); } });
  router.get('/zones', async (req, res) => { try { res.json({ ok: true, zones: await listRetailZones(getClient(), req.profile, { includeInactive: req.query.include_inactive === 'true' }) }); } catch (e) { sendError(res, e); } });
  router.post('/zones', async (req, res) => { try { res.status(201).json({ ok: true, zone: await saveRetailZone(getClient(), req.profile, req.body) }); } catch (e) { sendError(res, e); } });
  router.patch('/zones/:id', async (req, res) => { try { res.json({ ok: true, zone: await saveRetailZone(getClient(), req.profile, { ...req.body, id: req.params.id }) }); } catch (e) { sendError(res, e); } });
  router.put('/zones/:id/fo', async (req, res) => { try { res.json({ ok: true, assignment: await assignZoneFo(getClient(), req.profile, req.params.id, req.body?.fo_profile_id, req.body?.effective_from) }); } catch (e) { sendError(res, e); } });
  router.put('/fos/:profileId/zones', async (req, res) => { try { res.json({ ok: true, mapping: await syncFoZones(getClient(), req.profile, req.params.profileId, req.body?.zone_ids) }); } catch (e) { sendError(res, e); } });
  router.get('/fos', async (req, res) => {
    try {
      assertRetailAccess(req.profile, 'zones');
      const { data, error } = await getClient().from('profiles').select('id,employee_code,full_name,role,designation,state,status,is_active').eq('is_active', true).in('business', ['Reliance Retail', 'Reliance']).order('full_name').limit(200);
      if (error) throw error;
      res.json({ ok: true, employees: (data || []).filter((row) => ['FO', 'FIELDOFFICER'].includes(String(row.role || '').toUpperCase().replace(/[^A-Z0-9]+/g, ''))) });
    } catch (e) { sendError(res, e); }
  });
  router.get('/history', async (req, res) => {
    try {
      assertRetailAccess(req.profile, 'zones');
      const client = getClient();
      const [zone, store, audit] = await Promise.all([
        client.from('reliance_retail_zone_fo_assignments').select('*').order('effective_from', { ascending: false }).limit(200),
        client.from('reliance_retail_store_zone_history').select('*').order('changed_at', { ascending: false }).limit(200),
        client.from('reliance_retail_management_audit').select('*').order('created_at', { ascending: false }).limit(200),
      ]);
      if (zone.error || store.error || audit.error) throw zone.error || store.error || audit.error;
      res.json({ ok: true, zone_assignments: zone.data, store_assignments: store.data, audit: audit.data });
    } catch (e) { sendError(res, e); }
  });
  return router;
}
