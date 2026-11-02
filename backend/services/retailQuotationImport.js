import XLSX from 'xlsx';
import {createHash} from 'node:crypto';
import {validateExcelContainer} from './retailAttendanceService.js';
import {storeKey} from '../shared/retailAttendance.js';
import {MIS_QUOTATION_COLUMNS,MIS_QUOTATION_NUMERIC_FIELDS} from '../shared/retailQuotationFormat.js';
export const QUOTATION_HEADERS=['Quotation Number','Store Code','Description','Quantity','Unit Rate'];
export function parseQuotation(bytes,filename,stores){
 validateExcelContainer(bytes,filename);const book=XLSX.read(bytes,{type:'buffer',cellFormula:true,cellNF:true});
 if(book.Sheets.Quotation?.A1?.v===QUOTATION_HEADERS[0])return parseLegacyQuotation(bytes,filename,book,stores);
 const candidates=book.SheetNames.filter(name=>Object.entries(book.Sheets[name]).some(([a,c])=>!a.startsWith('!')&&/^\s*(?:Quotation\s*(?:Number|No\.?|Date)|Store\s*Code)\s*(?::|$)/i.test(String(c.v??''))));
 if(candidates.length>1)throw Error('Upload one MIS quotation per workbook. Multiple quotation sheets found.');
 if(candidates.length===1)return parseMisQuotation(bytes,filename,book.Sheets[candidates[0]],candidates[0],stores);
 return parseLegacyQuotation(bytes,filename,book,stores);
}
function parseLegacyQuotation(bytes,filename,book,stores){
 const sheet=book.Sheets['Quotation'];if(!sheet?.['!ref'])throw Error('Supported MIS quotation labels or the existing Quotation sheet are required.');
 const range=XLSX.utils.decode_range(sheet['!ref']);if(range.e.r>10000||range.e.c>40)throw Error('Quotation exceeds supported limits.');
 const grid=XLSX.utils.sheet_to_json(sheet,{header:1,defval:''}),headers=grid[0];for(const h of QUOTATION_HEADERS)if(headers.filter(v=>v===h).length!==1)throw Error(`One ${h} column is required.`);
 const groups=new Map(),errors=[];for(let r=1;r<grid.length;r++){
  if(!grid[r].some(v=>String(v).trim()))continue;
  const raw=Object.fromEntries(headers.map((h,i)=>[h,grid[r][i]??''])),row={source_row:r+1,raw},issue=[];
  for(let c=0;c<headers.length;c++)if(sheet[XLSX.utils.encode_cell({r,c})]?.f||sheet[XLSX.utils.encode_cell({r,c})]?.t==='e')issue.push('Formula/error cell');
  const number=String(raw['Quotation Number']).trim(),code=storeKey(raw['Store Code']),candidates=stores.filter(s=>storeKey(s.store_code)===code&&s.status==='Active');
  const quantity=Number(raw.Quantity),rate=Number(raw['Unit Rate']);if(!number||!String(raw.Description).trim())issue.push('Quotation number and description required');
  if(candidates.length!==1)issue.push('One active verified canonical store required');
  if(raw.Quantity===''||raw['Unit Rate']===''||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(rate)||rate<0)issue.push('Valid quantity and unit rate required');
  if(issue.length){errors.push({...row,issues:issue});continue;}
  const store=candidates[0],key=number;const group=groups.get(key)||{quotation_number:number,state:store.state,store_ids:[],items:[]};
  if(group.state!==store.state){errors.push({...row,issues:['Cross-state quotation requires separate authorized review']});continue;}
  group.store_ids=[...new Set([...group.store_ids,store.id])].sort();group.items.push({...row,store_id:store.id,store_code:code,description:String(raw.Description).trim(),quantity,unit_rate:rate});groups.set(key,group);
 }
 return {filename,sha256:createHash('sha256').update(bytes).digest('hex'),original_base64:bytes.toString('base64'),source_rows:[...groups.values()].reduce((n,g)=>n+g.items.length,0)+errors.length,groups:[...groups.values()],errors,can_save:errors.length===0&&groups.size>0};
}

const normalized=v=>String(v??'').replace(/[^a-z0-9]/gi,'').toUpperCase();
const meaningful=c=>c?.v!==undefined&&c.v!==null&&String(c.v).trim()!=='';
const labels=[['quotation_number',/^\s*Quotation\s*(?:Number|No\.?)\s*(?::\s*(.*))?$/i],['quotation_date',/^\s*Quotation\s*Date\s*(?::\s*(.*))?$/i],['store_code',/^\s*Store\s*Code\s*(?::\s*(.*))?$/i],['store_name',/^\s*Store\s*Name\s*(?::\s*(.*))?$/i],['subject',/^\s*(?:Subject|Sub)\.?\s*(?::\s*(.*))?$/i]];
function isoDate(value){
 if(typeof value==='number'){const d=XLSX.SSF.parse_date_code(value);if(!d)throw Error('Valid quotation date required');value=`${d.d}-${d.m}-${d.y}`;}
 const m=String(value).trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);if(!m)throw Error('Quotation Date must contain a valid DD-MM-YYYY date.');
 const [,day,month,year]=m,d=new Date(Date.UTC(Number(year),Number(month)-1,Number(day)));
 if(d.getUTCFullYear()!==Number(year)||d.getUTCMonth()+1!==Number(month)||d.getUTCDate()!==Number(day))throw Error('Invalid quotation date.');
 return `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
}
// Exact decimal addition for source reconciliation; never overwrites source amounts.
function decimalSum(values){
 const parts=values.filter(v=>v!==null&&v!==undefined).map(v=>String(v).split('.'));if(!parts.length)return null;
 const scale=Math.max(...parts.map(p=>(p[1]||'').length)),sum=parts.reduce((n,[a,b=''])=>n+BigInt(a+b.padEnd(scale,'0')),0n);
 const text=sum.toString().padStart(scale+1,'0');return scale?`${text.slice(0,-scale)}.${text.slice(-scale)}`.replace(/\.?0+$/,''):text;
}
function decimalDifference(a,b){
 const p=String(a).split('.'),q=String(b).split('.'),scale=Math.max(p[1]?.length||0,q[1]?.length||0);
 const n=BigInt(p[0]+(p[1]||'').padEnd(scale,'0'))-BigInt(q[0]+(q[1]||'').padEnd(scale,'0'));
 const text=(n<0n?-n:n).toString().padStart(scale+1,'0'),v=scale?`${text.slice(0,-scale)}.${text.slice(-scale)}`.replace(/\.?0+$/,''):text;return (n<0n?'-':'')+v;
}
function parseMisQuotation(bytes,filename,sheet,sheetName,stores){
 const range=XLSX.utils.decode_range(sheet['!ref']||'A1');if(range.e.r>10000)throw Error('Quotation exceeds supported row limits.');
 const errors=[],warnings=[],header={source_format:'MIS_QUOTATION_V1',source_sheet:sheetName,source_cells:{}},items=[],seen=new Set();
 const issue=(source_row,message)=>errors.push({source_sheet:sheetName,source_row,issues:[message]});
 const cell=(r,c)=>sheet[XLSX.utils.encode_cell({r,c})];
 const populated=Object.entries(sheet).filter(([a,c])=>!a.startsWith('!')&&meaningful(c));
 if(populated.length>220000)throw Error('Quotation exceeds supported cell limits.');
 for(const [address,c] of populated){
  const pos=XLSX.utils.decode_cell(address);if(pos.r>11||pos.c>21)continue;
  for(const [field,pattern] of labels){const match=String(c.v).match(pattern);if(!match)continue;
   let value=(match[1]||'').trim(),source=address,sourceCell=c;
   if(!value){for(let col=pos.c+1;col<22;col++){const next=cell(pos.r,col);if(!meaningful(next))continue;
    if(labels.some(([,p])=>p.test(String(next.v)))||/^[^:]+:/.test(String(next.v)))break;
    value=typeof next.v==='number'&&field==='quotation_date'?next.v:String(next.v).trim();source=XLSX.utils.encode_cell({r:pos.r,c:col});sourceCell=next;break;}}
   if(header[field]!==undefined){issue(pos.r+1,`Duplicate ${field} label`);continue;}
   if(c.f||c.t==='e'||sourceCell.f||sourceCell.t==='e'){issue(pos.r+1,`Literal ${field} value required`);continue;}
   header[field]=value;header.source_cells[field]=source;
  }
 }
 for(const [field] of labels)if(header[field]===undefined||String(header[field]).trim()==='')issue(null,`${field} is required in its labeled quotation cell`);
 if(header.quotation_date)try{header.quotation_date_source=header.quotation_date;header.quotation_date=isoDate(header.quotation_date);}catch(e){issue(null,e.message);}
 header.store_code=storeKey(header.store_code);
 const candidates=stores.filter(s=>storeKey(s.store_code)===header.store_code&&s.status==='Active'),store=candidates.length===1?candidates[0]:null;
 if(!store)issue(null,'One active verified canonical Store Code match is required.');
 const headerRows=[];for(let r=0;r<Math.min(30,range.e.r+1);r++)if(normalized(cell(r,0)?.v)==='SNO'&&normalized(cell(r,5)?.v)==='DESCRIPTIONOFMATERIALSERVICESHORTTEXT')headerRows.push(r);
 if(headerRows.length!==1)issue(null,'One supported MIS A–V quotation item header is required.');
 const heading=headerRows[0];
 if(heading!==undefined)MIS_QUOTATION_COLUMNS.forEach(([,name],col)=>{if(normalized(cell(heading,col)?.v)!==normalized(name))issue(heading+1,`Unsupported ${XLSX.utils.encode_col(col)} header; expected ${name}`);});
 function valuesAt(r,totals=false){
  const values={},texts={},raw={},source_cells={};
  MIS_QUOTATION_COLUMNS.forEach(([field,name],col)=>{
   const c=cell(r,col),address=XLSX.utils.encode_cell({r,c:col});raw[name]=c?.v??null;source_cells[field]=address;
   if(c?.f||c?.t==='e'){issue(r+1,`Formula/error cell ${address} is not a verified source value`);values[field]=null;return;}
   if(MIS_QUOTATION_NUMERIC_FIELDS.includes(field)){
    if(!meaningful(c)){values[field]=null;return;}
    const text=String(c.v).trim();if(!/^\d+(?:\.\d+)?$/.test(text)||!Number.isFinite(Number(text))){issue(r+1,`Invalid nonnegative ${field} in ${address}`);values[field]=null;return;}
    values[field]=Number(text);texts[field]=text;
   }else values[field]=meaningful(c)?String(c.w??c.v).trim():'';
  });
  for(const field of totals?['amount','taxable_amount','total_gst','total_amount']:['quantity','unit_rate','amount','taxable_amount','gst_rate','total_gst','total_amount'])if(values[field]===null)issue(r+1,`${field} is required`);
  if(!totals&&(values.quantity!==null&&values.quantity<=0))issue(r+1,'Quantity must be greater than zero.');
  return {...values,numeric_text:texts,raw,source_cells,source_row:r+1,source_sheet:sheetName};
 }
 let totalRow;
 if(heading!==undefined)for(let r=heading+2;r<=range.e.r;r++){
  const row=Array.from({length:22},(_,col)=>cell(r,col));if(!row.some(meaningful))continue;
  if(normalized(row[5]?.v)==='TOTALAMOUNT'){totalRow=r;header.totals=valuesAt(r,true);break;}
  if(!/^\d+$/.test(String(row[0]?.v??''))||Number(row[0].v)<=0){issue(r+1,'Unrecognized nonblank item row before quotation totals.');continue;}
  const item=valuesAt(r);if(!item.description||!item.uom)issue(r+1,'Description and UOM are required.');
  if(seen.has(item.line_number))issue(r+1,'Duplicate item serial number.');seen.add(item.line_number);
  items.push({...item,store_id:store?.id,store_code:header.store_code});
 }
 if(totalRow===undefined)issue(null,'Labeled Total Amount row is required.');
 if(!items.length)issue(null,'At least one genuine quotation line item is required.');
 if(header.totals){
  header.line_sums={};header.differences={};
  for(const key of ['amount','management_fees','taxable_amount','sgst_ugst_amount','cgst_amount','igst_amount','total_gst','total_amount']){
   const sum=decimalSum(items.map(i=>i.numeric_text[key]));header.line_sums[key]=sum;
   if(sum!==null&&header.totals.numeric_text[key]!==undefined){const difference=decimalDifference(header.totals.numeric_text[key],sum);header.differences[key]=difference;if(difference!=='0')warnings.push(`Source ${key.replaceAll('_',' ')} total differs from line sum by ${difference}; source values are preserved.`);}
  }
 }
 header.warnings=warnings;
 // Existing RPCs persist item JSON verbatim. Store the document header once on the
 // first line so current/revised headers and totals survive without changing SQL.
 if(items.length)items[0].quotation_header=header;
 const group={quotation_number:header.quotation_number,state:store?.state,store_ids:store?[store.id]:[],quotation_header:header,items};
 return {filename,source_format:'MIS_QUOTATION_V1',sha256:createHash('sha256').update(bytes).digest('hex'),original_base64:bytes.toString('base64'),source_rows:items.length,groups:[group],errors,warnings,can_save:errors.length===0&&items.length>0};
}
