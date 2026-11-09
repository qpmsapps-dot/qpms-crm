import test from 'node:test';
import assert from 'node:assert/strict';
import { trainingOverview, trainingEvidenceState, trainingExportRows } from '../src/utils/trainingView.js';
import { trainingReport } from '../backend/shared/retailTrainingReport.js';
const rows = [{
  id: 'a',
  training_class: 'HK',
  status: 'submitted',
  state: 'TN',
  attendee_count: 8,
  evidence_count: 2,
  topic_count: 1,
  trainer_name: 'Synthetic A',
  ownership: {}
}, {
  id: 'b',
  training_class: 'MEPC',
  status: 'submitted',
  state: 'KA',
  attendee_count: null,
  evidence_count: null,
  ownership: {}
}];
test('optional unknown attendees are not zero coverage', () => {
  const r = trainingOverview(rows);
  assert.equal(r.attendees, 8);
  assert.equal(r.attendeeCoverage, 1);
  assert.equal(r.total, 2);
  assert.equal(r.hk, 1);
  assert.equal(r.mepc, 1);
});
test('only explicitly required absent evidence is missing', () => {
  assert.equal(trainingEvidenceState({
    evidence_count: 0
  }), 'Unknown');
  assert.equal(trainingEvidenceState({
    evidence_count: 0,
    evidence_required: true
  }), 'Missing required');
  assert.equal(trainingEvidenceState({
    evidence_count: 2
  }), 'Available');
});
test('Excel and drafts never inflate verified session KPIs', () => {
  assert.equal(trainingOverview([...rows, {
    ...rows[0],
    id: 'excel',
    source_kind: 'IFMS_EXCEL'
  }, {
    ...rows[0],
    id: 'draft',
    status: 'draft'
  }]).total, 2);
  assert.equal(trainingOverview([]).attendeeCoverage, 0);
});
test('class and state filters remain canonical report semantics', () => {
  const sessions = [{
    id: 'hk',
    category: {
      code: 'hk'
    },
    store: {
      state: 'KA'
    },
    training_date: '2026-11-09'
  }, {
    id: 'mep',
    category: {
      code: 'technical_mep'
    },
    store: {
      state: 'TN'
    },
    training_date: '2026-11-09'
  }];
  assert.deepEqual(trainingReport(sessions, null, {
    class: 'HK',
    state: 'KN'
  }).map(r => r.id), ['hk']);
  assert.equal(trainingReport(sessions, null, {
    fo: 'not-owned'
  }).length, 0);
});
test('export preserves unknown counts, source and historical ownership', () => {
  const r = trainingExportRows([{
    ...rows[1],
    store: {
      store_code: 'S1'
    },
    canonical_store_id: 's',
    ownership: {
      zone_id: 'historical-zone',
      fo_profile_id: 'historical-fo'
    }
  }])[0];
  assert.equal(r[8], null);
  assert.equal(r[10], 'historical-zone');
  assert.equal(r[11], 'historical-fo');
  assert.equal(r[12], 'Operational');
});

test('period endpoint projection leaves missing topic counts unknown, not incomplete', () => {
  const row = {id:'period-row',status:'submitted',training_class:'HK',state:'TN',trainer_name:'Synthetic trainer'};
  const data = trainingOverview([row]);
  assert.equal(data.unknownTopicMetadata, 1); assert.equal(data.missingMetadata, 0); assert.equal(data.attendeeCoverage, 0);
});
test('selected topics never imply covered topics; actual detail counts are authoritative', async () => {
  const {trainingTopics} = await import('../src/utils/trainingView.js');
  assert.deepEqual(trainingTopics({}, {topics:[{is_covered:true},{is_covered:false}],counts:{topics:2,topics_covered:1}}), {selected:2,covered:1,unknown:false,missing:false});
  assert.equal(trainingTopics({topic_count:3}).covered, null);
  assert.equal(trainingTopics({topic_count:0}).missing, true);
  assert.equal(trainingTopics({}).unknown, true);
  assert.equal(trainingTopics({}, {topics:[{}]}).covered, null);
});

test('memoized Training filter matches existing class, state and ownership semantics', async () => {
  const {filterTrainingRows}=await import('../src/utils/trainingView.js');
  const sessions=[{id:'hk',category:{code:'hk'},store:{id:'s',store_code:'S',state:'KA'},training_date:'2026-11-03',status:'submitted'},{id:'mep',category:{code:'technical_mep'},store:{id:'t',store_code:'T',state:'TN'},training_date:'2026-11-03',status:'submitted'}];
  const mapped=trainingReport(sessions,null);
  for(const filter of [{},{state:'KN'},{class:'HK'},{zone:'outside'},{fo:'outside'},{store:'unknown'},{status:'draft'}])assert.deepEqual(filterTrainingRows(mapped,filter),trainingReport(sessions,null,filter));
});
