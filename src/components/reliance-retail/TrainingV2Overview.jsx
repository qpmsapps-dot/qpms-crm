import { createElement } from 'react';
import { CalendarDays, UsersRound, Paintbrush, Settings, ChartNoAxesColumn, Zap, CheckCircle2, Images, Clock3 } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList } from 'recharts';
const percentage = (n, total) => total ? Math.round(n / total * 1000) / 10 + '%' : 'N/A';
export default function TrainingV2Overview({
  data,
  available
}) {
  const value = n => available ? n.toLocaleString('en-IN') : 'N/A';
  const items = [['Total Sessions', value(data.total), 'HK + MEPC', CalendarDays, 'blue'], ['Total Attendees', data.attendeeCoverage ? value(data.attendees) : 'N/A', data.attendeeCoverage + '/' + data.total + ' sessions have recorded counts', UsersRound, 'green'], ['HK Training', value(data.hk), 'Sessions', Paintbrush, 'blue', available ? percentage(data.hk, data.total) : null], ['MEPC Training', value(data.mepc), 'Sessions', Settings, 'purple', available ? percentage(data.mepc, data.total) : null]];
  return <><div className="dc-kpis">{items.map(([title, number, note, Icon, tone, badge]) => <article key={title} className={'dc-kpi dc-' + tone}><span className="dc-kpi-icon">{createElement(Icon, {
            size: 24
          })}</span><div><h2>{title}</h2><strong>{number}</strong><small>{note}</small></div>{badge && <span className="dc-kpi-badge">{badge}</span>}{createElement(Icon, {
          className: 'dc-kpi-watermark',
          'aria-hidden': true
        })}</article>)}</div><div className="dc-performance"><section className="dc-card" aria-label="State-wise Training performance"><div className="dc-card-heading"><h2><ChartNoAxesColumn size={18} />State-wise Training Performance</h2><div className="dc-legend"><span><i className="dc-blue-key" />HK Sessions</span><span><i className="dc-green-key" />MEPC Sessions</span></div></div>{available ? <div className="dc-chart" role="img" aria-label={data.summary.rows.map(r => r.label + ': ' + r.hk_total + ' HK, ' + r.mepc_total + ' MEPC').join('; ')}><ResponsiveContainer width="100%" height="100%"><BarChart data={data.summary.rows} margin={{
              top: 22,
              right: 12,
              bottom: 0,
              left: -20
            }} accessibilityLayer><CartesianGrid vertical={false} stroke="#e6edf8" /><XAxis dataKey="label" tickLine={false} tick={{
                fontSize: 10
              }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{
                fontSize: 10
              }} /><Tooltip contentStyle={{
                fontSize: 12,
                borderRadius: 8
              }} /><Bar dataKey="hk_total" name="HK Sessions" fill="#4d82f7" radius={[3, 3, 0, 0]} maxBarSize={32} isAnimationActive={false}><LabelList dataKey="hk_total" position="top" fill="#182853" fontSize={10} /></Bar><Bar dataKey="mepc_total" name="MEPC Sessions" fill="#26c866" radius={[3, 3, 0, 0]} maxBarSize={32} isAnimationActive={false}><LabelList dataKey="mepc_total" position="top" fill="#182853" fontSize={10} /></Bar></BarChart></ResponsiveContainer></div> : <p className="dc-empty">Training statistics unavailable.</p>}</section><aside className="dc-card dc-insights"><div className="dc-card-heading"><h2><Zap size={17} />Quick Insights</h2></div>{[[CheckCircle2, value(data.total) + ' Sessions', 'HK + MEPC sessions', 'green'], [UsersRound, data.attendeeCoverage ? value(data.attendees) + ' Attendees' : 'Unavailable', 'Counts in ' + data.attendeeCoverage + '/' + data.total + ' sessions', 'blue'], [Images, data.total > 0 && data.unknownEvidence === data.total ? 'Unavailable' : value(data.withEvidence) + ' with evidence', 'Evidence unknown: ' + data.unknownEvidence, 'blue'], [Clock3, value(data.missingEvidence) + ' required missing', 'Topics unknown: ' + data.unknownTopicMetadata + '; Metadata gaps: ' + data.missingMetadata, 'amber']].map(([Icon, v, n, tone]) => <div className="dc-insight" key={n}><span className={'dc-insight-icon dc-' + tone}>{createElement(Icon, {
              size: 19
            })}</span><div><strong>{v}</strong><small>{n}</small></div></div>)}</aside></div></>;
}
