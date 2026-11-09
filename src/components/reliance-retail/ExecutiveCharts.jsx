import { useEffect, useRef, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { number, stateName } from '../../utils/retailExecutiveReport.js';

function useEntry(reduced, available = true) {
  const ref = useRef(null), [entered, setEntered] = useState(false);
  useEffect(() => {
    if (reduced || !('IntersectionObserver' in window)) { queueMicrotask(() => setEntered(true)); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setEntered(true); observer.disconnect(); } }, { threshold: 0.1 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [reduced, available]);
  return [ref, entered];
}
export function AttendanceLine({ trend, metric, reduced }) {
  const data = trend.map(r => ({ date: r.date, value: r.complete && Number.isFinite(r[metric + '_pct']) ? r[metric + '_pct'] : null }));
  const [ref, entered] = useEntry(reduced, data.some(r => r.value != null));
  if (!data.some(r => r.value != null)) return <p className="er-empty">No complete daily attendance observations in this period.</p>;
  return <div className="er-chart er-line-chart" ref={ref} role="img" aria-label={data.map(r => `${r.date}: ${number(r.value)}${r.value == null ? '' : '%'}`).join('; ')}><ResponsiveContainer width="100%" height="100%"><LineChart data={entered ? data : []} margin={{ left: -23, right: 12, top: 10 }}><CartesianGrid vertical={false} stroke="#edf0f6" /><XAxis dataKey="date" tickFormatter={d => d.slice(8)} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} /><YAxis tickFormatter={v => v + '%'} tick={{ fontSize: 9 }} axisLine={false} tickLine={false} /><Tooltip labelFormatter={v => v} formatter={v => number(v) + '%'} /><Line dataKey="value" name={metric + ' attendance'} type="monotone" stroke="#7950e7" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={!reduced} animationDuration={650} /></LineChart></ResponsiveContainer></div>;
}
export function StateBars({ rows, metric = 'attendance', reduced }) {
  const data = rows.map(r => ({ name: stateName(r.state), value: r.modules[metric].value }));
  const [ref, entered] = useEntry(reduced, data.some(d => Number.isFinite(d.value)));
  if (!data.some(d => Number.isFinite(d.value))) return <p className="er-empty">Comparable state values unavailable.</p>;
  return <div className="er-chart" ref={ref} role="img" aria-label={data.map(d => `${d.name}: ${number(d.value)}`).join('; ')}><ResponsiveContainer width="100%" height="100%"><BarChart data={entered ? data : []} margin={{ left: -20, right: 12, top: 15 }}><CartesianGrid vertical={false} stroke="#edf0f6" /><XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} /><YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} /><Tooltip formatter={v => number(v)} /><Bar dataKey="value" name="Reported value" fill="#5865e9" radius={[4, 4, 0, 0]} maxBarSize={32} isAnimationActive={!reduced} animationDuration={650} /></BarChart></ResponsiveContainer></div>;
}
export function CompletionRing({ metric, title, reduced }) {
  const [ref, entered] = useEntry(reduced);
  const value = metric.value;
  return <div className="er-ring-group" ref={ref}><div className="er-ring" role="img" aria-label={`${title}: ${number(value)}${value == null ? '' : '%'} completion`}>
    {metric.segments?.some(s => s.value > 0) ? <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={entered ? metric.segments.filter(s => s.value > 0) : []} dataKey="value" innerRadius="76%" outerRadius="96%" startAngle={90} endAngle={-270} stroke="none" isAnimationActive={!reduced} animationDuration={700}>{metric.segments.filter(s => s.value > 0).map(s => <Cell key={s.name} fill={s.color} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer> : <svg viewBox="0 0 100 100" aria-hidden="true"><circle className="er-ring-track" cx="50" cy="50" r="43" /><circle className="er-ring-fill" cx="50" cy="50" r="43" style={{ '--er-ring': value == null ? 0 : Math.max(0, Math.min(value, 100)) }} /></svg>}
    <div><strong>{number(value)}{value == null ? '' : '%'}</strong><small>{title}</small></div></div></div>;
}
