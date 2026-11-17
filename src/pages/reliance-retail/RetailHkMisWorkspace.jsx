import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
import { Download, Eye, RefreshCw, ShieldCheck } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { authenticatedApiRequest } from '../../services/api.js';
import { indiaToday, monthDates, summarizeAttendance } from '../../../backend/shared/retailAttendance.js';
import 'leaflet/dist/leaflet.css';

const MODULE_LABELS = Object.freeze({
  dashboard: 'Dashboard',
  operations: 'Operations',
  'attendance-hk': 'Attendance',
  'training-hk': 'Training',
  cleaning: 'Deep Cleaning',
});
const api = async (path, params) => (await authenticatedApiRequest({
  url: '/api/reliance-retail/mis' + path, params,
})).data.result;
const fmt = value => value == null ? 'N/A' : Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const percent = value => value == null ? 'N/A' : fmt(value) + '%';
const dayTime = value => value ? new Date(value).toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
}) : 'Not recorded';
const short = value => String(value ?? '').slice(0, 110);
const isSubmitted = row => ['submitted', 'completed'].includes(String(row.status || '').toLowerCase())
  || row.final_outcome === 'Completed';
const submittedCleaning = report => (report?.rows || []).filter(row =>
  row.source_kind !== 'existing_schedule' && isSubmitted(row));
const scheduleCleaning = report => (report?.rows || []).filter(row => row.source_kind === 'existing_schedule');
const trainingRows = report => (report?.rows || []).filter(row => String(row.status || '').toLowerCase() === 'submitted');
const siteVisits = report => (report?.officers || []).flatMap(fo =>
  (fo.visits || []).map(v => ({...v, employee_code: fo.employee_code, employee_name: fo.name})));
const CARD = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900';
const BUTTON = 'inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';
const stateCenters = { TN: [11.2, 78.4], TG: [17.4, 78.6], KL: [10.5, 76.5] };

function Metric({ label, value, note }) {
  return <div className={CARD}><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <strong className="mt-2 block text-3xl font-bold text-slate-900 dark:text-white">{value}</strong>
    {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}</div>;
}
function Metrics({ items }) {
  return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
    {items.map(x => <Metric key={x.label} {...x}/>)}</div>;
}
function SimpleTable({ columns, rows, empty = 'No authorized records found.' }) {
  return <div className={CARD + ' overflow-x-auto'}>
    <table className="w-full min-w-[600px] text-left text-sm">
      <thead><tr className="border-b text-xs uppercase text-slate-500">{columns.map(c =>
        <th key={c.key} className="px-3 py-3">{c.label}</th>)}</tr></thead>
      <tbody>{rows.map((r,i) => <tr key={r.id || r.employee_code || i} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
        {columns.map(c => <td key={c.key} className="px-3 py-3 align-top">{c.render ? c.render(r) : short(r[c.key])}</td>)}</tr>)}</tbody>
    </table>
    {!rows.length && <p className="p-4 text-sm text-slate-500">{empty}</p>}
  </div>;
}
// Use the same audited attendance aggregation as the MIS backend. Never turn
// missing attendance/AOP coverage into a zero-percent data point.
function dailyAttendanceTrend(report) {
  if (!report?.summary?.cutoff || !Array.isArray(report.stores) ||
      !Array.isArray(report.rows) || !Array.isArray(report.aop)) return [];
  return monthDates(report.summary.cutoff).map(date => {
    try {
      const summary = summarizeAttendance({
        stores: report.stores, attendance: report.rows,
        aop: report.aop.map(a => ({ ...a, hk_count: a.hk_count, mepc_count: 0, aop_class: null })),
        cutoff: date, view: 'daily',
      }).total;
      return { date, value: summary.complete ? summary.hk_pct : null };
    } catch { return { date, value: null }; }
  });
}
function dailySubmittedTrend(report, module) {
  const rows = module === 'cleaning' ? submittedCleaning(report) : trainingRows(report);
  const counts = new Map();
  for (const row of rows) {
    const date = module === 'cleaning'
      ? (row.deep_cleaning_date || row.activity_date || row.submitted_at || '')
      : (row.training_date || row.activity_date || '');
    const day = String(date).slice(0, 10);
    if (/^20\d{2}-\d{2}-\d{2}$/.test(day)) counts.set(day, (counts.get(day) || 0) + 1);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));
}
function TrendGraph({ title, points, unit = 'count', note }) {
  const available = points.some(p => Number.isFinite(p.value));
  return <section className={CARD}>
    <h2 className="font-semibold">{title}</h2>
    {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    {available ? <div className="mt-3 h-56" role="img" aria-label={title + ': ' + points.map(p =>
      p.date + ' ' + (p.value == null ? 'N/A' : fmt(p.value) + (unit === 'percent' ? '%' : ''))).join('; ')}>
      <ResponsiveContainer width="100%" height="100%">
        {unit === 'percent' ? <LineChart data={points} margin={{ left: 0, right: 14, top: 12, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false}/>
          <XAxis dataKey="date" tickFormatter={d => d.slice(-2)} tick={{ fontSize: 11 }}/>
          <YAxis tickFormatter={v => v + '%'} width={48}/>
          <Tooltip formatter={v => [percent(v), 'HK Attendance']} />
          <Line dataKey="value" type="monotone" name="HK Attendance" stroke="#2563eb" strokeWidth={2} connectNulls={false} dot={{ r: 2 }} isAnimationActive={false}/>
        </LineChart> : <BarChart data={points} margin={{ left: 0, right: 14, top: 12, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false}/>
          <XAxis dataKey="date" tickFormatter={d => d.slice(-2)} tick={{ fontSize: 11 }}/>
          <YAxis allowDecimals={false} width={42}/>
          <Tooltip formatter={v => [fmt(v), 'Submitted']} />
          <Bar dataKey="value" name="Submitted" fill="#2563eb" maxBarSize={38} isAnimationActive={false}/>
        </BarChart>}
      </ResponsiveContainer>
    </div> : <p className="mt-4 text-sm text-slate-500">No verified observations available for this period.</p>}
  </section>;
}
function ReportSummary({ attendance, cleaning, training }) {
  const total = attendance?.summary?.total || {};
  return <><Metrics items={[
    {label:'HK Attendance',value:percent(total.hk_pct),note:'Month-to-date; N/A when source or AOP coverage is incomplete'},
    {label:'HK Attended Employee-Days',value:fmt(total.hk_actual),note:'Authorized state only'},
    {label:'Deep Cleaning Submitted',value:fmt(submittedCleaning(cleaning).length),note:'Submitted reports, including independent work'},
    {label:'HK Training Sessions',value:fmt(training?.counts?.completed_sessions ?? trainingRows(training).length),note:'Submitted HK sessions'},
  ]}/>
    <div className={CARD}>
      <h2 className="font-semibold text-slate-900 dark:text-white">State operational overview</h2>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Deep Cleaning scheduled: {fmt(scheduleCleaning(cleaning).length)}.
        Submitted: {fmt(submittedCleaning(cleaning).length)}. These are separate counts, not a schedule-completion percentage.
        Attendance percentages are shown only when approved coverage is complete.</p>
    </div>
    <div className="grid gap-3 lg:grid-cols-3">
      <TrendGraph title="Daily HK attendance %" points={dailyAttendanceTrend(attendance)} unit="percent"
        note="Only days with verified attendance and AOP coverage have a percentage; missing days remain N/A."/>
      <TrendGraph title="Deep Cleaning submissions by date" points={dailySubmittedTrend(cleaning, 'cleaning')}
        note="Submitted work, including independent reports; not a schedule completion percentage."/>
      <TrendGraph title="HK Training sessions by date" points={dailySubmittedTrend(training, 'training')}
        note="Submitted housekeeping training sessions only."/>
    </div></>;
}
function AttendanceView({ report }) {
  const total = report?.summary?.total || {};
  const daily = useMemo(() => {
    const values = new Map();
    for (const row of report?.rows || []) {
      const day = row.attendance_date;
      if (day) values.set(day, (values.get(day)||0) + Number(row.credit || 0));
    }
    return [...values].sort((a,b) => a[0].localeCompare(b[0]));
  }, [report]);
  const max = Math.max(1,...daily.map(x => x[1]));
  return <><Metrics items={[
    {label:'HK Attendance',value:percent(total.hk_pct),note:'State total, verified coverage only'},
    {label:'HK Actual',value:fmt(total.hk_actual),note:'Attended employee-days'},
    {label:'HK Target',value:fmt(total.hk_target),note:'Approved AOP for the selected period'},
    {label:'Data Coverage',value:total.complete ? 'Complete' : 'Incomplete',note:'Missing source data is never counted as absent'},
  ]}/>
    <section className={CARD}><h2 className="font-semibold">Daily HK attendance trend</h2>
      <p className="text-xs text-slate-500">Recorded attended employee-days per date</p>
      <div className="mt-4 flex min-h-40 items-end gap-1 overflow-x-auto">
        {daily.map(([day,count]) => <div key={day} className="flex min-w-5 flex-1 flex-col items-center" title={day + ': ' + count}>
          <span className="mb-1 text-[10px] text-slate-600">{fmt(count)}</span>
          <div className="w-full rounded-t bg-blue-600" style={{height: Math.max(4, 110*count/max) + 'px'}}/>
          <span className="mt-1 text-[10px] text-slate-500">{day.slice(-2)}</span></div>)}
      </div>
      {!daily.length && <p className="py-5 text-sm text-slate-500">No recorded attendance within this period.</p>}
    </section>
    <TrendGraph title="Daily HK attendance %" points={dailyAttendanceTrend(report)} unit="percent"
      note="Only complete daily source/AOP coverage produces a percentage; missing days remain N/A."/>
    <h2 className="font-semibold">Store-wise HK attendance</h2>
    <SimpleTable columns={[
      {key:'store_code',label:'Store Code'}, {key:'store_name',label:'Store'},
      {key:'hk_actual',label:'Actual'}, {key:'hk_target',label:'Target'},
      {key:'hk_pct',label:'Attendance %',render:r=>percent(r.hk_pct)},
      {key:'complete',label:'Coverage',render:r=>r.complete?'Complete':'Incomplete'},
    ]} rows={(report?.summary?.stores || []).map(s=>({...s,id:s.id}))}/></>;
}
function OperationsView({ report }) {
  const [selected, setSelected] = useState('');
  const officers = report?.officers || [];
  const current = officers.find(fo=>fo.employee_code===selected) || officers[0];
  const points = officers.filter(fo=>fo.latitude != null && fo.longitude != null);
  const center = stateCenters[report?.states?.[0]] || [13, 79];
  return <><Metrics items={[
    {label:'Reliance Retail FOs',value:fmt(officers.length)},
    {label:'Active Today',value:fmt(officers.filter(x=>x.active_today).length)},
    {label:'Online (Recent GPS)',value:fmt(officers.filter(x=>x.online).length)},
    {label:'Sites Visited Today',value:fmt(officers.reduce((n,x)=>n+x.visited_count,0))},
  ]}/>
    <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
      <section className={CARD}><h2 className="mb-3 font-semibold">Last known FO locations</h2>
        <p className="mb-3 text-xs text-slate-500">Pins show the most recent reported GPS position, not necessarily a live position.</p>
        <div className="h-[450px] overflow-hidden rounded-xl">
          <MapContainer key={report?.states?.[0]} center={center} zoom={7} scrollWheelZoom={false} className="h-full w-full">
            <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
            {points.map(fo=><CircleMarker key={fo.employee_code} center={[fo.latitude,fo.longitude]}
              radius={9} pathOptions={{color:fo.active_today?'#15803d':'#64748b',fillOpacity:.85}}
              eventHandlers={{click:()=>setSelected(fo.employee_code)}}>
              <Popup><strong>{fo.name}</strong><p>{fo.day_status}</p><p>Last seen: {dayTime(fo.last_seen_at)}</p></Popup>
            </CircleMarker>)}
          </MapContainer>
        </div>
        {!points.length && <p className="mt-2 text-sm text-slate-500">No GPS locations currently available.</p>}
      </section>
      <section className={CARD}><h2 className="font-semibold">Field Officers</h2>
        <div className="mt-2 max-h-[225px] space-y-2 overflow-auto">{officers.map(fo=>
          <button key={fo.employee_code} className={'w-full rounded-lg border p-3 text-left text-sm '+(current?.employee_code===fo.employee_code?'border-blue-600 bg-blue-50 dark:bg-slate-800':'border-slate-200 dark:border-slate-700')}
            onClick={()=>setSelected(fo.employee_code)}>
            <span className="block font-semibold">{fo.name} · {fo.employee_code}</span>
            <span className="text-xs text-slate-500">{fo.day_status} · {fo.visited_count} sites visited</span>
          </button>)}</div>
        {current && <div className="mt-4 border-t pt-3 dark:border-slate-700">
          <h3 className="font-semibold">{current.name}</h3>
          <p className="text-sm text-slate-500">Start: {dayTime(current.start_time)} · End: {dayTime(current.end_time)}</p>
          <p className="text-sm text-slate-500">Last location: {dayTime(current.last_seen_at)}</p>
          <h4 className="mt-3 font-semibold">Today's site visits</h4>
          <div className="max-h-48 overflow-y-auto text-sm">{(current.visits||[]).map((v,i)=><div key={i} className="border-b py-2 dark:border-slate-700">
            <strong>{v.site_name}</strong><p>{v.status} · In: {dayTime(v.check_in_time)} · Out: {dayTime(v.check_out_time)}</p>
          </div>)}{!current.visits?.length && <p className="text-slate-500">No recorded site visits today.</p>}</div>
        </div>}
      </section>
    </div></>;
}
function EvidencePanel({ report, module, record }) {
  const [error,setError]=useState('');
  const [busy,setBusy]=useState('');
  const evidence=(report?.evidence||[]).filter(e=>e.record_id===record?.id && e.status==='uploaded');
  async function view(e) {
    setBusy(e.id);setError('');
    try {
      const path=e.existing
        ? '/existing-evidence/'+module+'/'+encodeURIComponent(e.record_id)+'/'+encodeURIComponent(e.id)
        : '/evidence/'+encodeURIComponent(e.id);
      const response=await api(path);
      if(!response?.url?.startsWith('https://'))throw Error('Private image is unavailable.');
      window.open(response.url,'_blank','noopener,noreferrer');
    } catch(e) {setError(e.message);}finally{setBusy('');}
  }
  if(!record)return null;
  return <section className={CARD} aria-label="Recorded photo evidence"><h3 className="font-semibold">Evidence — {record.store_code||record.store_code_snapshot||record.id}</h3>
    <div className="mt-2 flex flex-wrap gap-2">{evidence.map((e,i)=><button className={BUTTON} key={e.id} disabled={busy===e.id} onClick={()=>void view(e)}><Eye size={14}/>View photo {i+1}{e.topic_name?' · '+e.topic_name:''}</button>)}</div>
    {!evidence.length&&<p className="text-sm text-slate-500">No uploaded evidence recorded for this item.</p>}
    {error&&<p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}</section>;
}
function RecordsView({ report, module }) {
  const [selected,setSelected]=useState(null);
  const rows=module==='cleaning'?report?.rows||[]:trainingRows(report);
  const displayed=module==='cleaning'?rows.filter(r=>r.source_kind==='existing_schedule'||isSubmitted(r)):rows;
  const total=displayed.length;
  return <><Metrics items={module==='cleaning' ? [
    {label:'Scheduled',value:fmt(scheduleCleaning(report).length)},
    {label:'Completed / Submitted',value:fmt(submittedCleaning(report).length)},
    {label:'Uploaded Evidence',value:fmt((report?.evidence||[]).filter(e=>e.status==='uploaded').length)},
  ] : [
    {label:'HK Training Completed',value:fmt(report?.counts?.completed_sessions ?? displayed.length)},
    {label:'Uploaded Evidence',value:fmt((report?.evidence||[]).filter(e=>e.status==='uploaded').length)},
  ]}/>
    <p className="text-sm text-slate-500">Read-only: {total} authorized {module==='cleaning'?'schedules and submitted reports':'HK training sessions'}.</p>
    <TrendGraph title={module==='cleaning'?'Deep Cleaning submissions by date':'HK Training sessions by date'}
      points={dailySubmittedTrend(report,module)}/>
    <SimpleTable columns={module==='cleaning'?[
      {key:'store_code',label:'Store Code',render:r=>r.store_code || report.stores?.find(s=>s.id===r.retail_store_id)?.store_code || 'N/A'},
      {key:'store_name',label:'Store',render:r=>r.store_name || report.stores?.find(s=>s.id===r.retail_store_id)?.store_name || 'N/A'},
      {key:'date',label:'Date',render:r=>r.scheduled_date||r.deep_cleaning_date||r.activity_date||'N/A'},
      {key:'status',label:'Status',render:r=>r.status||r.final_outcome||'N/A'},
      {key:'evidence',label:'Evidence',render:r=>r.source_kind==='existing_schedule'?'Schedule only':<button className={BUTTON} onClick={()=>setSelected(r)}><Eye size={14}/>View Photos</button>},
    ]:[
      {key:'store_code',label:'Store Code'}, {key:'store_name',label:'Store'},
      {key:'training_date',label:'Date'},
      {key:'topic_names',label:'Topics',render:r=>(r.topic_names||[]).join(', ')||'Not recorded'},
      {key:'trainer_name_snapshot',label:'Trainer'},
      {key:'photos',label:'Evidence',render:r=><button className={BUTTON} onClick={()=>setSelected(r)}><Eye size={14}/>View Photos</button>},
    ]} rows={displayed}/>
    <EvidencePanel key={selected?.id||'none'} report={report} module={module} record={selected}/></>;
}

function excelRows(module, report) {
  if(module==='attendance-hk')return {name:'HK Attendance',headers:['Store Code','Store','State','HK Actual','HK Target','HK Attendance %','Coverage'],rows:(report?.summary?.stores||[]).map(r=>[r.store_code,r.store_name,r.state,r.hk_actual,r.hk_target,r.hk_pct,r.complete?'Complete':'Incomplete'])};
  if(module==='operations')return {name:'FO Attendance',headers:['FO Code','FO Name','State','Attendance','Start Day','End Day','Online','Visited Sites'],rows:(report?.officers||[]).map(r=>[r.employee_code,r.name,r.state,r.day_status,dayTime(r.start_time),dayTime(r.end_time),r.online?'Yes':'No',r.visited_count]),extra:{name:'Site Visits',headers:['FO Code','FO Name','Site Name','Check-In','Check-Out','Status'],rows:siteVisits(report).map(v=>[v.employee_code,v.employee_name,v.site_name,dayTime(v.check_in_time),dayTime(v.check_out_time),v.status])}};
  if(module==='cleaning')return {name:'Deep Cleaning',headers:['Store Code','Store','State','Scheduled','Cleaning Date','Status','Source','FO Code'],rows:(report?.rows||[]).map(r=>[r.store_code||'',r.store_name||'',r.state||'',r.scheduled_date||'',r.deep_cleaning_date||'',r.status||'',r.source_kind||'',r.submitted_by_employee_code||''])};
  if(module==='training-hk')return {name:'HK Training',headers:['Store Code','Store','State','Date','Trainer','Topics','Status'],rows:trainingRows(report).map(r=>[r.store_code||'',r.store_name||'',r.state||'',r.training_date||'',r.trainer_name_snapshot||'',(r.topic_names||[]).join(', '),r.status||''])};
  return {name:'Report',headers:[],rows:[]};
}
async function exportExcel(module,report,state) {
  const {default:ExcelJS}=await import('exceljs');
  const {downloadUnified}=await import('../../utils/retailUnifiedExport.js');
  const book=new ExcelJS.Workbook(),data=excelRows(module,report);
  const sheet=book.addWorksheet(data.name);sheet.addRow(data.headers);
  data.rows.forEach(row=>sheet.addRow(row));
  if(data.extra){const extra=book.addWorksheet(data.extra.name);extra.addRow(data.extra.headers);data.extra.rows.forEach(row=>extra.addRow(row));}
  await downloadUnified(book,'Retail_HK_MIS_'+state+'_'+module+'.xlsx');
}
async function asDataUrl(url) {
  const response=await fetch(url);
  if(!response.ok)throw Error('Photo temporarily unavailable');
  const blob=await response.blob();
  return await new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(Error('Photo unreadable'));reader.readAsDataURL(blob);
  });
}
async function exportPowerPoint(module,report,state,from,to) {
  const {default:PptxGenJS}=await import('pptxgenjs');
  const pptx=new PptxGenJS();pptx.layout='LAYOUT_WIDE';pptx.author='QPMS';
  const records=module==='cleaning'?submittedCleaning(report):trainingRows(report);
  const cover=pptx.addSlide();cover.background={color:'FFFFFF'};
  cover.addText('Reliance Retail · '+(module==='cleaning'?'Deep Cleaning':'HK Training'),{x:.6,y:1.4,w:12,h:.6,fontSize:29,bold:true,color:'183A7A'});
  cover.addText('State: '+state+'   |   '+from+' to '+to+'   |   '+records.length+' submitted reports',
    {x:.6,y:2.4,w:12,h:.4,fontSize:17,color:'4B5563'});
  for(const record of records) {
    const photos=(report.evidence||[]).filter(e=>e.record_id===record.id && e.status==='uploaded');
    for(let offset=0;offset<Math.max(1,photos.length);offset+=4) {
      const slide=pptx.addSlide();slide.background={color:'FFFFFF'};
      slide.addText((record.store_code||record.store_code_snapshot||'Store')+' · '+(record.store_name||record.store_name_snapshot||''),
        {x:.5,y:.35,w:12.2,h:.4,fontSize:18,bold:true,color:'183A7A'});
      const date=record.deep_cleaning_date||record.training_date||record.activity_date||'Not recorded';
      slide.addText('Date: '+date+'   |   Status: '+(record.status||'Not recorded'),
        {x:.5,y:.85,w:12.2,h:.3,fontSize:11,color:'374151'});
      const chunk=photos.slice(offset,offset+4);
      if(!chunk.length)slide.addText('No uploaded photo evidence.',{x:.7,y:2,w:11.7,h:.4,fontSize:16});
      for(let i=0;i<chunk.length;i++) {
        const e=chunk[i],x=.55+(i%2)*6.35,y=1.35+Math.floor(i/2)*2.9;
        try {
          const path=e.existing
            ? '/existing-evidence/'+module+'/'+encodeURIComponent(e.record_id)+'/'+encodeURIComponent(e.id)
            : '/evidence/'+encodeURIComponent(e.id);
          const signed=await api(path);
          if(!signed?.url?.startsWith('https://'))throw Error('Private photo unavailable');
          slide.addImage({data:await asDataUrl(signed.url),x,y,w:5.8,h:2.48,sizingCrop:true});
        } catch {
          slide.addText('Photo temporarily unavailable',{x,y,w:5.8,h:2.4,fontSize:12,color:'6B7280'});
        }
        slide.addText(e.topic_name||('Photo '+(offset+i+1)),{x,y:y+2.52,w:5.8,h:.25,fontSize:10});
      }
    }
  }
  await pptx.writeFile({fileName:'Retail_HK_MIS_'+state+'_'+module+'.pptx'});
}
export default function RetailHkMisWorkspace() {
  const {module}=useParams();
  const [access,setAccess]=useState(null),[state,setState]=useState('');
  const [from,setFrom]=useState(indiaToday().slice(0,7)+'-01'),[to,setTo]=useState(indiaToday());
  const [data,setData]=useState(null),[loading,setLoading]=useState(false),[exporting,setExporting]=useState(false);
  const [error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  useEffect(()=>{let live=true;
    api('/access').then(v=>{if(live){if(v?.role!=='MIS_HK'||!v.active||!v.states?.length)throw Error('Verified HK MIS assignment required.');setAccess(v);setState(v.states[0]);}})
      .catch(e=>{if(live)setError(e.message);});
    return()=>{live=false;};
  },[]);
  const authorized=Boolean(access?.active&&access.role==='MIS_HK'&&access.states?.includes(state));
  const load=useCallback(async()=>{
    if(module==='dashboard'){
      const monthStart=to.slice(0,7)+'-01';
      const [attendance,cleaning,training]=await Promise.all([
        api('/report/attendance-hk',{from:monthStart,to,state}),
        api('/report/cleaning',{from,to,state}),
        api('/report/training-hk',{from,to,state}),
      ]);
      return {attendance,cleaning,training};
    }
    if(module==='operations')return api('/hk-operations');
    return api('/report/'+module,{from:module==='attendance-hk'?to.slice(0,7)+'-01':from,to,state});
  },[module,from,to,state]);
  useEffect(()=>{
    if(!authorized||!Object.hasOwn(MODULE_LABELS,module))return;
    let live=true;queueMicrotask(()=>{if(live){setData(null);setLoading(true);setError('');}});
    load().then(result=>{if(live)setData(result);}).catch(e=>{if(live)setError(e.response?.data?.message||e.message);})
      .finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[authorized,module,load,refresh]);
  async function download(format){
    if(!data||exporting)return;setExporting(true);setError('');
    try {
      if(format==='xlsx')await exportExcel(module,data,state);
      else await exportPowerPoint(module,data,state,from,to);
    }catch(e){setError(e.message);}finally{setExporting(false);}
  }
  if(!Object.hasOwn(MODULE_LABELS,module))return <p role="alert">This page is not available for HK MIS.</p>;
  return <section className="space-y-5 p-4 text-slate-900 dark:text-slate-100">
    <header className={CARD+' flex flex-wrap items-start justify-between gap-3'}>
      <div><p className="text-xs font-bold uppercase tracking-widest text-blue-600">Reliance Retail / HK MIS</p>
        <h1 className="mt-1 text-2xl font-bold">{MODULE_LABELS[module]}</h1>
        <p className="mt-1 flex items-center gap-1 text-sm text-slate-500"><ShieldCheck size={15}/>State-restricted · View and download only · No edits</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">Authorized State<select className="ml-2 rounded-lg border p-2 text-sm dark:bg-slate-800"
          value={state} onChange={e=>setState(e.target.value)} disabled={!access}>
          {(access?.states||[]).map(s=><option key={s} value={s}>{s}</option>)}
        </select></label>
        {module!=='operations' && <>
          <label className="text-xs">From Month<input className="ml-2 rounded-lg border p-2 text-sm dark:bg-slate-800"
            aria-label="From month" type="month" value={from.slice(0,7)}
            max={to.slice(0,7)} onChange={e=>e.target.value&&setFrom(e.target.value+'-01')}/></label>
          <label className="text-xs">Cutoff<input className="ml-2 rounded-lg border p-2 text-sm dark:bg-slate-800"
            aria-label="Cutoff date" type="date" value={to} min={from} max={indiaToday()} onChange={e=>e.target.value&&setTo(e.target.value)}/></label>
        </>}
        <button className={BUTTON} disabled={loading||!authorized} onClick={()=>setRefresh(x=>x+1)}><RefreshCw size={15}/>Refresh</button>
        {module!=='dashboard'&&<button className={BUTTON} disabled={loading||!data||exporting} onClick={()=>void download('xlsx')}><Download size={15}/>Excel</button>}
        {['cleaning','training-hk'].includes(module) && <button className={BUTTON}
          disabled={loading||!data||exporting} onClick={()=>void download('pptx')}><Download size={15}/>PowerPoint</button>}
      </div>
    </header>
    {error&&<p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">{error}</p>}
    {loading&&<p role="status">Loading your authorized state data…</p>}
    {!loading&&data&&module==='dashboard'&&<ReportSummary {...data}/>}
    {!loading&&data&&module==='operations'&&<OperationsView report={data}/>}
    {!loading&&data&&module==='attendance-hk'&&<AttendanceView report={data}/>}
    {!loading&&data&&['training-hk','cleaning'].includes(module)&&<RecordsView key={module+'-'+state} module={module} report={data}/>}
  </section>;
}
