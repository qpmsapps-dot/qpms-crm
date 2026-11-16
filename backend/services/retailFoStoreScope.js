// Store selection scope only: callers must first authorize the authenticated actor.
// Deliberately not shared with management/reporting or other business modules.
export function retailFoStateKey(value) {
  const key = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return ({ TAMILNADU: 'TN', PUDUCHERRY: 'PY', PONDICHERRY: 'PY',
    ANDHRAPRADESH: 'AP', ANDHRAPRADESH1: 'AP1', ANDHRAPRADESH2: 'AP2',
    KN: 'KA', KARNATAKA: 'KA', KERALA: 'KL', TS: 'TG', TELANGANA: 'TG' })[key] || key;
}

const stateValues = {
  TN: ['TN', 'Tamil Nadu'], PY: ['PY', 'Puducherry', 'Pondicherry'],
  AP: ['AP', 'AP-1', 'AP-2', 'Andhra Pradesh', 'Andhra Pradesh - 1', 'Andhra Pradesh - 2'],
  AP1: ['AP-1', 'Andhra Pradesh - 1'], AP2: ['AP-2', 'Andhra Pradesh - 2'],
  KA: ['KA', 'KN', 'Karnataka'], KL: ['KL', 'Kerala'], TG: ['TG', 'TS', 'Telangana'],
};
export function retailFoStateValues(value) {
  return stateValues[retailFoStateKey(value)] || [];
}
export function retailFoStateAllows(scope, state) {
  const key = retailFoStateKey(scope), record = retailFoStateKey(state);
  if (!stateValues[key]) return false;
  return key === 'AP' ? ['AP', 'AP1', 'AP2'].includes(record) : key === record;
}
export function retailFoRequiresZone(state) {
  // Unknown/unassigned state fails closed; it never receives state-wide access.
  return !['TN', 'PY', 'AP', 'AP1', 'AP2', 'KA', 'KL', 'TG'].includes(retailFoStateKey(state));
}
