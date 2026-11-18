import {open,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInflateRaw} from 'node:zlib';
import {Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export const THERMO_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const THERMO_BUCKET='retail-thermography-reports';
export const THERMO_MAX_BYTES=100*1024*1024;
export const workbookError=message=>Object.assign(Error(message),{statusCode:422,code:'invalid_thermography_workbook'});
export function validateThermoFile({filename,size,mime},maxBytes=THERMO_MAX_BYTES){
 if(typeof filename!=='string'||filename.length>180||!/^.*\.xlsx$/i.test(filename)||[...filename].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127||c==='/'||c==='\\'))throw workbookError('Select an original .xlsx workbook with a safe filename.');
 if(!Number.isSafeInteger(size)||size<22||size>maxBytes)throw workbookError(`Workbook must be between 22 bytes and ${Math.floor(maxBytes/1024/1024)} MiB.`);
 if(mime&&!['application/octet-stream','application/zip',THERMO_MIME].includes(mime))throw workbookError('Only .xlsx Excel workbooks are supported.');
}
const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
// Validate archive structure and CRC, never interpret workbook cells, formulas or photographs.
export async function validateThermoWorkbook(file,{maxBytes=THERMO_MAX_BYTES,signal=AbortSignal.timeout(30000)}={}){
 const bytes=(await stat(file)).size;if(bytes<22||bytes>maxBytes)throw workbookError('Workbook size is outside the allowed limit.');
 const handle=await open(file,'r');
 const read=async(length,position)=>{const b=Buffer.alloc(length);if((await handle.read(b,0,length,position)).bytesRead!==length)throw workbookError('Incomplete Excel archive.');return b;};
 try{
  if((await read(4,0)).readUInt32LE(0)!==0x04034b50)throw workbookError('Workbook does not have an XLSX ZIP signature.');
  const tail=await read(Math.min(bytes,65557),Math.max(0,bytes-65557));let end=-1;
  for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50&&i+22+tail.readUInt16LE(i+20)===tail.length){end=i;break;}
  if(end<0||tail.readUInt16LE(end+4)||tail.readUInt16LE(end+6))throw workbookError('Malformed or split Excel archive.');
  const entries=tail.readUInt16LE(end+10),directorySize=tail.readUInt32LE(end+12),directoryOffset=tail.readUInt32LE(end+16),endOffset=bytes-tail.length+end;
  if(!entries||entries>10000||entries!==tail.readUInt16LE(end+8)||directorySize>4*1024*1024||directoryOffset+directorySize!==endOffset)throw workbookError('Unsupported or oversized Excel archive directory.');
  const directory=await read(directorySize,directoryOffset),names=new Set(),ranges=[];let cursor=0,expandedTotal=0;
  for(let i=0;i<entries;i++){
   signal.throwIfAborted();
   if(cursor+46>directory.length||directory.readUInt32LE(cursor)!==0x02014b50)throw workbookError('Malformed Excel archive directory.');
   const flags=directory.readUInt16LE(cursor+8),method=directory.readUInt16LE(cursor+10),crc=directory.readUInt32LE(cursor+16),compressed=directory.readUInt32LE(cursor+20),expanded=directory.readUInt32LE(cursor+24),nameLength=directory.readUInt16LE(cursor+28),extra=directory.readUInt16LE(cursor+30),comment=directory.readUInt16LE(cursor+32),offset=directory.readUInt32LE(cursor+42);
   const name=directory.subarray(cursor+46,cursor+46+nameLength).toString('utf8');
   if(!name||nameLength>1024||cursor+46+nameLength+extra+comment>directory.length||flags&1||![0,8].includes(method)||name.includes('\\')||name.startsWith('/')||name.split('/').includes('..')||names.has(name)||/vbaProject\.bin$/i.test(name))throw workbookError('Encrypted, macro-enabled or malformed XLSX archives are unsupported.');
   if(expanded>50*1024*1024||(expandedTotal+=expanded)>250*1024*1024||compressed===0&&expanded!==0||compressed>0&&expanded/compressed>1000)throw workbookError('Expanded workbook exceeds the validation safety limit.');
   names.add(name);cursor+=46+nameLength+extra+comment;
   const header=await read(30,offset);
   if(header.readUInt32LE(0)!==0x04034b50||header.readUInt16LE(6)!==flags||header.readUInt16LE(8)!==method)throw workbookError('Excel archive entry mismatch.');
   const localNameLength=header.readUInt16LE(26),localExtra=header.readUInt16LE(28),start=offset+30+localNameLength+localExtra;
   if(start+compressed>directoryOffset||(await read(localNameLength,offset+30)).toString('utf8')!==name)throw workbookError('Invalid Excel archive entry bounds.');
   if(!(flags&8)&&(header.readUInt32LE(14)!==crc||header.readUInt32LE(18)!==compressed||header.readUInt32LE(22)!==expanded))throw workbookError('Excel archive size/checksum metadata mismatch.');
   if(ranges.some(r=>offset<r.end&&start+compressed>r.start))throw workbookError('Overlapping Excel archive entries.');ranges.push({start:offset,end:start+compressed});
   let actual=0,checksum=0xffffffff;
   if(compressed){
    const source=createReadStream(file,{start,end:start+compressed-1});
    const sink=new Writable({write(chunk,encoding,done){actual+=chunk.length;if(actual>expanded){done(workbookError('Invalid expanded workbook size.'));return;}for(const b of chunk)checksum=crcTable[(checksum^b)&255]^(checksum>>>8);done();}});
    try{await pipeline(...(method===8?[source,createInflateRaw(),sink]:[source,sink]),{signal});}catch(e){throw e.code==='invalid_thermography_workbook'?e:workbookError('Workbook archive could not be validated.');}
   }
   if(actual!==expanded||((checksum^0xffffffff)>>>0)!==crc)throw workbookError('Workbook archive checksum failed.');
  }
  if(cursor!==directory.length||!['[Content_Types].xml','_rels/.rels','xl/workbook.xml','xl/_rels/workbook.xml.rels'].every(n=>names.has(n)))throw workbookError('Required XLSX package parts are missing.');
  return {entries,bytes};
 }finally{await handle.close();}
}
