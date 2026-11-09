import { createElement } from 'react';
import { CalendarDays, CheckCircle2, Clock3, ChartNoAxesColumn, ChartSpline, Lightbulb, TrendingUp, Store } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, LabelList } from 'recharts';
const percent = value => value == null ? 'N/A' : value + '%';
function PercentageLabel({
  x,
  value
}) {
  return <text x={x} y={12} textAnchor="middle" fill={value == null ? '#64748b' : value >= 90 ? '#15803d' : value >= 85 ? '#946200' : '#b42332'} fontSize={11} fontWeight={750}>{percent(value)}</text>;
}
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
  available
}) {
  const {
    total,
    rows
  } = view.summary;
  const val = n => available ? n.toLocaleString('en-IN') : 'N/A';
  const items = [{
    label: 'Scheduled',
    value: val(total.scheduled),
    note: 'Stores / visits',
    Icon: CalendarDays,
    tone: 'blue'
  }, {
    label: 'Completed',
    value: val(total.completed),
    note: 'Verified linked completions',
    badge: available ? percent(total.percentage) : null,
    Icon: CheckCircle2,
    tone: 'green'
  }, {
    label: 'Pending',
    value: val(total.pending),
    note: 'Scheduled work',
    badge: available && total.scheduled ? percent(Math.round(total.pending / total.scheduled * 1000) / 10) : null,
    Icon: Clock3,
    tone: 'amber'
  }, {
    label: 'Completion',
    value: available ? percent(total.percentage) : 'N/A',
    note: 'Comparison unavailable',
    Icon: ChartNoAxesColumn,
    tone: 'blue'
  }];
  return <><div className="dc-kpis">{items.map(({
        label,
        value,
        note,
        badge,
        Icon,
        tone
      }) => <article className={'dc-kpi dc-' + tone} key={label}><span className="dc-kpi-icon">{createElement(Icon, {
            size: 23
          })}</span><div><h2>{label}</h2><strong>{value}</strong><small>{note}</small></div>{badge && <span className="dc-kpi-badge">{badge}</span>}{createElement(Icon, {
          className: "dc-kpi-watermark",
          "aria-hidden": true
        })}</article>)}</div>
 <div className="dc-performance"><section className="dc-card dc-chart-card" aria-label="State-wise Deep Cleaning performance"><div className="dc-card-heading"><h2><ChartSpline size={18} />State-wise Deep Cleaning Performance</h2><div className="dc-legend"><span><i className="dc-blue-key" />Scheduled</span><span><i className="dc-green-key" />Completed</span><span><i className="dc-line-key" />Completion %</span></div></div>
  {available ? <><div className="dc-chart" role="img" aria-label={rows.map(r => r.label + ': ' + r.scheduled + ' scheduled, ' + r.completed + ' completed, ' + percent(r.percentage) + ' completion').join('; ')}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} margin={{
                top: 35,
                right: 2,
                left: -23,
                bottom: 0
              }} accessibilityLayer><defs><linearGradient id="dcScheduled" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#86a8ff" /><stop offset="1" stopColor="#2255dc" /></linearGradient><linearGradient id="dcCompleted" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#68d894" /><stop offset="1" stopColor="#16a34a" /></linearGradient></defs><CartesianGrid stroke="#edf1f8" vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={{
                  stroke: '#dae3f3'
                }} tick={{
                  fontSize: 10,
                  fill: '#263861'
                }} interval={0} /><YAxis yAxisId="count" allowDecimals={false} tickLine={false} axisLine={false} tick={{
                  fontSize: 10,
                  fill: '#697a98'
                }} /><YAxis yAxisId="rate" orientation="right" domain={[0, 100]} tickFormatter={v => v + '%'} tickLine={false} axisLine={false} tick={{
                  fontSize: 9,
                  fill: '#697a98'
                }} width={35} /><Tooltip formatter={(value, name) => [name === 'Completion %' ? percent(value) : value, name]} contentStyle={{
                  borderRadius: 10,
                  borderColor: '#dce4f3',
                  fontSize: 12
                }} /><Bar isAnimationActive={false} yAxisId="count" name="Scheduled" dataKey="scheduled" fill="url(#dcScheduled)" radius={[3, 3, 0, 0]} maxBarSize={31}><LabelList dataKey="scheduled" content={<CountLabel />} /></Bar><Bar isAnimationActive={false} yAxisId="count" name="Completed" dataKey="completed" fill="url(#dcCompleted)" radius={[3, 3, 0, 0]} maxBarSize={31}><LabelList dataKey="completed" content={<CountLabel />} /></Bar><Line isAnimationActive={false} yAxisId="rate" name="Completion %" dataKey="percentage" stroke="#1747ef" strokeWidth={2} dot={{
                  r: 3,
                  fill: '#1747ef',
                  stroke: '#fff',
                  strokeWidth: 1
                }} connectNulls={false}><LabelList dataKey="percentage" content={<PercentageLabel />} /></Line></ComposedChart></ResponsiveContainer></div><div className="dc-zero-states">{rows.filter(r => r.percentage == null).map(r => <span key={r.state}>{r.label}: N/A</span>)}</div></> : <p className="dc-empty">Schedule reporting unavailable.</p>}
 </section><aside className="dc-card dc-insights"><div className="dc-card-heading"><h2><Lightbulb size={17} />Quick Insights</h2></div>{[{
          Icon: TrendingUp,
          tone: 'green',
          value: 'Unavailable',
          label: 'Monthly comparison'
        }, {
          Icon: CheckCircle2,
          tone: 'green',
          value: val(total.completed) + ' visits',
          label: 'Verified linked completions'
        }, {
          Icon: Clock3,
          tone: 'amber',
          value: val(total.pending) + ' visits',
          label: 'Pending completion'
        }, {
          Icon: Store,
          tone: 'red',
          value: val(view.overdue) + ' visits',
          label: 'Overdue schedules'
        }].map(({
          Icon,
          tone,
          value,
          label
        }) => <div className="dc-insight" key={label}><span className={'dc-insight-icon dc-' + tone}>{createElement(Icon, {
              size: 19
            })}</span><div><strong>{value}</strong><small>{label}</small></div></div>)}</aside></div></>;
}
