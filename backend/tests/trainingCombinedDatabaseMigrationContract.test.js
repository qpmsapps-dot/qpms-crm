import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const cleaning=fs.readFileSync(new URL('../../supabase/pending_review/20261106_deep_cleaning_required_document.sql',import.meta.url),'utf8');
const training=fs.readFileSync(new URL('../../supabase/pending_review/202611060001_training_topic_photo_v4.sql',import.meta.url),'utf8');
test('Deep Cleaning fingerprint normalizes CRLF and all edge whitespace, and fails closed on NULL/drift',()=>{
 assert.match(cleaning,/md5\(regexp_replace\(replace\(pg_get_functiondef/);
 assert.ok(cleaning.includes('^[[:space:]]+|[[:space:]]+$'));
 assert.match(cleaning,/is distinct from '4402778bb456360244e1f4dc97a4ad90'/);
 const baseline=fs.readFileSync(new URL('../../artifacts/deep-cleaning-integration/installed-finalizer-baseline.sql',import.meta.url),'utf8');
 const hash=s=>createHash('md5').update(s.replace(/\r/g,'').trim()).digest('hex');
 assert.equal(hash(baseline),'4402778bb456360244e1f4dc97a4ad90');
 assert.equal(hash('\r\n  '+baseline.replace(/\n/g,'\r\n')+' \r\n'),'4402778bb456360244e1f4dc97a4ad90');
});
test('Combined migrations retain service-only mutation grants, RLS, existing rows and canonical terminal statuses',()=>{
 for(const sql of [cleaning,training])assert.doesNotMatch(sql,/disable\s+(?:row level security|trigger)|grant\s+[^;]*on\s+(?:table|all tables)|delete\s+from\s+public\.(?:training_sessions|client_deep_cleaning_schedules|reliance_retail_store_master)/i);
 assert.match(training,/GRANT EXECUTE ON FUNCTION public\.rpc_create_reliance_training_session_v4[\s\S]*?TO service_role/);
 assert.match(cleaning,/Exactly one supporting document required/);
 assert.match(cleaning,/Submitted scheduled evidence is immutable/);
 assert.match(training,/set status = 'submitted'/);
});
