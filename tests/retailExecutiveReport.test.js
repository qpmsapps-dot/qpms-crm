import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleMetric, executiveReport, previousPeriod, comparison, sameInventory, reportExceptions, executiveConclusion, scopedActivity } from '../src/utils/retailExecutiveReport.js';

const attendance = { state: 'TN', hk_actual: 8, hk_target: 10, mepc_actual: 2, mepc_target: 2, total_actual: 10, total_target: 12, complete: true };
function report() { return { from: '2026-11-01', to: '2026-11-09', stores: [{ id: 's1', state: 'TN', store_code: 'S1' }, { id: 's2', state: 'PY', store_code: 'S2' }], modules: {
  attendance: { status: 'ready', rows: [attendance, { ...attendance, state: 'PY', hk_actual: 2, hk_target: 2, mepc_actual: 0, mepc_target: 0, total_actual: 2, total_target: 2 }] },
  cleaning: { status: 'ready', rows: [{ state: 'TN', scheduled: 10, completed: 6, pending: 3, not_completed: 1 }] },
  cm: { status: 'ready', rows: [{ state: 'TN', eligible: 10, completed: 8, remaining: 2 }] },
  pm: { status: 'unavailable', reason: 'No authorized PM source' },
  thermography: { status: 'ready', rows: [{ state: 'TN', scheduled: 3, awaiting: 5, approved: 2, overdue: 1 }] },
  soft: { status: 'ready', rows: [{ state: 'TN', completed: 3 }] }, technical: { status: 'ready', rows: [{ state: 'TN', completed: 2 }] },
} }; }
test('attendance weights credits against mandays instead of averaging state percentages', () => {
  assert.equal(moduleMetric(report(), 'attendance').value, 85.7);
  assert.equal(moduleMetric(report(), 'attendance', { state: 'TN' }).value, 85.7);
  const r = report(); r.modules.attendance.rows[1].complete = false;
  assert.equal(moduleMetric(r, 'attendance').value, null);
});
test('missing, empty and zero denominators do not become zero attendance', () => {
  assert.equal(moduleMetric(null, 'attendance').value, null);
  const r = report(); r.modules.attendance.rows = [];
  assert.equal(moduleMetric(r, 'attendance').value, null);
  r.modules.attendance.rows = [{ ...attendance, total_target: 0 }];
  assert.equal(moduleMetric(r, 'attendance').value, null);
  delete r.modules.cleaning.rows[0].completed;
  assert.equal(moduleMetric(r, 'cleaning').value, null);
});
test('Training is an operational count requiring both valid sources, never a completion rate', () => {
  assert.equal(moduleMetric(report(), 'training').value, 5);
  const r = report(); r.modules.soft.rows[0].completed = null;
  assert.equal(moduleMetric(r, 'training').value, null);
  r.modules.soft = { status: 'unavailable' };
  assert.equal(moduleMetric(r, 'training').ready, false);
});
test('Cleaning donut partitions are exclusive, pending never becomes Not Done', () => {
  const m = moduleMetric(report(), 'cleaning');
  assert.equal(m.value, 60);
  assert.equal(m.segments.reduce((n, x) => n + x.value, 0), 10);
  assert.equal(m.counts['Recorded Not Done'], 1);
  const r = report(); r.modules.cleaning.rows[0].pending = 8;
  assert.equal(moduleMetric(r, 'cleaning').segments, null);
});
test('thermography overdue is a subset, not an added inspection total', () => {
  const m = moduleMetric(report(), 'thermography');
  assert.equal(m.value, 2);
  assert.equal(m.counts['Awaiting approval'], 5);
  assert.equal(m.counts['Approval overdue'], 1);
});
test('canonical state mapping consolidates PY into TN and keeps AP partitions separate', () => {
  const m = executiveReport(report(), { state: 'TN' });
  assert.equal(m.stores.length, 2);
  assert.equal(m.states[0].stores, 2);
  assert.equal(moduleMetric(report(), 'training', { state: 'AP-1' }).value, 0);
  assert.equal(moduleMetric(report(), 'training', { store: 's1' }).value, null);
  assert.equal(executiveReport(report(), { store: 'outside' }).stores.length, 0);
});
test('month comparison uses equal elapsed days and rejects shorter previous months', () => {
  assert.deepEqual(previousPeriod('2026-11-01', '2026-11-09'), { from: '2026-10-01', to: '2026-10-09', comparable: true });
  assert.equal(previousPeriod('2026-03-01', '2026-03-31').comparable, false);
  assert.equal(previousPeriod('2024-03-01', '2024-03-29').to, '2024-02-29');
  assert.equal(comparison({ ready: true, value: 91 }, { ready: true, value: 90 }, true), 1);
  assert.equal(comparison({ ready: true, value: 91 }, { ready: true, value: null }, true), null);
});
test('comparable inventory is exact; no hidden widening across months', () => {
  const a = report(), b = report(); assert.equal(sameInventory(a, b), true);
  b.stores.pop(); assert.equal(sameInventory(a, b), false);
  assert.equal(sameInventory(a, null), false);
});
test('conclusions are explicit and positive exceptions do not invent severity or owners', () => {
  const m = executiveReport(report()); const e = reportExceptions(m);
  assert.equal(e.find(r => r.label === 'Deep Cleaning pending').count, 3);
  assert.equal(e.some(r => 'owner' in r || 'severity' in r), false);
  assert.equal(executiveConclusion(m, {}).achievements.length, 0);
  assert.deepEqual(executiveConclusion(m, { training: 2 }).achievements, ['Training']);
  assert.ok(executiveConclusion(m, {}).gaps.includes('PM'));
});
test('historical Excel rows never inflate operational KPIs', () => {
  const r = report(); r.historical_ifms = { rows: [{ state: 'TN', module: 'deep_cleaning', metrics: { completed: 900 } }] };
  assert.equal(executiveReport(r).modules.cleaning.counts.Completed, 6);
});
test('recent records require a unique canonical Store Master identity and matching geography', () => {
  const r = report();
  assert.equal(scopedActivity([{ id: 'a', store: { store_code: 'S1', state: 'TN' } }], r, { state: 'TN' }).length, 1);
  assert.equal(scopedActivity([{ id: 'a', store: { store_code: 'S1', state: 'KL' } }], r).length, 0);
  assert.equal(scopedActivity([{ id: 'a', store: { store_code: 'OUTSIDE', state: 'TN' } }], r).length, 0);
  r.stores.push({ id: 'duplicate', store_code: 'S1', state: 'TN' });
  assert.equal(scopedActivity([{ store: { store_code: 'S1', state: 'TN' } }], r).length, 0);
});

test('later approval is current cohort status, never historical comparison or achievement', async () => {
  const {thermographyReport} = await import('../backend/shared/retailOperations.js');
  const source={today:'2026-11-09',stores:[{id:'s',state:'TN'}],thermography:[{id:'t',retail_store_id:'s',scheduled_date:'2026-10-02',status:'Client Approved',approved_at:'2026-11-02T00:00:00Z'}],events:[]};
  const cohort=thermographyReport(source,'2026-10');
  const r=report();r.modules.thermography.rows=cohort.states;
  const metric=moduleMetric(r,'thermography');
  assert.equal(metric.value,1);assert.equal(metric.comparisonEligible,false);
  assert.match(metric.reason,/not status at the historical cutoff/);
  assert.equal(comparison(metric,{ready:true,value:0},true),null);
  assert.equal(executiveConclusion(executiveReport(r),{thermography:comparison(metric,{ready:true,value:0},true)}).achievements.includes('Thermography'),false);
});
