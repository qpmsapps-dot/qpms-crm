import { reportingState, validDate } from '../../backend/shared/retailAttendance.js';

const states = new Set(['TN', 'KN', 'KL', 'AP-1', 'AP-2', 'TG']);
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
// Filter context only: never an authorization grant or a replacement for module rules.
export function readRetailNavigation(locationState, module, today) {
  const v = locationState?.retailExecutiveScope;
  if (!v || v.version !== 1 || v.source !== 'retail-executive-v3' || v.module !== module) return null;
  if (['state', 'store', 'zone'].some(key => v[key] != null && typeof v[key] !== 'string')) return null;
  try {
    validDate(v.from); validDate(v.to); validDate(today);
    if (v.from > v.to || v.to > today || v.month !== v.from.slice(0, 7) || v.to.slice(0, 7) !== v.month) return null;
    if (v.state && !states.has(reportingState(v.state))) return null;
    if (v.store && !id(v.store) || v.zone && !id(v.zone)) return null;
    if (module === 'maintenance' && !['CM', 'PM'].includes(v.kind)) return null;
    if (['maintenance', 'thermography', 'attendance'].includes(module) && v.from !== v.month + '-01') return null;
    return { month: v.month, from: v.from, to: v.to, state: v.state ? reportingState(v.state) : '', store: v.store || '', zone: module === 'training' ? v.zone || '' : '', kind: v.kind };
  } catch { return null; }
}
export function retailNavigationState(module, scope) {
  const target = module.id === 'cm' || module.id === 'pm' ? 'maintenance' : module.id;
  return { retailExecutiveScope: { ...scope, version: 1, source: 'retail-executive-v3', module: target, ...(target === 'maintenance' ? { kind: module.id.toUpperCase() } : {}) } };
}
