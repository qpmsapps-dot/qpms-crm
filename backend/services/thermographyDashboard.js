import {thermoReportRpc} from './thermographyReportsService.js';
const bad=message=>Object.assign(Error(message),{statusCode:400});
export function monthRange(month){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))throw bad('Select a valid month.');
 const from=month+'-01',to=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);return {from,to};
}
export function dashboardResult(rows,report,filters){
 const {from,to}=monthRange(filters.month),date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
 if(filters.kpi_from&&!date(filters.kpi_from)||filters.kpi_to&&!date(filters.kpi_to))throw bad('Select a valid KPI date range.');
 const start=filters.kpi_from||from,end=filters.kpi_to||to;
 if(start>end||start<from||end>to)throw bad('KPI dates must be within the selected month.');
 const cutoff=end<report.today?end:report.today;
 if(filters.state&&!report.stores.some(s=>s.state===filters.state||filters.state==='TN'&&s.state==='PY'))throw Object.assign(Error('Requested state is outside authorized Thermography scope.'),{statusCode:403});
 if(filters.store&&!report.stores.some(s=>s.id===filters.store))throw Object.assign(Error('Requested store is outside authorized Thermography scope.'),{statusCode:403});
 const scoped=rows.filter(r=>(!filters.state||r.state===filters.state||filters.state==='TN'&&r.state==='PY')&&(!filters.store||r.retail_store_id===filters.store));
 const cohort=scoped.filter(r=>r.scheduled_date>=start&&r.scheduled_date<=cutoff),states={};
 for(const row of cohort){const state=states[row.state]??={state:row.state,scheduled:0,completed:0};state.scheduled++;if(row.pdf_verified===true)state.completed++;}
 const completed=cohort.filter(r=>r.pdf_verified===true).length,monthlyCompleted=scoped.filter(r=>r.pdf_verified===true).length;
 if(filters.status&&!['Scheduled','Completed'].includes(filters.status))throw bad('Unsupported Thermography status.');
 const filtered=scoped.filter(r=>(!filters.status||(r.pdf_verified?'Completed':'Scheduled')===filters.status)&&(!filters.q||r.store_code.toLowerCase().includes(String(filters.q).toLowerCase())));
 filtered.sort((a,b)=>a.scheduled_date.localeCompare(b.scheduled_date)||a.store_code.localeCompare(b.store_code)||a.id.localeCompare(b.id));
 const limit=Number(filters.limit||25),page=Number(filters.page||0);
 if(![10,25,50,100].includes(limit)||!Number.isSafeInteger(page)||page<0)throw bad('Invalid table pagination.');
 return {contract:'thermography.v2',month:filters.month,today:report.today,from,to,kpi_from:start,kpi_to:cutoff,
  summary:{scheduled:cohort.length,completed,percentage:cohort.length?completed/cohort.length*100:0},chart:Object.values(states).sort((a,b)=>a.state.localeCompare(b.state)),
  monthly:{total:scoped.length,completed:monthlyCompleted,scheduled:scoped.length-monthlyCompleted},total:filtered.length,rows:filtered.slice(page*limit,(page+1)*limit),page,limit,
  stores:report.stores,can_schedule:report.can_upload,can_upload:report.can_upload,scope_digest:report.scope_digest};
}
export async function thermoDashboard(client,profile,filters){
 const range=monthRange(filters.month),report=await thermoReportRpc(client,profile,'dashboard',range);
 if(report.total>5000)throw Object.assign(Error('Selected monthly schedule exceeds the supported 5,000 rows.'),{statusCode:422});
 if(report.rows.length!==report.total)throw Object.assign(Error('Incomplete schedule; no totals confirmed.'),{statusCode:503});
 return dashboardResult(report.rows,report,filters);
}
