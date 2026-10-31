const count = value => Number.isFinite(value) && value >= 0;
const counts = (value, keys) => value && keys.every(key => count(value[key]));

// A missing report is unavailable, not an empty operational dataset.
export function isCompleteOperationsReport(report, kind) {
 if(!report || report.status==='unavailable' || typeof report.today!=='string' || !Array.isArray(report.stores) || !report.stores.every(s=>s&&typeof s.id==='string') || !Array.isArray(report.events) || !report.events.every(e=>e&&typeof e==='object'))return false;
 if(kind==='maintenance')return ['cm','pm'].every(key=>{
  const module=report.modules?.[key];
  return module?.status==='ready'&&counts(module.total,['eligible','completed','remaining'])&&Array.isArray(module.stores)&&module.stores.every(s=>s&&typeof s.id==='string')&&Array.isArray(module.rows)&&module.rows.every(r=>r&&counts(r,['completed','remaining']))&&typeof module.window?.start==='string'&&typeof module.window?.end==='string'&&typeof module.window?.open==='boolean';
 });
 return counts(report.total,['scheduled','awaiting','approved','overdue'])&&Array.isArray(report.states)&&report.states.every(r=>r&&counts(r,['scheduled','awaiting','approved','overdue']))&&Array.isArray(report.rows)&&report.rows.every(r=>r&&r.store&&typeof r.store.id==='string');
}
