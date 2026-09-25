export const ALL_STATES_SCOPE = 'All States';
export const ALL_BUSINESSES_SCOPE = 'All Businesses';

function compact(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

export function isAllStatesScope(value) {
  return ['ALL', 'ALLSTATE', 'ALLSTATES'].includes(compact(value));
}

export function isAllBusinessesScope(value) {
  return ['ALL', 'ALLBUSINESS', 'ALLBUSINESSES'].includes(compact(value));
}

export function normalizeStateScopeValue(value) {
  const text = String(value || '').trim();
  return isAllStatesScope(text) ? ALL_STATES_SCOPE : text;
}

export function normalizeBusinessScopeValue(value) {
  const text = String(value || '').trim();
  return isAllBusinessesScope(text) ? ALL_BUSINESSES_SCOPE : text;
}

export function normalizedStateKey(value) {
  const key = compact(value);
  const aliases = {
    TAMILNADU: 'TN',
    KERALA: 'KL',
    KARNATAKA: 'KA',
    TELANGANA: 'TG',
    ANDHRAPRADESH1: 'AP1',
    ANDHRAPRADESH2: 'AP2',
  };
  return aliases[key] || key;
}

export function stateScopeQueryValues(value) {
  const key = normalizedStateKey(value);
  const values = {
    TN: ['TN', 'Tamil Nadu'],
    KL: ['KL', 'Kerala'],
    KA: ['KA', 'Karnataka'],
    TG: ['TG', 'Telangana'],
    AP1: ['AP-1', 'Andhra Pradesh - 1'],
    AP2: ['AP-2', 'Andhra Pradesh - 2'],
    AP: ['AP', 'AP-1', 'AP-2', 'Andhra Pradesh', 'Andhra Pradesh - 1', 'Andhra Pradesh - 2'],
  };
  return values[key] || (String(value || '').trim() ? [String(value).trim()] : []);
}

export function stateScopeAllows(scopeValue, recordValue) {
  if (isAllStatesScope(scopeValue)) return true;
  const scopeKey = normalizedStateKey(scopeValue);
  const recordKey = normalizedStateKey(recordValue);
  if (!scopeKey || !recordKey) return false;
  if (scopeKey === 'AP') return ['AP', 'AP1', 'AP2'].includes(recordKey);
  return scopeKey === recordKey;
}

export function businessScopeAllows(scopeValue, recordValue) {
  if (isAllBusinessesScope(scopeValue)) return true;
  const scopeKey = compact(scopeValue);
  const recordKey = compact(recordValue);
  return Boolean(scopeKey) && Boolean(recordKey) && scopeKey === recordKey;
}

export function applyStateBusinessScope(query, { state, business } = {}, { requireState = true, requireBusiness = true } = {}) {
  let scoped = query;
  if (!isAllStatesScope(state)) {
    const values = stateScopeQueryValues(state);
    if (!values.length && requireState) scoped = scoped.eq('state', '__NO_STATE_SCOPE__');
    else if (values.length === 1) scoped = scoped.eq('state', values[0]);
    else if (values.length > 1) scoped = scoped.in('state', values);
  }
  if (!isAllBusinessesScope(business)) {
    const value = normalizeBusinessScopeValue(business);
    if (value) scoped = scoped.eq('business', value);
    else if (requireBusiness) scoped = scoped.eq('business', '__NO_BUSINESS_SCOPE__');
  }
  return scoped;
}
