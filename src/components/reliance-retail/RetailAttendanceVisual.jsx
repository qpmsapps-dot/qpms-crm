import {useState} from 'react';
import {Bar,ComposedChart,Line,CartesianGrid,XAxis,YAxis,Tooltip,ResponsiveContainer,Legend} from 'recharts';
import {Activity,ClipboardCheck,Download,Users,Wrench,Target,AlertCircle} from 'lucide-react';
import {STATE_OPTIONS} from '../../../backend/shared/retailAttendance.js';
import {attendanceAopCoverage,attendanceAopValue} from '../../utils/retailAttendanceExport.js';
import './retailAttendanceVisual.css';

const format=n=>n==null||!Number.isFinite(Number(n))?'N/A':Number(n).toLocaleString('en-IN',{maximumFractionDigits:2});
export const attendanceTone=n=>n==null||!Number.isFinite(Number(n))?'unavailable':Number(n)>=90?'good':Number(n)>=85?'watch':'critical';
const asPercent=n=>n==null?'N/A':`${format(n)}%`;
const num=(n)=>n==null?'N/A':format(n);

export function RetailAttendanceTrend({report}){
 const [metric,setMetric]=useState('overall');
 const options=[['overall','Overall'],['hk','HK'],['mepc','MEPC']];
 const data=Array.isArray(report?.trend)?report.trend:[];
 const percentageKey=`${metric}_pct`,actualKey=`${metric==='overall'?'total':metric}_actual`;
 const latest=data.findLast(item=>item[percentageKey]!=null);
 const anyPercentage=data.some(item=>item[percentageKey]!=null);
 const presentDays=data.filter(item=>item.has_attendance_upload).length;
 const latestDate=report?.trend_latest_imported_date||report?.latest_imported_date;
 return <section className="rr-attendance-trend" aria-label="Daily Attendance Trend">
  <div className="rr-attendance-section-header">
   <div className="rr-attendance-heading"><Activity size={18} aria-hidden="true"/><h2>Daily Attendance Trend</h2>
    <span className="rr-attendance-heading-suffix">{report?.cutoff?.slice(0,7)||''}</span></div>
   <div className="rr-attendance-segments" role="group" aria-label="Trend metric">
    {options.map(([key,label])=><button key={key} type="button" aria-pressed={metric===key}
     onClick={()=>setMetric(key)}>{label}</button>)}
   </div>
  </div>
  <div className="rr-attendance-chart-scroll">
   <div className="rr-attendance-chart-area">
    {data.length>0?<ResponsiveContainer width="100%" height={230}>
     <ComposedChart data={data} margin={{top:12,right:25,bottom:4,left:4}}>
      <CartesianGrid stroke="#e8eef8" vertical={false}/>
      <XAxis dataKey="day" tick={{fontSize:10,fill:'#5b6d88'}} tickLine={false}
       axisLine={{stroke:'#d8e3f3'}} interval={data.length>20?2:0}/>
      <YAxis yAxisId="actual" tick={{fontSize:10,fill:'#657590'}} axisLine={false} tickLine={false}
       width={49} allowDecimals={false} tickFormatter={v=>format(v)}/>
      <YAxis yAxisId="percent" orientation="right" domain={[0,v=>Math.max(100,Math.ceil(v/10)*10)]}
       tick={{fontSize:10,fill:'#657590'}} axisLine={false} tickLine={false}
       tickFormatter={v=>`${v}%`} width={46}/>
      <Tooltip formatter={(value,name)=>{
       if(name==='Reported man-days')return [format(value),name];
       return [asPercent(value),name];
      }} labelFormatter={label=>`October ${String(label).padStart(2,'0')}, 2026`}/>
      <Legend verticalAlign="bottom" height={28} iconType="circle" wrapperStyle={{fontSize:11}}/>
      <Bar isAnimationActive={false} name="Reported man-days" yAxisId="actual" dataKey={actualKey}
       fill="#7bb7f6" radius={[3,3,0,0]} maxBarSize={24}/>
      <Line isAnimationActive={false} name="Attendance %" yAxisId="percent" dataKey={percentageKey}
       stroke="#1855b5" strokeWidth={2.5} dot={{r:2.4,fill:'#1855b5'}} connectNulls={false}/>
     </ComposedChart>
    </ResponsiveContainer>:<p role="status" className="rr-attendance-empty">No recorded attendance trend for this period.</p>}
   </div>
  </div>
  <div className="rr-attendance-trend-footer">
   <span>{presentDays}/{data.length} days contain uploaded attendance · Last imported: {latestDate||'Not available'}</span>
   <strong className={`rr-attendance-trend-last tone-${attendanceTone(latest?.[percentageKey])}`}>
    {anyPercentage?`Latest verified ${asPercent(latest[percentageKey])}`:'Verified daily attendance % unavailable'}
   </strong>
  </div>
  {!anyPercentage&&data.length>0&&<p className="rr-attendance-chart-note">Blue bars show actual uploaded credits. The percentage line appears only when approved AOP and attendance coverage are complete; missing days are not treated as absences.</p>}
 </section>;
}

export function RetailAttendanceKpis({report}){
 const total=report.total||{},aop=attendanceAopCoverage(report);
 const aopValue=aop.configured?format(aop.total_aop):'N/A';
 const cards=[
  {title:'Configured AOP',value:aopValue,icon:Users,hint:`HK ${format(aop.hk_aop)} · MEPC ${format(aop.mepc_aop)}`,kind:'aop'},
  {title:'Actual Man-days',value:format(total.total_actual),icon:ClipboardCheck,
   hint:`HK ${format(total.hk_actual)} · MEPC ${format(total.mepc_actual)}`,kind:'actual'},
  {title:'Overall Attendance',value:asPercent(total.overall_pct),icon:Target,
   hint:total.overall_pct==null?'Coverage incomplete':'Against approved target',kind:'rate'},
  {title:'HK Attendance',value:asPercent(total.hk_pct),icon:Users,
   hint:`${format(total.hk_actual)} / ${total.hk_pct==null?'N/A':format(total.hk_target)}`,kind:'hk'},
  {title:'MEPC Attendance',value:asPercent(total.mepc_pct),icon:Wrench,
   hint:`${format(total.mepc_actual)} / ${total.mepc_pct==null?'N/A':format(total.mepc_target)}`,kind:'mepc'}
 ];
 return <section className="rr-attendance-kpi-grid" aria-label="Attendance KPIs">
  {cards.map(({title,value,icon:Icon,hint,kind})=>{
   const rate=kind==='rate'?total.overall_pct:kind==='hk'?total.hk_pct:kind==='mepc'?total.mepc_pct:null;
   return <article className={`rr-attendance-kpi rr-attendance-kpi-${kind}`} key={title}>
    <div className="rr-attendance-kpi-label"><span className="rr-attendance-kpi-icon"><Icon size={18}/></span><span>{title}</span></div>
    <strong className={rate!=null?`tone-${attendanceTone(rate)}`:''}>{value}</strong>
    <small>{hint}</small>
   </article>;
  })}
 </section>;
}

export function RetailAttendanceSummary({report,onState,onExport}){
 const [detailed,setDetailed]=useState(false);
 const rows=[...(report.states||[])].sort((a,b)=>STATE_OPTIONS.indexOf(a.state)-STATE_OPTIONS.indexOf(b.state));
 const total=report.total||{};
 const col=detailed?[
  ['state','State'],['hk_aop','HK AOP'],['mepc_aop','MEPC AOP'],['total_aop','Total AOP'],
  ['hk_actual','HK actual'],['mepc_actual','MEPC actual'],['total_actual','Total actual'],
  ['hk_pct','HK %'],['mepc_pct','MEPC %'],['overall_pct','Overall %']
 ]:[
  ['state','State'],['total_actual','Digital attendance'],['total_target','AOP man-days'],['overall_pct','Attendance %']
 ];
 const cell=(row,key)=>{
  if(key==='state')return row.state==='Grand Total'?row.state:<button type="button"
   className="rr-attendance-state-link" onClick={()=>onState?.(row.state)}>{row.state}</button>;
  if(key.endsWith('_pct'))return <span className={`rr-attendance-badge tone-${attendanceTone(row[key])}`}>{asPercent(row[key])}</span>;
  if(key.includes('aop'))return num(attendanceAopValue(report,row,key));
  if(key.includes('target')&&row.missing_aop?.length)return 'N/A';
  return num(row[key]);
 };
 return <section className="rr-attendance-state" aria-label="State-wise Summary">
  <div className="rr-attendance-section-header">
   <div className="rr-attendance-heading"><Users size={18}/><h2>State-wise Summary</h2></div>
   <div className="rr-attendance-table-actions">
    <div className="rr-attendance-segments rr-attendance-mode" role="group" aria-label="State summary view">
     <button type="button" aria-pressed={!detailed} onClick={()=>setDetailed(false)}>Summary</button>
     <button type="button" aria-pressed={detailed} onClick={()=>setDetailed(true)}>Detailed</button>
    </div>
    <button type="button" onClick={()=>onExport('states')} className="rr-attendance-export"><Download size={14}/>Export</button>
   </div>
  </div>
  <div className="rr-attendance-table-scroll">
   <table className="rr-attendance-state-table">
    <thead><tr>{col.map(([key,label])=><th key={key} scope="col">{label}</th>)}</tr></thead>
    <tbody>{[...rows,total].map((row,index)=><tr key={row.state||index} className={index===rows.length?'rr-attendance-total':''}>
     {col.map(([key])=><td key={key} className={key==='state'?'rr-attendance-state-col':''}>{cell(row,key)}</td>)}
    </tr>)}</tbody>
   </table>
  </div>
  <p className="rr-attendance-table-footnote">Select a state to view store-level details. N/A indicates missing approved AOP or incomplete attendance coverage, not zero attendance.</p>
 </section>;
}
