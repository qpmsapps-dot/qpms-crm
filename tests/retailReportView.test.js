import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesReportQuery,reportPage} from '../src/utils/retailReportView.js';

test('report search preserves canonical codes and accepts missing optional details',()=>{
 assert.equal(matchesReportQuery(['SL81',null,'Trainer'], ' sl81 '),true);
 assert.equal(matchesReportQuery(['SL81',null], 'other'),false);
 assert.equal(matchesReportQuery([null,undefined],''),true);
});
test('large report pagination neither truncates source rows nor loses the final page',()=>{
 const rows=Array.from({length:251},(_,id)=>({id}));
 assert.equal(reportPage(rows,0,25).length,25);
 assert.equal(reportPage(rows,10,25)[0].id,250);
 assert.deepEqual(reportPage(rows,100,25),[{id:250}]);
 assert.deepEqual(reportPage([],3,25),[]);
 assert.equal(rows.length,251);
});
