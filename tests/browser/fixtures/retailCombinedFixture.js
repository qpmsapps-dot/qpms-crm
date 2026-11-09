import { seed, fixture } from './retailExecutiveFixture.js';
import { maintenanceReport } from '../../../backend/shared/retailOperations.js';

export async function seedCombined(page, options = {}) {
  const requests = await seed(page, options);
  const stores = fixture('2026-11-01', '2026-11-09').stores;
  await page.route('**/api/reliance-retail/module-reports/training*', async route => {
    const u = new URL(route.request().url()), from = u.searchParams.get('from'), to = u.searchParams.get('to');
    requests.push({ path: u.pathname, params: Object.fromEntries(u.searchParams) });
    if (options.delayTraining && from?.startsWith('2026-10')) await new Promise(r => setTimeout(r, 250));
    const rows = options.empty ? [] : [{ id: 'training-contract', category: { code: 'hk' }, store: stores[0], canonical_store_id: stores[0].id, state: 'TN', training_date: from?.slice(0, 7) + '-03', status: 'submitted', trainer_name: 'Synthetic trainer', submitted_at: from?.slice(0, 7) + '-03T10:00:00Z' }];
    await route.fulfill({ json: { report: options.malformed ? {} : { from, to, complete: true, rows } } });
  });
  await page.route('**/api/reliance-retail/unified-master*', route => route.fulfill({ json: { result: { stores, zones: [{ id: 'zone-1', zone_name: 'Synthetic zone' }], fos: [], assignments: [], store_zone_history: [], epoch_at: '2026-01-01', permissions: [], admin: false, aop: [], attendance: [], proposals: [], saved_rows: [], source_rows: [], provisional: [], saved_store_rows: [] } } }));
  await page.route('**/api/reliance-retail/module-reports/ifms-history*', route => {
    requests.push({ path: new URL(route.request().url()).pathname });
    return route.fulfill({ json: { report: { rows: [], total: 0 } } });
  });
  await page.route('**/api/training/sessions/training-contract*', route => {
    if (route.request().url().includes('/view-url')) return route.fallback();
    return route.fulfill({ json: { session: { id: 'training-contract', status: 'submitted', training_date: '2026-11-03', trainer_name_snapshot: 'Synthetic trainer', created_at: '2026-11-03T09:00:00Z', submitted_at: '2026-11-03T10:00:00Z' }, counts: { topics: 2, topics_covered: 1, attendees: 0, evidence: 2 }, topics: [{ id: 't1', is_covered: true, topic: { module_name: 'Covered synthetic topic' } }, { id: 't2', is_covered: false, topic: { module_name: 'Selected synthetic topic' } }], attendees: [], evidence: [{ id: 'e1', file_name: 'Synthetic topic photo', mime_type: 'image/jpeg', evidence_type: 'topic_photo' }, { id: 'e2', file_name: 'Synthetic group photo', mime_type: 'image/jpeg', evidence_type: 'group_photo' }], events: [] } });
  });
  await page.route('**/api/reliance-retail/operations/maintenance*', route => {
    const u = new URL(route.request().url()), month = u.searchParams.get('month');
    requests.push({ path: u.pathname, params: Object.fromEntries(u.searchParams) });
    const result = maintenanceReport({ stores, calls: [], events: [], today: '2026-11-09' }, month, { state: u.searchParams.get('state'), store: u.searchParams.get('store') });
    return route.fulfill({ json: { result } });
  });
  return requests;
}
