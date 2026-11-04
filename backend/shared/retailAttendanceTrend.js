import {summarizeAttendance,validDate} from './retailAttendance.js';

// Data-backed calendar trend. A missing attendance upload must never become
// a fabricated 0% attendance percentage, and unknown AOP must stay N/A.
// The caller supplies only the stores and source rows authorized for that user.
export function retailAttendanceTrend({stores=[],attendance=[],aop=[],cutoff}){
 validDate(cutoff);
 const month=cutoff.slice(0,7),days=Number(cutoff.slice(8));
 const grouped=new Map(),present=new Set();
 for(const row of attendance){
  if(!row.attendance_date?.startsWith(month))continue;
  const date=row.attendance_date;
  if(!grouped.has(date))grouped.set(date,[]);
  grouped.get(date).push(row);
  present.add(date);
 }
 return Array.from({length:days},(_,index)=>{
  const date=`${month}-${String(index+1).padStart(2,'0')}`;
  const recorded=present.has(date),day=summarizeAttendance({
   stores,attendance:grouped.get(date)||[],aop,cutoff:date,view:'daily'
  }).total;
  return {
   date,day:index+1,
   hk_actual:recorded?day.hk_actual:null,
   mepc_actual:recorded?day.mepc_actual:null,
   total_actual:recorded?day.total_actual:null,
   hk_target:day.missing_aop.length?null:day.hk_target,
   mepc_target:day.missing_aop.length?null:day.mepc_target,
   total_target:day.missing_aop.length?null:day.total_target,
   hk_pct:recorded?day.hk_pct:null,
   mepc_pct:recorded?day.mepc_pct:null,
   overall_pct:recorded?day.overall_pct:null,
   complete:recorded&&day.complete,
   has_attendance_upload:recorded
  };
 });
}
