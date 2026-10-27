import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from 'recharts';
import { REPORTING_STATES, percent } from './ifmsDashboardModel.js';

export function Metric({ label, value }) {
  return <div className="ifms-metric"><strong>{typeof value === 'number' ? value.toLocaleString('en-IN') : value}</strong><span>{label}</span></div>;
}
/** @param {{rows: import('./ifmsDashboardModel.js').OperationsRow[], columns: Array<{key:string,label:string,bar?:boolean,percentage?:boolean}>}} props */
export function StateTable({ rows, columns }) {
  return <div className="ifms-table-wrap"><table><caption className="sr-only">State-wise results</caption><thead><tr><th scope="col">State</th>{columns.map(column => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.state}><th scope="row">{REPORTING_STATES.find(state => state.code === row.state)?.label}</th>{columns.map(column => <td key={column.key}>{column.bar && <span className="ifms-mini-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, row[column.key]))}%` }}/></span>}{row[column.key]}{column.percentage ? '%' : ''}</td>)}</tr>)}</tbody></table>{!rows.length && <p className="ifms-note">No matching reporting states.</p>}</div>;
}
/** @param {{total:number,label:string,segments:Array<{label:string,value:number,color:string}>}} props */
export function OperationsRing({ total, segments, label }) {
  return <div className="ifms-ring-layout"><div className="ifms-ring" role="img" aria-label={total ? segments.map(segment => `${segment.label}: ${segment.value}`).join(', ') : 'No data; neutral empty chart'}>
    {total > 0 ? <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={segments} dataKey="value" nameKey="label" innerRadius="74%" outerRadius="96%" stroke="none" isAnimationActive={false}>{segments.map(segment => <Cell key={segment.label} fill={segment.color}/>)}</Pie><Tooltip/></PieChart></ResponsiveContainer> : <div className="ifms-empty-ring"/>}
    <div className="ifms-ring-center"><strong>{total.toLocaleString('en-IN')}</strong><span>{label}</span>{!total && <small>No data</small>}</div>
  </div><div className="ifms-legend">{segments.map(segment => <div key={segment.label}><span className="ifms-legend-dot" style={{ background: segment.color }}/><span>{segment.label}<strong>{segment.value} <small>({percent(segment.value, total)}%)</small></strong></span></div>)}</div></div>;
}
/** @param {{points:Array<{date:string,percentage:number}>}} props */
export function AttendanceTrend({ points }) {
  return <div className="ifms-trend"><p>Daily attendance trend</p>{points.length ? <ResponsiveContainer width="100%" height={150}><AreaChart data={points}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="date"/><YAxis domain={[0, 100]} unit="%"/><Tooltip/><Area dataKey="percentage" stroke="#16a875" fill="#d4f5e7" isAnimationActive={false}/></AreaChart></ResponsiveContainer> : <div className="ifms-empty-trend"><span>No attendance data</span><small>Daily trend appears when verified records are available</small></div>}</div>;
}
