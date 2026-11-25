// Execute the existing frontend's pure projection/filter/drawer functions.
// No app server, browser credentials, auth bypass or production acceptance claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {RETAIL_FAULT_STAGES} from '../shared/retailFaultWorkflow.js';
import {scopedFaultExportRows} from '../../src/utils/faultTrackerExport.js';

test('existing dashboard, drawer, stage filters and Excel export consume the retained IFMS projection for all 17 stages',()=>{
 const source=fs.readFileSync(new URL('../../src/pages/FaultTracker.jsx',import.meta.url),'utf8');
 const functions=['numberValue','normalizeText','normalizeKey','ticketFromDatabaseRow','createdDateKey','matchesDateRange','matchesSearch','filterTickets','stageMatches','ticketsForStage'];
 const context={crypto:{randomUUID},demoReadOnly:false,ifmsStages:RETAIL_FAULT_STAGES};
 for(const name of ['setEditingTicket','setDraftStage','setDraftRemarks'])context[name]=value=>{context[name+'Value']=value;};
 vm.createContext(context);
 for(const name of functions){
  const code=source.match(new RegExp('function '+name+'\\([^]*?\\n}'))?.[0];assert.ok(code,name);vm.runInContext(code,context);
 }
 const drawer=source.match(/ {2}function openUpdate\([^]*?\n {2}}/)?.[0];assert.ok(drawer);vm.runInContext(drawer,context);
 for(const stage of RETAIL_FAULT_STAGES){
  const row={id:'synthetic',ticket_no:'T-1',stage,remarks:'',source_stage:'IN_PROGRESS',source_remarks:'Excel remark',ageing_days:180,updated_at:'2026-11-25T10:00:00Z',can_update:true,verified_updates:[]};
  const ticket=context.ticketFromDatabaseRow(row);
  assert.equal(ticket.ifmsStage,stage);assert.equal(ticket.status,stage);assert.equal(ticket.remarks,'');assert.equal(ticket.ageingDays,180);
  assert.equal(context.filterTickets([ticket],{ifmsStage:stage}).length,1);
  assert.equal(context.filterTickets([ticket],{ifmsStage:'IN_PROGRESS'}).length,0);
  assert.equal(context.ticketsForStage([ticket],stage).length,1);
  context.openUpdate(ticket);assert.equal(context.setDraftStageValue,stage);assert.equal(context.setDraftRemarksValue,'');
  assert.equal(context.setEditingTicketValue.version,row.updated_at);
  const exported=scopedFaultExportRows([ticket]);assert.equal(exported[1][4],stage);assert.equal(exported[1][10],'');
 }
});
