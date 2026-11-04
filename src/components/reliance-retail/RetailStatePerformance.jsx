import {RETAIL_STATE_ORDER,retailPercent} from '../../utils/retailStatePerformance.js';
import './retailReport.css';
const fmt=n=>Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:1});

/**
 * At-a-glance state reporting before the module's existing detailed records.
 * Counts may include Excel-reported entries, but verified work stays a separate
 * field. Missing denominators are N/A, never an invented 0% completion.
 */
export default function RetailStatePerformance({
 title='State-wise performance',summary,columns=[
  {key:'scheduled',label:'Scheduled'},{key:'completed',label:'Completed'},
  {key:'pending',label:'Pending'},{key:'percentage',label:'Completion',rate:true}
 ],note='',onState,selectedState=''
}){
 const rows=summary?.rows||RETAIL_STATE_ORDER.map(s=>({state:s.code,label:s.label}));
 const total=summary?.total||{};
 const render=(row,col)=>{
  if(col.rate){const value=row.percentage??retailPercent(row.completed,row.scheduled);
   return value==null?<span className="retail-state-muted">N/A</span>:
    <span className="retail-state-rate"><strong>{fmt(value)}%</strong><span className="retail-state-track" aria-hidden="true">
     <span style={{width:`${Math.min(100,Math.max(0,value))}%`}}/></span></span>;
  }
  return row[col.key]==null?'—':fmt(row[col.key]);
 };
 return <section className="retail-report-panel retail-state-performance" aria-label={title}>
  <div className="retail-report-panel-heading"><h2>{title}</h2><span>Six reporting states · {summary?'Source-based':'Not loaded'}</span></div>
  <div className="retail-report-table" role="region" aria-label={title+' table'} tabIndex={0}>
   <table><thead><tr><th scope="col">State</th>{columns.map(col=><th scope="col" key={col.key}>{col.label}</th>)}</tr></thead>
    <tbody>{rows.map(row=><tr key={row.state} className={selectedState===row.state?'retail-state-selected':''}>
     <th scope="row">{onState?<button type="button" className="retail-report-link" onClick={()=>onState(selectedState===row.state?'':row.state)} title={`Filter details to ${row.label}`}>{row.label}</button>:row.label}</th>
     {columns.map(col=><td key={col.key}>{render(row,col)}</td>)}
    </tr>)}</tbody>
    <tfoot><tr><th scope="row">Total</th>{columns.map(col=><td key={col.key}>{render(total,col)}</td>)}</tr></tfoot>
   </table>
  </div>
  {note&&<p className="retail-state-footnote">{note}</p>}
 </section>;
}
