import test from 'node:test';
import assert from 'node:assert/strict';
import {indiaDate,validDate,daysSince,timestampDate,ageBand,registerRows,filterRegister,sortRegister,matrix,OOS12} from '../src/pages/reliance-retail/retailOosModel.js';
import {buildOosExport} from '../src/utils/retailOosExport.js';
import {oosMoney,sumDecimals} from '../src/utils/oosDecimal.js';
const store={id:'store-1',store_code:'0012',store_name:'Canonical store',state:'TN'};
const fixture=(override={})=>({id:'q-1',reference:'000123',workflow_version:1,status:'QUOTED',store_ids:[store.id],mapped_stores:[store],original_items:[{total_amount:123.45,quotation_header:{quotation_date:'2026-10-20',totals:{total_amount:123.45}}}],original_po_date:null,status_entered_at:'2026-10-25T18:31:00Z',details:{items:[{store_id:store.id,description:'Line',quantity:1,unit_rate:999,total_amount:999,quotation_header:{quotation_date:'2026-11-01'}}]},updated_at:'2026-11-02T00:00:00Z',...override});
test('India calendar boundaries, leap dates and missing/future dates',()=>{
 assert.equal(indiaDate(new Date('2026-11-01T18:29:59Z')),'2026-11-01');assert.equal(indiaDate(new Date('2026-11-01T18:30:00Z')),'2026-11-02');
 assert.equal(timestampDate('2026-11-01T18:30:00Z'),'2026-11-02');assert.equal(timestampDate('2026-11-01T18:30:00'),null);
 assert.equal(validDate('2026-02-29'),null);assert.equal(validDate('2024-02-29'),'2024-02-29');assert.equal(daysSince('2024-02-28','2024-03-01'),2);assert.equal(daysSince('2026-11-03','2026-11-02'),null);assert.equal(daysSince(null),null);
});
test('original quotation business date and amount survive rework, updated_at never resets ageing',()=>{
 const [r]=registerRows({rows:[fixture()]},'2026-11-02');assert.equal(r.quotation_date,'2026-10-20');assert.equal(r.quotation_age,13);assert.equal(r.status_age,7);assert.equal(r.amount,123.45);assert.equal(r.po_age,null);
 const [edited]=registerRows({rows:[fixture({updated_at:'2026-11-02T12:00:00Z',rework_count:9})]},'2026-11-02');assert.equal(edited.quotation_age,r.quotation_age);assert.equal(edited.status_age,r.status_age);
});
test('source financial decimals survive presentation and Excel without binary rounding',async()=>{
 const exact='9007199254740993.01';const rows=registerRows({rows:[fixture({original_items:[{total_amount:exact,quotation_header:{totals:{total_amount:exact},quotation_date:'2026-10-01'}}]})]},'2026-11-02');assert.equal(rows[0].amount,exact);assert.match(oosMoney(exact),/993\.01/);assert.equal(sumDecimals(['0.10','0.20']),'0.30');
 const book=await buildOosExport(rows,{},['TN']);assert.equal(book.getWorksheet('Quotation register').getCell('G2').value,exact);
});
test('PO receipt uses original audit business date; current details cannot reset it',()=>{
 const [r]=registerRows({rows:[fixture({original_po_date:'2026-10-28',original_po_number:'000PO',details:{po_number:'NEW',po_date:'2026-11-02'}})]},'2026-11-02');assert.equal(r.po_age,5);assert.equal(r.po_number,'000PO');
});
test('missing business and audit dates never use upload/update timestamps',()=>{
 const [r]=registerRows({rows:[fixture({original_items:null,status_entered_at:null,created_at:'2026-11-01T00:00:00Z'})]},'2026-11-02');assert.equal(r.quotation_age,null);assert.equal(r.status_age,null);assert.equal(r.amount,null);assert.ok(r.warnings.some(w=>w.includes('not substituted')));
});
test('canonical stores determine state; cross-state or incomplete mapping is an explicit exception',()=>{
 const [good,multi,incomplete]=registerRows({rows:[fixture(),fixture({id:'q2',mapped_stores:[store,{...store,id:'s2',state:'KA'}],store_ids:[store.id,'s2']}),fixture({id:'q3',store_ids:[store.id,'missing']})]},'2026-11-02');assert.equal(good.state,'TN');assert.equal(multi.state,null);assert.equal(incomplete.state,null);
});
test('month/date/search/age filters and all ageing sorts apply before pagination',()=>{
 const rows=registerRows({rows:[fixture(),fixture({id:'q2',reference:'B',original_items:[{total_amount:0,quotation_header:{quotation_date:'2026-11-01'}}]}),fixture({id:'q3',original_items:null})]},'2026-11-02');
 assert.equal(filterRegister(rows,{month:'2026-10'}).length,1);assert.equal(filterRegister(rows,{from:'2026-10-21',to:'2026-11-02'}).length,1);assert.equal(filterRegister(rows,{search:'0012'}).length,3);
 assert.equal(filterRegister(rows,{ageField:'quotation_age',age:'orange'}).length,1);assert.equal(filterRegister(rows,{ageField:'quotation_age',age:'unknown'}).length,1);
 assert.equal(sortRegister(rows,'quotation_age','asc')[0].id,'q2');assert.equal(sortRegister(rows,'quotation_age','desc').at(-1).id,'q3');
 assert.deepEqual([0,3,4,7,8,15,16,null].map(ageBand),['green','green','amber','amber','orange','orange','red','unknown']);
});
test('matrix counts quotation IDs once, not item/store joins, respects states, excludes retirement',()=>{
 const r=fixture({workflow_version:2,status:OOS12[0][0]});const rows=registerRows({rows:[r,r,fixture({id:'q2',workflow_version:2,status:OOS12[0][0],mapped_stores:[{...store,state:'KA'}]}),fixture({id:'q3',workflow_version:2,status:OOS12[0][0],retired:true})]},'2026-11-03');
 const m=matrix(rows,['TN']);assert.equal(m.cells[0].states.TN.count,1);assert.equal(m.cells[0].states.TN.max,8);assert.equal(m.cells[0].states.TN.overdue,1);assert.equal(m.cells[0].states.KA,undefined);
});
test('complete large register Excel preserves text, filters, unknown dates and neutralizes formulas',async()=>{
 const rows=registerRows({rows:Array.from({length:2101},(_,i)=>fixture({id:'q-'+i,reference:i===0?'=HYPERLINK("x")':'000'+i,original_po_number:'000PO',mapped_stores:[{...store,store_code:i===0?' @ATTACK':'0012'}]}))},'2026-11-02');
 const book=await buildOosExport(rows,{month:'2026-10'},['TN'],new Date('2026-11-02T01:00:00Z'));
 const bytes=await book.xlsx.writeBuffer();const {default:ExcelJS}=await import('exceljs'),roundtrip=new ExcelJS.Workbook();await roundtrip.xlsx.load(bytes);
 const sheet=roundtrip.getWorksheet('Quotation register');assert.equal(sheet.rowCount,2102);assert.equal(sheet.getCell('B2').type,3);assert.ok(sheet.getCell('B2').value.startsWith("'="));assert.equal(sheet.getCell('B3').value,'0001');assert.equal(sheet.getCell('H3').value,'000PO');assert.equal(sheet.getCell('K2').value,null);assert.ok(sheet.getCell('E2').value.startsWith("'"));
 assert.equal(roundtrip.getWorksheet('Line items').rowCount,2102);assert.ok(roundtrip.getWorksheet('Export information').getCell('B5').value.includes('2026-10'));assert.ok(roundtrip.getWorksheet('Status ageing summary'));
});
