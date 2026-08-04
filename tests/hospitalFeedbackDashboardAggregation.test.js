import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateHospitalFeedbackDashboardRows,
  dashboardDateRange,
} from '../backend/services/hospitalFeedbackQrService.js';

const blockIds = {
  block1: '11111111-1111-4111-8111-111111111111',
  block2: '22222222-2222-4222-8222-222222222222',
  block3: '33333333-3333-4333-8333-333333333333',
  nims: '44444444-4444-4444-8444-444444444444',
};

function row({
  id,
  rating,
  blockId,
  blockName,
  blockSort,
  floorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  floorName = 'Floor 1',
  locationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  locationName = 'Toilet 1',
  hospitalId = '99999999-9999-4999-8999-999999999999',
  parentClientId = '88888888-8888-4888-8888-888888888888',
}) {
  return {
    id,
    rating,
    language: 'en',
    comments: null,
    needs_attention: rating < 4,
    submitted_at: '2026-08-04T05:30:00.000Z',
    parent_client_id: parentClientId,
    hospital_id: hospitalId,
    block_id: blockId,
    floor_id: floorId,
    location_id: locationId,
    parent_client: { client_name: parentClientId ? 'DME' : null },
    hospital: { client_name: hospitalId === 'nims-hospital' ? 'NIMS' : 'RGGH' },
    block: { block_name: blockName, sort_order: blockSort },
    floor: { floor_name: floorName, floor_number: Number(String(floorName).match(/\d+/)?.[0] || 1) },
    location: { location_name: locationName, location_type: 'Toilet' },
  };
}

function dmeRows() {
  return [
    row({ id: 'b1-1', rating: 5, blockId: blockIds.block1, blockName: 'Block 1', blockSort: 1, floorId: 'f1', locationId: 'f1-t1', locationName: 'Toilet 1' }),
    row({ id: 'b1-2', rating: 5, blockId: blockIds.block1, blockName: 'Block 1', blockSort: 1, floorId: 'f1', locationId: 'f1-t1', locationName: 'Toilet 1' }),
    row({ id: 'b1-3', rating: 4, blockId: blockIds.block1, blockName: 'Block 1', blockSort: 1, floorId: 'f2', locationId: 'f2-t1', locationName: 'Toilet 1' }),
    row({ id: 'b2-1', rating: 4, blockId: blockIds.block2, blockName: 'Block 2', blockSort: 2, floorId: 'f3', locationId: 'f3-t1', locationName: 'Toilet 1' }),
    row({ id: 'b2-2', rating: 3, blockId: blockIds.block2, blockName: 'Block 2', blockSort: 2, floorId: 'f3', locationId: 'f3-t2', locationName: 'Toilet 2' }),
    row({ id: 'b2-3', rating: 2, blockId: blockIds.block2, blockName: 'Block 2', blockSort: 2, floorId: 'f4', locationId: 'f4-t1', locationName: 'Toilet 1' }),
    row({ id: 'b3-1', rating: 1, blockId: blockIds.block3, blockName: 'Block 3', blockSort: 3, floorId: 'f5', locationId: 'f5-t1', locationName: 'Toilet 1' }),
    row({ id: 'b3-2', rating: 1, blockId: blockIds.block3, blockName: 'Block 3', blockSort: 3, floorId: 'f5', locationId: 'f5-t2', locationName: 'Toilet 2' }),
  ];
}

test('dashboard aggregation calculates totals averages percentages best and lowest blocks', () => {
  const result = aggregateHospitalFeedbackDashboardRows(dmeRows());
  assert.equal(result.summary.totalResponses, 8);
  assert.equal(result.summary.averageRating, 3.13);
  assert.equal(result.summary.fiveStarCount, 2);
  assert.equal(result.summary.fiveStarPercentage, 25);
  assert.equal(result.summary.belowFourCount, 4);
  assert.equal(result.summary.bestBlock.blockName, 'Block 1');
  assert.equal(result.summary.lowestBlock.blockName, 'Block 3');

  const block1 = result.blockPerformance.find((item) => item.blockName === 'Block 1');
  const block2 = result.blockPerformance.find((item) => item.blockName === 'Block 2');
  const block3 = result.blockPerformance.find((item) => item.blockName === 'Block 3');
  assert.deepEqual(
    {
      total: block1.totalResponses,
      average: block1.averageRating,
      fiveStar: block1.fiveStar,
      belowFour: block1.needsAttention,
      performance: block1.performance,
    },
    { total: 3, average: 4.67, fiveStar: 2, belowFour: 0, performance: 'Excellent' },
  );
  assert.equal(block2.averageRating, 3);
  assert.equal(block2.needsAttention, 2);
  assert.equal(block2.performance, 'Needs Attention');
  assert.equal(block3.averageRating, 1);
  assert.equal(block3.needsAttention, 2);
  assert.equal(block3.performance, 'Critical');
});

test('dashboard aggregation handles zero responses and deterministic ties', () => {
  const empty = aggregateHospitalFeedbackDashboardRows([]);
  assert.equal(empty.summary.totalResponses, 0);
  assert.equal(empty.summary.averageRating, 0);
  assert.equal(empty.summary.fiveStarPercentage, 0);
  assert.equal(empty.summary.bestBlock, null);
  assert.equal(empty.summary.lowestBlock, null);

  const tied = aggregateHospitalFeedbackDashboardRows([
    row({ id: 't1', rating: 4, blockId: 'b10', blockName: 'Block 10', blockSort: 10 }),
    row({ id: 't2', rating: 4, blockId: 'b2', blockName: 'Block 2', blockSort: 2 }),
    row({ id: 't3', rating: 4, blockId: 'b2', blockName: 'Block 2', blockSort: 2 }),
  ]);
  assert.equal(tied.summary.bestBlock.blockName, 'Block 2');
});

test('dashboard aggregation keeps same labels with different IDs separate and drill-down totals consistent', () => {
  const result = aggregateHospitalFeedbackDashboardRows(dmeRows());
  const toiletOnFloor1 = result.locationPerformance.find((item) => item.locationId === 'f1-t1');
  const toiletOnFloor2 = result.locationPerformance.find((item) => item.locationId === 'f2-t1');
  assert.equal(toiletOnFloor1.locationName, 'Toilet 1');
  assert.equal(toiletOnFloor2.locationName, 'Toilet 1');
  assert.notEqual(toiletOnFloor1.locationId, toiletOnFloor2.locationId);

  const blockTotal = result.blockPerformance.reduce((sum, item) => sum + item.totalResponses, 0);
  const floorTotal = result.floorPerformance.reduce((sum, item) => sum + item.totalResponses, 0);
  const locationTotal = result.locationPerformance.reduce((sum, item) => sum + item.totalResponses, 0);
  assert.equal(blockTotal, result.summary.totalResponses);
  assert.equal(floorTotal, result.summary.totalResponses);
  assert.equal(locationTotal, result.summary.totalResponses);
});

test('dashboard aggregation supports scope isolation by caller-filtered rows', () => {
  const rows = [
    ...dmeRows(),
    row({
      id: 'nims-1',
      rating: 5,
      blockId: blockIds.nims,
      blockName: 'NIMS Block',
      blockSort: 1,
      hospitalId: 'nims-hospital',
      parentClientId: null,
    }),
  ];
  const dme = aggregateHospitalFeedbackDashboardRows(rows.filter((item) => item.hospital_id !== 'nims-hospital'));
  const nims = aggregateHospitalFeedbackDashboardRows(rows.filter((item) => item.hospital_id === 'nims-hospital'));
  assert.equal(dme.summary.totalResponses, 8);
  assert.equal(nims.summary.totalResponses, 1);
  assert.equal(nims.blockPerformance[0].blockName, 'NIMS Block');
});

test('dashboard date range validates YYYY-MM-DD and Asia Kolkata exclusive bounds', () => {
  const single = dashboardDateRange({ dateFrom: '2026-08-04', dateTo: '2026-08-04' });
  assert.equal(single.from, '2026-08-03T18:30:00.000Z');
  assert.equal(single.toExclusive, '2026-08-04T18:30:00.000Z');
  assert.ok(new Date(single.from).getTime() <= new Date('2026-08-03T18:30:00.000Z').getTime());
  assert.ok(new Date('2026-08-04T18:30:00.000Z').getTime() >= new Date(single.toExclusive).getTime());

  const month = dashboardDateRange({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });
  assert.equal(month.from, '2026-07-31T18:30:00.000Z');
  assert.equal(month.toExclusive, '2026-08-31T18:30:00.000Z');
  assert.throws(() => dashboardDateRange({ dateFrom: '2026-08', dateTo: '2026-08-04' }), /YYYY-MM-DD/);
  assert.throws(() => dashboardDateRange({ dateFrom: '2026-02-30', dateTo: '2026-03-01' }), /valid calendar/);
  assert.throws(() => dashboardDateRange({ dateFrom: '2026-08-05', dateTo: '2026-08-04' }), /on or before/);
});
