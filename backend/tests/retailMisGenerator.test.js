import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
test('MIS SQL generator is deterministic on LF and CRLF checkouts and rejects duplicate sections',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'retail-mis-generator-'));
 const files=['scripts/buildRetailMisWorkflowAdapters.mjs','supabase/proposals/retail_operations_workflows.sql','supabase/proposals/retail_fault_tracker_updates.sql','supabase/proposals/retail_cleaning_fo_link.sql','supabase/proposals/retail_service_trackers.sql','supabase/proposals/retail_mis_commands.sql','supabase/migrations_2_0/232_reliance_retail_uploaded_attendance.sql','supabase/migrations/20261102071258_retail_mis_four_roles.sql'];
 const migration=path.join(dir,files.at(-1)),generator=path.join(dir,files[0]);let expected;
 for(const eol of ['\n','\r\n']){
  for(const file of files){fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.writeFileSync(path.join(dir,file),fs.readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n').replaceAll('\n',eol));}
  execFileSync(process.execPath,[generator]);const first=fs.readFileSync(migration,'utf8');execFileSync(process.execPath,[generator]);assert.equal(fs.readFileSync(migration,'utf8'),first);assert.equal(first.match(/BEGIN GENERATED MIS WORKFLOWS/g).length,1);if(expected)assert.equal(first,expected);expected=first;
 }
 fs.appendFileSync(migration,'\n-- BEGIN GENERATED MIS WORKFLOWS\n');assert.throws(()=>execFileSync(process.execPath,[generator],{stdio:'pipe'}),/Expected exactly one generated workflow section/);
});
