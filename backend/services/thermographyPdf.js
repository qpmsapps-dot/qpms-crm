import {readFile,stat} from 'node:fs/promises';

export const THERMO_MIME='application/pdf';
export const THERMO_BUCKET='retail-thermography-reports';
export const THERMO_MAX_BYTES=10_000_000;
const invalid=message=>Object.assign(Error(message),{statusCode:422,code:'invalid_thermography_pdf'});
export function validateThermoFile({filename,size,mime},maxBytes=THERMO_MAX_BYTES){
 if(typeof filename!=='string'||filename.length>180||!/^.+\.pdf$/i.test(filename)||[...filename].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127||c==='/'||c==='\\'))throw invalid('Select a PDF with a safe .pdf filename.');
 if(!Number.isSafeInteger(size)||size<20||size>maxBytes)throw invalid(`PDF must not exceed ${maxBytes.toLocaleString('en-IN')} bytes (maximum 10 MB).`);
 if(mime!==THERMO_MIME)throw invalid('Only application/pdf reports are accepted.');
}
// Bounded format/integrity validation, not a malware or thermal-content classifier.
export async function validateThermoPdf(file,{maxBytes=THERMO_MAX_BYTES}={}){
 const size=(await stat(file)).size;
 if(size<20||size>maxBytes)throw invalid('PDF exceeds its allowed size.');
 const bytes=await readFile(file),header=bytes.subarray(0,9).toString('latin1');
 if(!/^%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n)/.test(header))throw invalid('Invalid PDF signature.');
 const tail=bytes.subarray(Math.max(0,size-2048)).toString('latin1');
 const end=tail.match(/startxref\s+(\d+)\s+%%EOF\s*$/);
 if(!end)throw invalid('PDF is incomplete or has no valid end marker.');
 const offset=Number(end[1]);
 if(!Number.isSafeInteger(offset)||offset<9||offset>=size)throw invalid('Invalid PDF cross-reference offset.');
 const xref=bytes.subarray(offset,Math.min(size,offset+1024)).toString('latin1');
 if(!/^xref\s/.test(xref)&&!/^\d+\s+\d+\s+obj\b[\s\S]*?\/Type\s*\/XRef\b/.test(xref))throw invalid('Invalid PDF cross-reference structure.');
 return {bytes:size};
}
