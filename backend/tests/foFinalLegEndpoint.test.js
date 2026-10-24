import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFinalLegEndpoint } from '../services/foFinalLegEndpointService.js';
const end = new Date('2026-10-23T12:49:54.345Z');
const point = (overrides={}) => ({latitude:12.9,longitude:80.1,accuracy:10,source:'mobile',capturedAt:new Date(end-30000),...overrides});
test('final endpoint retains recorded checkout and timestamp over GPS',()=>{
 const recorded={latitude:12.8,longitude:80.2};const result=resolveFinalLegEndpoint(recorded,end,[point()]);
 assert.equal(result.coordinate,recorded);assert.equal(result.recovered,false);assert.equal(result.observed_at,end.toISOString());
});
test('missing endpoint recovers nearest quality-filtered mobile observation with provenance',()=>{
 const result=resolveFinalLegEndpoint(null,end,[point({capturedAt:new Date(end-60000)}),point()]);
 assert.equal(result.recovered,true);assert.equal(result.observed_at,new Date(end-30000).toISOString());assert.equal(result.boundary_at,end.toISOString());
});
test('23 October stale checkout GPS is not an End Day endpoint',()=>{
 const result=resolveFinalLegEndpoint(null,end,[point({capturedAt:new Date('2026-10-23T11:41:33.325Z')})]);
 assert.equal(result.coordinate,null);assert.equal(result.source,'insufficient_endpoint_evidence');
});
for(const [name,overrides] of Object.entries({poor_accuracy:{accuracy:100},unknown_accuracy:{accuracy:null},non_mobile:{source:'synthetic'},invalid_coordinate:{latitude:NaN},zero_coordinate:{latitude:0,longitude:0},stale:{capturedAt:new Date(end-120001)}}))test('rejects '+name,()=>assert.equal(resolveFinalLegEndpoint(null,end,[point(overrides)]).coordinate,null));
test('both absent endpoints remain unknown, repeated recovery does not mutate input',()=>{
 const points=[point()];const before=JSON.stringify(points);assert.deepEqual(resolveFinalLegEndpoint(null,end,points),resolveFinalLegEndpoint(null,end,points));assert.equal(JSON.stringify(points),before);assert.equal(resolveFinalLegEndpoint(null,end,[]).coordinate,null);
});
