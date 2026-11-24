import test from 'node:test';
import assert from 'node:assert/strict';
import {hkStoreStates,attachHkAop} from '../services/retailHkStoreMaster.js';
const access={active:true,role:'MIS_HK',states:['TN']};
test('TN includes PY on this read-only Store Master only',()=>{assert.deepEqual(hkStoreStates(access),['PY','TN']);assert.deepEqual(hkStoreStates(access,'TN'),['TN','PY']);assert.deepEqual(hkStoreStates(access,'PY'),['PY']);});
test('rejects other states and inactive or other roles',()=>{for(const [a,s] of [[access,'KA'],[access,['TN','KA']],[{...access,active:false},'TN'],[{...access,role:'MIS_MEPC'},'TN']])assert.throws(()=>hkStoreStates(a,s),{statusCode:403});});
test('preserves zero and pending; excludes MEPC and expired values',()=>{const versions=[{retail_store_id:'a',hk_count:0,effective_from:'2026-01-01'},{retail_store_id:'a',aop_class:'MEPC',hk_count:5,effective_from:'2026-01-01'},{retail_store_id:'b',hk_count:3,effective_from:'2026-01-01',effective_to:'2026-01-31'}];const rows=attachHkAop([{id:'a'},{id:'b'}],versions,'2026-11-24');assert.equal(rows[0].hk_aop,0);assert.equal(rows[0].aop_history.length,1);assert.equal(rows[1].hk_aop,null);});
test('overlapping current versions are flagged instead of double counted',()=>{const v={retail_store_id:'a',hk_count:2,effective_from:'2026-01-01'};assert.equal(attachHkAop([{id:'a'}],[v,v],'2026-11-24')[0].aop_conflict,true);});
