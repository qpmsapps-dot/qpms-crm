// Source completeness and review priority only. These labels never authorize activation.
export const IMPORT_CLASSIFICATIONS=Object.freeze(['Pending MIS Completion','Needs Review','Blocking Identity Conflict','Ready for Staging']);
const pending=new Set(['ZONE_PENDING','FO_IDENTITY_UNVERIFIED','HK_TOTAL_PENDING','MEPC_TOTAL_PENDING','MISSING_STORE_NAME','PENDING_IDENTITY_APPROVAL']);
const blocking=new Set(['DUPLICATE_SOURCE_CODE','AMBIGUOUS_STORE_CODE','CANONICAL_GEOGRAPHY_CONFLICT','UNKNOWN_GEOGRAPHY','MISSING_STORE_CODE']);
const technical=new Set(['TECHNICAL_FORMULA_OR_CELL_ERROR','MISSING_STORE_CODE']);
const actualConflict=issue=>issue.endsWith('_CONFLICT')||['DUPLICATE_SOURCE_CODE','AMBIGUOUS_STORE_CODE'].includes(issue);
const optionalNote=/^(?:FO NAME NOT LINKED TO VERIFIED EMPLOYEE ID|FO NOT PROVIDED|OPERATIONAL ZONE NOT CONFIRMED|ZONE (?:NOT PROVIDED|PENDING)|FO (?:IDENTITY )?UNVERIFIED|(?:HK|MEPC|AOP) (?:TOTAL )?PENDING|PENDING VERIFICATION)$/i;

export function sourceNoteIssues(raw={}){
 const issues=[];
 for(const field of ['Conflict / Closed Evidence','Mapping Conflict / Note']){
  for(const clause of String(raw[field]??'').split(/[;\n|]+/).map(v=>v.trim()).filter(Boolean)){
   const note=clause.replace(/[.!]+$/,'');
   if(optionalNote.test(note)||/^(?:NO (?:KNOWN )?CONFLICTS?(?: FOUND)?|NONE|N\/A)$/i.test(note))continue;
   // Unknown notes stay visible for review; only explicit contradictory evidence
   // is counted as a source data conflict. Never discard the original note.
   issues.push(/\b(?:CONFLICT(?:ING|S)?|DISPUT(?:E|ED)|MISMATCH(?:ED)?|DUPLICATE|AMBIGUOUS)\b/i.test(note)?'SOURCE_CONFLICT':'SOURCE_REVIEW_NOTE');
  }
 }
 return [...new Set(issues)];
}

export function classifyUnifiedRow(row){
 const source=row.raw?row:row.source||row;
 const recorded=row.issues??source.issues;
 const original=[...(recorded||[])];
 const raw=source.raw||{};
 // The original provisional uploader predates recorded issue arrays. Its retained
 // 19-column rows must not become "ready" merely because those arrays are absent.
 if(!recorded&&['Site Code','Store Code'].some(field=>Object.hasOwn(raw,field))){
  const value=(...fields)=>{const key=fields.find(field=>Object.hasOwn(raw,field));return key?String(raw[key]??'').trim():'';};
  if(!value('Zone ID'))original.push('ZONE_PENDING');
  if(!value('FO Employee ID (Source)','FO Employee ID (Verified)'))original.push('FO_IDENTITY_UNVERIFIED');
  if(!value('HK Total (Proposed)','HK AOP - Total (Source)'))original.push('HK_TOTAL_PENDING');
  if(!value('MEPC Total (Proposed)','MEPC AOP - Total (Source)'))original.push('MEPC_TOTAL_PENDING');
 }
 const notes=sourceNoteIssues(raw);
 // Old immutable versions retain their recorded flags. Reinterpret the generic
 // note flag for presentation, without rewriting source or verified values.
 const unknownLegacyNote=original.includes('SOURCE_CONFLICT')&&!['Conflict / Closed Evidence','Mapping Conflict / Note'].some(field=>String(raw[field]??'').trim());
 const issues=[...new Set([...original.filter(i=>i!=='SOURCE_CONFLICT'),...notes,...(unknownLegacyNote?['SOURCE_REVIEW_NOTE']:[])])];
 const pending_issues=issues.filter(i=>pending.has(i));
 const blocking_identity_issues=issues.filter(i=>blocking.has(i));
 const review_issues=issues.filter(i=>!pending.has(i)&&!blocking.has(i));
 const actual_conflict_issues=issues.filter(actualConflict);
 const technical_issues=issues.filter(i=>technical.has(i));
 const classification=blocking_identity_issues.length?'Blocking Identity Conflict':review_issues.length?'Needs Review':pending_issues.length?'Pending MIS Completion':'Ready for Staging';
 return {issues,pending_issues,review_issues,blocking_identity_issues,actual_conflict_issues,technical_issues,classification};
}
