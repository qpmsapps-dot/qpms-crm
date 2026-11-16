import assert from 'node:assert/strict';
import test from 'node:test';
import { cleaningCommand } from '../services/deepCleaningIndependentContract.js';

for (const [message, expected] of [
  ['Active authenticated Retail FO required', 'inactive_or_unauthorized_actor'],
  ['Authorized unique active canonical store required', 'store_state_forbidden'],
  ['Effective TN zone assignment required', 'store_zone_forbidden'],
  ['Owned submission required', 'not_submission_owner'],
]) {
  test(`RPC authorization distinguishes ${expected} without claiming an upload happened`, async () => {
    const client = { rpc: async () => ({ error: { code: '42501', message } }) };
    await assert.rejects(cleaningCommand(client, {id:'actor',auth_user_id:'auth'}, 'begin', {}),
      error => error.statusCode === 403 && error.code === expected && !error.message.includes('success'));
  });
}
test('unrecognized database errors do not leak internal SQL or private details',async()=>{
  const client={rpc:async()=>({error:{code:'42501',message:'private internal diagnostic'}})};
  await assert.rejects(cleaningCommand(client,{id:'actor',auth_user_id:'auth'},'begin',{}),
    error=>error.code==='store_not_authorized'&&!error.message.includes('private'));
});
