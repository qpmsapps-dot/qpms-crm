import {useEffect,useState} from 'react';
import {authenticatedApiRequest} from '../../services/api.js';
import {indiaToday} from '../../../backend/shared/retailAttendance.js';

export default function RetailCleaningScheduleViewer(){
 const [month,setMonth]=useState(indiaToday().slice(0,7));
 const [page,setPage]=useState(1),[result,setResult]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(true),[refresh,setRefresh]=useState(0);
 useEffect(()=>{let live=true;authenticatedApiRequest({url:'/api/client-deep-cleaning/schedules',params:{month,page,limit:50}}).then(r=>{if(live){setResult(r.data);setError('');}}).catch(e=>{if(live){setResult(null);setError(e.response?.data?.message||'Schedules unavailable.');}}).finally(()=>{if(live)setBusy(false);});return()=>{live=false;};},[month,page,refresh]);
 function reload(){setBusy(true);setRefresh(v=>v+1);}
 async function exportSchedules(){
  setBusy(true);setError('');
  try{
   const rows=[];let exportPage=1,total=1;
   while(rows.length<total){const r=await authenticatedApiRequest({url:'/api/client-deep-cleaning/schedules/export',params:{month,page:exportPage++,limit:100}});total=r.data.pagination.total;rows.push(...r.data.rows);if(!r.data.rows.length)break;}
   const {default:ExcelJS}=await import('exceljs'),{downloadUnified}=await import('../../utils/retailUnifiedExport.js'),book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Cleaning schedules');
   sheet.addRow(['Store Code','Store Name','Geographic State','Reporting State','Zone','Date','Status','Assignment','Instructions']);rows.forEach(r=>sheet.addRow([r.store_code,r.store_name,r.geographic_state,r.reporting_state,r.zone_id,r.scheduled_date,r.status,r.assignment_status,r.notes]));
   await downloadUnified(book,'Retail_Cleaning_Schedules.xlsx');
  }catch(e){setError(e.response?.data?.message||'Export unavailable.');}finally{setBusy(false);}
 }
 return <section className="p-4 space-y-4"><h1 className="text-2xl font-semibold">Reliance Retail Cleaning Schedules</h1><p>View schedules within your verified access. Assignment Pending does not change the Planned lifecycle status.</p><div className="flex gap-3"><label>Month <input type="month" value={month} onChange={e=>{setMonth(e.target.value);setPage(1);setBusy(true);}}/></label><button onClick={reload} disabled={busy}>Refresh</button>{result?.capabilities?.export&&<button disabled={busy} onClick={()=>void exportSchedules()}>Export Excel</button>}</div>{busy?<p role="status">Loading schedules…</p>:error?<p role="alert">{error}</p>:<><p>{result?.pagination.total||0} schedules</p><div className="overflow-x-auto"><table className="min-w-full text-left"><thead><tr>{['Store','State / reporting state','Zone','Date','Activity','Status','Assignment','Instructions'].map(t=><th key={t} className="p-2">{t}</th>)}</tr></thead><tbody>{result?.rows.map(r=><tr key={r.schedule_id}>{[`${r.store_code} — ${r.store_name}`,`${r.geographic_state} / ${r.reporting_state}`,r.zone_id||'—',r.scheduled_date,r.activity,r.status,r.assignment_status,r.notes||'—'].map((v,i)=><td className="p-2 border-t" key={i}>{v}</td>)}</tr>)}</tbody></table></div>{!result?.rows.length&&<p>No schedules in this period within your permitted scope.</p>}<button disabled={page===1} onClick={()=>{setPage(v=>v-1);setBusy(true);}}>Previous</button><span> Page {page} </span><button disabled={page*50>=(result?.pagination.total||0)} onClick={()=>{setPage(v=>v+1);setBusy(true);}}>Next</button></>}</section>;
}
