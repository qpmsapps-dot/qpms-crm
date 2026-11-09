import { useEffect, useState } from 'react';
import { authenticatedApiRequest } from '../../services/api.js';
import { AttendanceLine } from './ExecutiveCharts.jsx';
import { number } from '../../utils/retailExecutiveReport.js';
import { Empty } from './ExecutiveReportUi.jsx';

export default function ExecutiveAttendanceTrend({ cutoff, state, store, refresh, metric, onMetric, attendance, reduced }) {
  const [loaded, setLoaded] = useState(null);
  const key = JSON.stringify([cutoff, state, store, refresh]);
  useEffect(() => {
    if (!cutoff || store) return;
    let live = true;
    const controller = new AbortController();
    authenticatedApiRequest({ url: '/api/reliance-retail/attendance/summary', params: { cutoff, view: 'mtd', state }, signal: controller.signal }).then(response => {
      const report = response.data?.report;
      if (report?.cutoff !== cutoff || !Array.isArray(report.trend)) throw Error('Daily trend identity or coverage unavailable.');
      if (live) setLoaded({ key, report });
    }).catch(e => { if (live) setLoaded({ key, error: e.response?.data?.message || e.message }); });
    return () => { live = false; controller.abort(); };
  }, [key, cutoff, state, store, refresh]);
  const report = loaded?.key === key ? loaded.report : null;
  const value = metric === 'overall' ? attendance.value : attendance[metric];
  return <><div className="er-subheading"><h3>Attendance Trend</h3><select aria-label="Attendance class" value={metric} onChange={e => onMetric(e.target.value)}><option value="overall">Overall</option><option value="hk">HK</option><option value="mepc">MEPC</option></select></div><div className="er-period-value">{number(value)}{value == null ? '' : '%'}<small>Selected-period weighted attendance</small></div>
    {report ? <AttendanceLine trend={report.trend} metric={metric} reduced={reduced} /> : <Empty>{store ? 'Per-store daily trend is not supported by this endpoint.' : loaded?.key === key && loaded.error ? loaded.error : 'Loading approved daily attendance trend...'}</Empty>}
    <p className="er-note">Missing observations remain gaps. Source latest imported date: {report?.trend_latest_imported_date || report?.latest_imported_date || 'unavailable'}. {attendance.reason}</p></>;
}
