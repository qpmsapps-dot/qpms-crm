import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveRetailLeadershipTrainingScope,applyRetailTrainingStoreScope} from '../services/retailTrainingReadScopeService.js';

const actor={id:'11111111-1111-4111-8111-111111111111',auth_user_id:'22222222-2222-4222-8222-222222222222',
 employee_code:'BRANCH-EXAMPLE',role:'Branch Head',business:'Reliance Retail',state:'TN',
 status:'Active',is_active:true,web_access_enabled:true};
const stores=[
 {id:'retail-tn',store_code:'T100',state:'TN',status:'Active'},
 {id:'retail-py',store_code:'P100',state:'PY',status:'Active'},
 {id:'retail-ka',store_code:'K100',state:'KA',status:'Active'},
];
const legacy=stores.map(s=>({...s,id:'legacy-'+s.id,business:'Reliance Retail'}));
function client(states=['TN','PY'],rpcError=null){
 const called=[];
 return {
  called,
  async rpc(name,args){
    assert.equal(name,'retail_role_states');assert.equal(args.p_actor,actor.id);
    return {data:states,error:rpcError};
  },
  from(table){
    let values=table==='reliance_retail_store_master'?stores:table==='store_master'?legacy:[];
    const query={
      select(){return this;},
      in(field,items){values=values.filter(row=>items.includes(row[field]));return this;},
      eq(field,value){values=values.filter(row=>row[field]===value);return this;},
      order(){return this;},
      async range(from,to){called.push(table);return {data:values.slice(from,to+1),error:null};}
    };
    return query;
  },
 };
}
test('Verified Branch Head Training scope excludes other states and canonical/legacy stores',async()=>{
 const db=client();
 const scope=await resolveRetailLeadershipTrainingScope(db,actor);
 assert.deepEqual(scope.retailStoreIds,['retail-tn','retail-py']);
 assert.deepEqual(scope.legacyStoreIds,['legacy-retail-tn','legacy-retail-py']);
 assert.equal(scope.retailStoreIds.includes('retail-ka'),false);
 let orArgument='',statesArgument;
 const query={or(argument){orArgument=argument;return this;},
  in(field,items){if(field==='state_snapshot')statesArgument=items;return this;},
  eq(){return this;}};
 applyRetailTrainingStoreScope(query,scope);
 assert.ok(orArgument.includes('retail-tn'));
 assert.ok(!orArgument.includes('retail-ka'));
 assert.ok(!orArgument.includes('legacy-retail-ka'));
 assert.ok(!statesArgument.includes('KA'));
 assert.ok(db.called.includes('store_master'));
});
test('Verified South Head Training scope covers five regional states plus PY and both AP scopes',async()=>{
 const south={...actor,role:'South Head',state:'TN'};
 const scope=await resolveRetailLeadershipTrainingScope(client(['TN','PY','KA','KL','TG','AP-1','AP-2']),south);
 assert.deepEqual(scope.retailStoreIds,['retail-tn','retail-py','retail-ka']);
});
test('Unassigned or failed Retail role-state lookup denies Training before sessions are read',async()=>{
 await assert.rejects(()=>resolveRetailLeadershipTrainingScope(client([]),actor),e=>e.statusCode===403);
 await assert.rejects(()=>resolveRetailLeadershipTrainingScope(client(['UNKNOWN']),actor),e=>e.statusCode===403);
 await assert.rejects(()=>resolveRetailLeadershipTrainingScope(client([],new Error('unavailable')),actor),e=>e.statusCode===503);
 const unrelated={...actor,business:'Other Business'};
 assert.equal(await resolveRetailLeadershipTrainingScope(client(),unrelated),null);
});
