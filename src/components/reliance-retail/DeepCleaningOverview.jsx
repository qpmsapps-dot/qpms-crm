import { CalendarDays, CheckCircle2 } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList } from 'recharts';
function CountLabel({
  x,
  y,
  width,
  value
}) {
  return value > 0 ? <text x={x + width / 2} y={y - 4} textAnchor="middle" fill="#263f76" fontSize={9} fontWeight={650}>{value}</text> : null;
}
export default function DeepCleaningOverview({
  view,
  available, from, to, today
}) {
  const {
    total,
    rows
  } = view.summary;
  const val = n => available && Number.isFinite(n) ? n.toLocaleString('en-IN') : 'N/A';
  const percentage = available && Number.isFinite(total.percentage) ? total.percentage : null;
  const schedulePercentage = available && Number.isFinite(total.schedule_percentage) ? total.schedule_percentage : null;
  const tillDate = !to || to <= today;
  return <section className="thv2-summary dc-overview" aria-label="Deep Cleaning performance">
    <div className="dc-kpis thv2-kpis">
      <article className="thv2-card thv2-scheduled" data-kpi="scheduled"><CalendarDays aria-hidden="true"/><div><h2>{tillDate?'Scheduled Till Date':'Scheduled in Selected Range'}</h2><strong>{val(total.scheduled)}</strong><small>{from} - {to}</small></div></article>
      <article className="thv2-card thv2-completed" data-kpi="completed"><CheckCircle2 aria-hidden="true"/><div><h2>{tillDate?'Completed Till Date':'Completed in Selected Range'}</h2><strong>{val(total.completed)}</strong><small>Confirmed completed reports / {from} - {to}</small></div></article>
      <article className="thv2-completion"><h2>Completion Percentage</h2><div><strong>{percentage==null?'N/A':percentage.toFixed(1)+'%'}</strong><progress aria-label="Completion percentage" max={Math.max(100,percentage??0)} value={percentage??0}/></div><small>Confirmed completed reports / scheduled jobs</small><small>Verified schedule-linked completion: <b data-kpi="schedule-percentage">{schedulePercentage==null?'N/A':schedulePercentage.toFixed(1)+'%'}</b></small></article>
      <p className="dc-metric-notes"><span>Pending: <b data-kpi="pending">{val(total.pending)}</b></span><span>Submitted reports: <b>{val(total.submitted_reports)}</b></span><span>Overdue: <b>{val(view.overdue)}</b></span></p>
    </div>
    <section className="dc-performance thv2-chart" aria-label="State-wise Deep Cleaning performance"><div className="thv2-chart-head"><h2>State-wise Scheduled vs Completed</h2><span><i className="thv2-blue"/> Scheduled <i className="thv2-green"/> Completed</span></div>
  {available ? <><div className="dc-chart" role="img" aria-label={rows.map(r => r.label + ': ' + r.scheduled + ' scheduled, ' + r.completed + ' completed, ' + (Number.isFinite(r.percentage)?r.percentage+'%':'N/A') + ' completion').join('; ')}><ResponsiveContainer width="100%" height="100%"><BarChart data={rows} margin={{
                top: 20,
                right: 2,
                left: -23,
                bottom: 0
              }} accessibilityLayer><defs><linearGradient id="dcScheduled" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#86a8ff" /><stop offset="1" stopColor="#2255dc" /></linearGradient><linearGradient id="dcCompleted" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#68d894" /><stop offset="1" stopColor="#16a34a" /></linearGradient></defs><CartesianGrid stroke="#edf1f8" vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={{
                  stroke: '#dae3f3'
                }} tick={{
                  fontSize: 10,
                  fill: '#263861'
                }} interval={0} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{
                  fontSize: 10,
                  fill: '#697a98'
                }} /><Tooltip formatter={(value, name) => [value, name]} contentStyle={{
                  borderRadius: 10,
                  borderColor: '#dce4f3',
                  fontSize: 12
                }} /><Bar isAnimationActive={false} name="Scheduled" dataKey="scheduled" fill="url(#dcScheduled)" radius={[3, 3, 0, 0]} maxBarSize={31}><LabelList dataKey="scheduled" content={<CountLabel />} /></Bar><Bar isAnimationActive={false} name="Completed" dataKey="completed" fill="url(#dcCompleted)" radius={[3, 3, 0, 0]} maxBarSize={31}><LabelList dataKey="completed" content={<CountLabel />} /></Bar></BarChart></ResponsiveContainer></div></> : <p className="dc-empty">Schedule reporting unavailable.</p>}
    <p className="dc-chart-note">Scheduled bars show planned jobs; Completed bars show confirmed completed reports. Main completion percentage uses reports / scheduled jobs; verified schedule-linked completion remains separate.</p></section>
  </section>;
}
