export const BUSINESS_DEVELOPMENT_CAPABILITIES = Object.freeze({
  HEAD: 'BD_HEAD',
  EXECUTIVE: 'BD_EXECUTIVE',
});

export const BUSINESS_DEVELOPMENT_PROFILE_ROLES = Object.freeze([
  'Business Development Head',
  'Business Development Executive',
  'BD Head',
  'BD Executive',
]);

function roleKey(value = '') {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

export function normalizeBusinessDevelopmentCapability(value) {
  const key = roleKey(value);
  if (['BUSINESSDEVELOPMENTHEAD', 'BDHEAD'].includes(key)) {
    return BUSINESS_DEVELOPMENT_CAPABILITIES.HEAD;
  }
  if (['BUSINESSDEVELOPMENTEXECUTIVE', 'BDEXECUTIVE'].includes(key)) {
    return BUSINESS_DEVELOPMENT_CAPABILITIES.EXECUTIVE;
  }
  return null;
}

export function canonicalBusinessDevelopmentRoleLabel(value) {
  const capability = normalizeBusinessDevelopmentCapability(value);
  if (capability === BUSINESS_DEVELOPMENT_CAPABILITIES.HEAD) return 'Business Development Head';
  if (capability === BUSINESS_DEVELOPMENT_CAPABILITIES.EXECUTIVE) return 'Business Development Executive';
  return null;
}

export function isBusinessDevelopmentRole(value) {
  return normalizeBusinessDevelopmentCapability(value) !== null;
}
