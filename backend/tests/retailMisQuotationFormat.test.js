import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import XLSX from 'xlsx';
import {parseQuotation} from '../services/retailQuotationImport.js';
import {MIS_QUOTATION_COLUMNS} from '../shared/retailQuotationFormat.js';
import {retailMisQuotation} from '../services/retailMisService.js';
test('MIS import binds reviewed revisions and all-state authority without bypassing freeze or opt-in',async()=>{
 const calls=[],client={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='rpc_retail_mis_oos_stores'?[store]:name==='rpc_retail_mis_report'?{rows:[{reference:'QPMSTN26270582',revision:4}]}:{saved:true}};}},access={role:'MIS_OOS',states:['TN'],active:true},profile={id:'fixture-actor'},environment={RETAIL_OOS_MUTATIONS_FROZEN:'false',RETAIL_MIS_OOS_WRITES_ENABLED:'true'};
 const source=bytes(fixture()),preview=await retailMisQuotation(client,profile,access,source,'fixture.xlsx',false,environment);
 assert.equal(preview.plan[0].expected_revision,4);assert.equal(preview.original_base64,undefined);
 await assert.rejects(()=>retailMisQuotation(client,profile,access,source,'fixture.xlsx',true,environment),/Review the exact workbook/);
 await retailMisQuotation(client,profile,access,source,'fixture.xlsx',true,environment,preview.plan);assert.equal(calls.at(-1).name,'rpc_retail_mis_oos_import');assert.equal(calls.at(-1).args.p_groups[0].expected_revision,4);assert.equal(calls.at(-1).args.p_actor,'fixture-actor');
 calls.length=0;await assert.rejects(()=>retailMisQuotation(client,profile,access,source,'fixture.xlsx',true,{...environment,RETAIL_OOS_MUTATIONS_FROZEN:'true'},preview.plan),/frozen/);assert.equal(calls.length,0);
 await assert.rejects(()=>retailMisQuotation(client,profile,access,source,'fixture.xlsx',true,{RETAIL_OOS_MUTATIONS_FROZEN:'false'},preview.plan),/separate activation/);assert.equal(calls.length,0);
 await assert.rejects(()=>retailMisQuotation(client,profile,{...access,states:['KL']},source,'fixture.xlsx',false,environment),/Outside assigned/);
});


const store={id:'00000000-0000-4000-8000-000000000001',store_code:'SL81',store_name:'Canonical name remains unchanged',state:'TN',status:'Active'};
const rows=[
 [860,995414,3046287,'Pro&Fix Angle Cock 15mm Cp Brass Agl Vlv',15,857,12855,1156.95,2313.9,15168.9],
 [3350,995462,3047021,'Provide Long Body Pillar Cock-Jaquar-021',6,1339,8034,723.06,1446.12,9480.12],
 [15880,995461,3038451,'Sitc/Laying Fan Exhaust 6 Inch',3,1400,4200,378,756,4956],
 [6590,995462,3047341,'Sup,Inst,15mm Cp Healt Faucet W/Access',3,2430,7290,656.1,1312.2,8602.2],
 [7580,995462,3047385,'P&F Pvc Flush Tank - 10ltr.',1,2031,2031,182.79,365.58,2396.58],
 [11190,995462,3047712,'P&F 450mm Jaguar Braided Hose W/Two Nut',9,290,2610,234.9,469.8,3079.8],
 [10400,998729,3047637,'P&F Pvc Door 750x2100x30mm',5,7000,35000,3150,6300,41300],
 [13040,998729,3005135,'Supply & Fixing Of Exhaust Fan',3,2800,8400,756,1512,9912],
 [9890,995462,3047588,'P&F APR URINAL',1,5026,5026,452.34,904.68,5930.68],
 [9860,995462,3047585,'P&F Apr Washbasin Hindware Mdl 10097',1,4411,4411,396.99,793.98,5204.98],
 [9300,995462,3047530,'P&F Cpvc Ball Valve D20mm 10kg/Cm2',2,331,662,59.58,119.16,781.16],
];
// In-memory fixture of the inspected layout; no quotation workbook is written.
function fixture(){
 const s={};const set=(address,v)=>s[address]={t:typeof v==='number'?'n':'s',v};
 set('A1','QUOTATION');set('K2','Quotation Date: 14-10-2026');set('K3','Quotation No: QPMSTN26270582');set('P2','Store Name : CPC');set('P4','Store Code : SL81');set('A12','Sub');set('C12','DRIVER RESTROOM GENTS & LADIES WORK REQUIRED');
 MIS_QUOTATION_COLUMNS.forEach(([,h],c)=>set(XLSX.utils.encode_cell({r:12,c}),h));
 for(let c=14;c<=20;c++)set(XLSX.utils.encode_cell({r:13,c}),c===15?'In %':'In Rs.');
 rows.forEach(([arc,hsn,article,description,quantity,rate,amount,sgst,gst,total],i)=>{
  const values=[i+1,' ',arc,hsn,article,description,description.toUpperCase(),'Approved source brand','NA',quantity,'EA',rate,amount,0,amount,18,sgst,sgst,null,gst,total,'RC'];
  values.forEach((v,c)=>{if(v!==null)set(XLSX.utils.encode_cell({r:i+14,c}),v);});
 });
 set('F31','Total Amount');for(const [col,v] of Object.entries({M:90519,N:0,O:90519,P:18,Q:8146.71,R:8146.71,T:16293.42,U:106812}))set(col+'31',v);
 set('A32','Total Invoice Amount in Words - ONE LAKH SIX THOUSAND EIGHT HUNDRED AND TWELVE RUPEES ONLY');set('A33','Terms & Conditions if any :');set('A34','1.Payment terms : 30 Days');
 s['!ref']='A1:GE37';s['!merges']=[{s:{r:0,c:0},e:{r:0,c:22}},{s:{r:11,c:2},e:{r:11,c:22}}];
 const b=XLSX.utils.book_new();XLSX.utils.book_append_sheet(b,s,'Sheet1');return b;
}
const bytes=b=>XLSX.write(b,{type:'buffer',bookType:'xlsx'}),parse=b=>parseQuotation(bytes(b),'TN.xlsx',[store]);

test('actual MIS structure extracts every genuine row, all A–V fields, labels and source totals without reformating',()=>{
 const b=fixture(),r=parse(b),g=r.groups[0],h=g.quotation_header;assert.equal(r.can_save,true);assert.deepEqual(r.errors,[]);
 assert.equal(g.quotation_number,'QPMSTN26270582');assert.equal(h.quotation_date,'2026-10-14');assert.equal(h.store_code,'SL81');assert.equal(h.store_name,'CPC');assert.equal(h.subject,'DRIVER RESTROOM GENTS & LADIES WORK REQUIRED');
 assert.equal(g.items.length,11);assert.deepEqual(g.items.map(i=>i.source_row),Array.from({length:11},(_,i)=>i+15));assert.equal(g.store_ids[0],store.id);assert.equal(store.store_name,'Canonical name remains unchanged');
 for(const [i,item] of g.items.entries())for(const [col,[field]] of MIS_QUOTATION_COLUMNS.entries()){
  const source=b.Sheets.Sheet1[XLSX.utils.encode_cell({r:i+14,c:col})]?.v;
  assert.equal(item.raw[MIS_QUOTATION_COLUMNS[col][1]],source??null);
  if(typeof source==='number'&&['quantity','unit_rate','amount','taxable_amount','gst_rate','sgst_ugst_amount','cgst_amount','total_gst','total_amount'].includes(field))assert.equal(item[field],source);
 }
 assert.equal(h.totals.source_row,31);assert.equal(h.totals.total_amount,106812);assert.equal(h.line_sums.total_amount,'106812.42');assert.equal(h.differences.total_amount,'-0.42');assert.equal(r.warnings.length,1);
 assert.equal(g.items[0].quotation_header,h);assert.equal(g.items[1].quotation_header,undefined);assert.ok(!g.items.some(i=>i.description==='Total Amount'));
});

test('real Super Admin TN.xlsx parses directly and original bytes remain intact',{
 skip:!process.env.RETAIL_REAL_QUOTATION_PATH?'Set RETAIL_REAL_QUOTATION_PATH to the supplied source; never substitute generated evidence.':false
},()=>{
 const original=fs.readFileSync(process.env.RETAIL_REAL_QUOTATION_PATH),r=parseQuotation(original,'TN.xlsx',[store]);
 assert.equal(r.can_save,true);assert.equal(r.groups[0].quotation_number,'QPMSTN26270582');assert.equal(r.groups[0].quotation_header.store_code,'SL81');assert.equal(r.groups[0].items.length,11);
 assert.equal(r.groups[0].items[0].quantity,15);assert.equal(r.groups[0].items[0].unit_rate,857);assert.equal(r.groups[0].items[0].sgst_ugst_amount,1156.95);assert.equal(r.groups[0].quotation_header.line_sums.total_amount,'106812.42');
 assert.equal(r.sha256,createHash('sha256').update(original).digest('hex'));assert.ok(Buffer.from(r.original_base64,'base64').equals(original));
 const source=XLSX.read(original,{type:'buffer'}).Sheets.Sheet1;
 for(const item of r.groups[0].items)for(const [col,[,name]] of MIS_QUOTATION_COLUMNS.entries())assert.equal(item.raw[name],source[XLSX.utils.encode_cell({r:item.source_row-1,c:col})]?.v??null);
});

test('quotation identity and dates are read from labeled cells, including separate values',()=>{
 const b=fixture(),s=b.Sheets.Sheet1;delete s.K3;s.H3={t:'s',v:'Quotation Number'};s.I3={t:'s',v:'QPMSTN26270582'};
 s.K2={t:'s',v:'Quotation Date:'};s.L2={t:'n',v:46309}; // Source serial is validated separately below.
 const r=parse(b);assert.equal(r.can_save,true);assert.equal(r.groups[0].quotation_number,'QPMSTN26270582');assert.equal(r.groups[0].quotation_header.source_cells.quotation_number,'I3');
 assert.match(r.groups[0].quotation_header.quotation_date,/^\d{4}-\d{2}-\d{2}$/);
});

test('malformed MIS sources, ambiguous identities and unsupported columns fail closed',()=>{
 const mutations=[s=>delete s.K3,s=>s.K2={t:'s',v:'Quotation Date: 31-02-2026'},s=>s.P4={t:'s',v:'Store Code: UNKNOWN'},s=>s.K6={t:'s',v:'Quotation No: OTHER'},s=>delete s.F31,
  s=>delete s.F15,s=>delete s.J15,s=>s.J15={t:'n',v:-1},s=>s.L15={t:'n',v:857,f:'100+757'},s=>s.Q15={t:'e',v:7},s=>s.L13={t:'s',v:'Unrelated Amount'},s=>s.A16={t:'n',v:1},s=>delete s.A15];
 for(const mutate of mutations){const b=fixture();mutate(b.Sheets.Sheet1);const r=parse(b);assert.equal(r.can_save,false);assert.ok(r.errors.length>0);}
 const b=fixture();XLSX.utils.book_append_sheet(b,structuredClone(b.Sheets.Sheet1),'Another Quote');assert.throws(()=>parse(b),/one MIS quotation/);
 assert.throws(()=>parseQuotation(Buffer.from('not xlsx'),'TN.xlsx',[store]));
 assert.equal(parseQuotation(bytes(fixture()),'TN.xlsx',[store,{...store,id:'duplicate'}]).can_save,false);
 assert.equal(parseQuotation(bytes(fixture()),'TN.xlsx',[{...store,status:'Inactive'}]).can_save,false);
});

