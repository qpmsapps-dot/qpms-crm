// Verified account-specific South-wide Reliance Retail authority.
// This is not an alias for every South Head, GM or other business.
// Backend callers MUST supply the server-verified profile, never client claims.
export const RETAIL_SOUTH_HEAD = Object.freeze({
  profile_id: 'b5089355-b47c-4812-9fe3-292743ae302c',
  auth_user_id: '845323f2-f713-493c-bf70-9d8ae399dfe0',
  employee_code: 'QPMSTNC16972',
});

export function isRetailSouthHead(profile) {
  if (!profile || typeof profile !== 'object') return false;
  const profileId = profile.profileId || profile.id;
  const authId = profile.auth_user_id || (profile.profileId ? profile.id : null);
  const code = profile.employee_code || profile.employeeCode;
  return profileId === RETAIL_SOUTH_HEAD.profile_id
    && authId === RETAIL_SOUTH_HEAD.auth_user_id
    && code === RETAIL_SOUTH_HEAD.employee_code
    && profile.role === 'South Head'
    && profile.business === 'Reliance Retail'
    && String(profile.status || '').toUpperCase() === 'ACTIVE'
    && (profile.is_active === true || profile.isActive === true)
    && (profile.web_access_enabled === true || profile.webAccessEnabled === true);
}
