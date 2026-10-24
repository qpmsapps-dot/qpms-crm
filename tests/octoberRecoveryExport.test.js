import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { octoberRecoveryExportRows } from '../src/utils/octoberRecoveryExport.js';

test('October recovery worksheet round trip preserves twelve columns, single credits, pending exclusion and unknown values', async()=>{
  const approved={id:'credit-1',employee_code:'FIXTURE-FO',employee_name:'Fixture FO',attendance_date:'2026-10-23',status:'approved',original_payable_km:68.31,original_claim_amount:273.24,approved_additional_km:40,resulting_payable_km:108.31,travel_rate:4,additional_amount:160,resulting_claim_amount:433.24,recovery_reason:'Missing End Day',approved_by:'fixture-admin'};
  const pending={...approved,id:'pending-1',attendance_date:'2026-10-24',employee_name:' =HYPERLINK("bad")',status:'pending',original_payable_km:null,original_claim_amount:null};
  const rows=octoberRecoveryExportRows({recovery_adjustments:[approved,approved,pending]});assert.equal(rows.length,2);
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('October KM Recovery');sheet.columns=Object.keys(rows[0]).map(key=>({header:key,key}));sheet.addRows(rows);
  const buffer=await book.xlsx.writeBuffer(),loaded=new ExcelJS.Workbook();await loaded.xlsx.load(buffer);const result=loaded.getWorksheet('October KM Recovery');
  assert.equal(result.columnCount,12);assert.equal(result.rowCount,3);assert.equal(result.getCell('E2').value,40);assert.equal(result.getCell('F2').value,108.31);assert.equal(result.getCell('H2').value,160);assert.equal(result.getCell('I2').value,433.24);assert.equal(result.getCell('E3').value,0);assert.equal(result.getCell('H3').value,0);assert.equal(result.getCell('D3').value,'Unknown');assert.match(result.getCell('B3').value,/^'/);
});
test('two disjoint approved requests make one daily claim without double-counting cumulative snapshots',()=>{
  const first={id:'first',employee_code:'FIXTURE',attendance_date:'2026-10-23',status:'approved',approved_at:'2026-10-24T12:00:02Z',original_payable_km:68.31,original_claim_amount:273.24,approved_additional_km:40,additional_amount:160,travel_rate:4};
  const second={...first,id:'second',approved_at:'2026-10-24T12:00:01Z',original_payable_km:108.31,original_claim_amount:433.24,approved_additional_km:20,additional_amount:80};
  const rows=octoberRecoveryExportRows({recovery_adjustments:[second,first,second,{...second,id:'pending',status:'pending'}]});
  assert.equal(rows.length,1);assert.equal(rows[0]['Existing Payable KM'],68.31);assert.equal(rows[0]['Recovered KM'],60);assert.equal(rows[0]['Final Payable KM'],128.31);assert.equal(rows[0]['Additional Amount'],240);assert.equal(rows[0]['Final Claim Amount'],513.24);
});
