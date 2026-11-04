import test from 'node:test';
import assert from 'node:assert/strict';
import {attendanceTone,attendanceTrendMonthLabel} from '../src/utils/retailAttendanceVisualModel.js';
test('traffic-light thresholds: >=90 green, 85 to <90 yellow, <85 red',()=>{
 for(const n of [90,90.0001,95,100,120])assert.equal(attendanceTone(n),'good');
 for(const n of [85,85.01,89.99])assert.equal(attendanceTone(n),'watch');
 for(const n of [0,70,84.99])assert.equal(attendanceTone(n),'critical');
 for(const n of [null,undefined,NaN])assert.equal(attendanceTone(n),'unavailable');
});
test('daily graph reports the actual selected month instead of hardcoded October',()=>{
 assert.match(attendanceTrendMonthLabel('2026-10-31'),/October 2026/);
 assert.match(attendanceTrendMonthLabel('2026-11-04'),/November 2026/);
});
