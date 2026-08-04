import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  checklistRowsFromResponses,
  commentExcerpt,
  ratingDistributionFromBlocks,
  reportMetrics,
  respondentName,
} from '../src/utils/hospitalFeedbackReport.js';

const dashboardPage = await readFile(new URL('../src/pages/HospitalFeedbackDashboard.jsx', import.meta.url), 'utf8');

test('Soft Services Feedback Report title tabs and export control are present', () => {
  assert.match(dashboardPage, /Soft Services Feedback Report/);
  assert.match(dashboardPage, /Consolidated public feedback insights including ratings, names, comments and checklist responses\./);
  for (const tab of ['Overview', 'Floor-wise Report', 'Location-wise Report', 'Comments & Names', 'Checklist Summary']) {
    assert.match(dashboardPage, new RegExp(tab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(dashboardPage, /window\.print\(\)/);
  assert.match(dashboardPage, /Export PDF/);
});

test('Soft Services Feedback Report contains the required KPI cards and no fake ticket status', () => {
  for (const label of ['Total Feedback', 'Average Rating', 'Five-Star %', 'Needs Attention', 'Named Responses', 'Checklist Completion Rate']) {
    assert.match(dashboardPage, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(dashboardPage, /'Open'|"Open"|'In Progress'|"In Progress"|ticket_number|ticketNumber|createHospitalTicket/);
});

test('report metrics calculate named responses and checklist completion from real response data', () => {
  const metrics = reportMetrics({
    summary: { totalResponses: 4, averageRating: 4.25, fiveStarPercentage: 50, fiveStarCount: 2, belowFourCount: 1 },
    recentFeedback: [
      { id: '1', respondentName: 'Lakshmi', answers: { toilet_cleanliness: 'yes' } },
      { id: '2', answers: { water_available: 'no' } },
      { id: '3', name: 'Ravi', answers: {} },
    ],
    recentNeedsAttention: [
      { id: '4', answers: null },
    ],
  });
  assert.equal(metrics.namedCount, 2);
  assert.equal(metrics.namedPercentage, 50);
  assert.equal(metrics.checklistAnswered, 2);
  assert.equal(metrics.checklistCompletion, 50);
});

test('anonymous names and safe comment excerpts are rendered without HTML interpretation', () => {
  assert.equal(respondentName({}), 'Anonymous');
  assert.equal(respondentName({ answers: { name: '  Anita  ' } }), 'Anita');
  assert.equal(commentExcerpt('<img src=x onerror=alert(1)> Clean area', 20), '<img src=x onerror=...');
});

test('checklist statistics use only known checklist answer values', () => {
  const rows = checklistRowsFromResponses([
    { answers: { toilet_cleanliness: 'yes', random_text: 'sometimes maybe' } },
    { answers: { toilet_cleanliness: 'no' } },
    { answers: { soap_available: true } },
    { answers: null },
  ]);
  const cleanliness = rows.find((row) => row.key === 'toilet_cleanliness');
  assert.equal(cleanliness.answered, 2);
  assert.equal(cleanliness.positive, 1);
  assert.equal(cleanliness.negative, 1);
  assert.equal(cleanliness.percentage, 50);
  assert.equal(rows.some((row) => row.key === 'random_text'), false);
});

test('rating distribution and needs attention contracts are report-ready', () => {
  const distribution = ratingDistributionFromBlocks([
    { fiveStar: 2, fourStar: 1, threeStar: 1, twoStar: 0, oneStar: 1 },
  ]);
  assert.deepEqual(distribution.map((row) => row.count), [2, 1, 1, 0, 1]);
  assert.match(dashboardPage, /Number\(row\.rating\) < 4/);
  assert.match(dashboardPage, /Grouped by stable floor ID/);
  assert.match(dashboardPage, /Grouped by stable location ID/);
});

test('zero data and single-day trend states avoid fake values', () => {
  assert.match(dashboardPage, /No feedback for selected period/);
  assert.match(dashboardPage, /trend\?\.length === 1/);
  assert.match(dashboardPage, /No production checklist percentages have been invented/);
});
