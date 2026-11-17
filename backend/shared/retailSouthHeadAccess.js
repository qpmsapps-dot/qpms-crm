// Reliance Retail reporting hierarchy is role- and verified-scope-based.
// The browser may use this for navigation only; backend authorization must
// additionally check effective DB role/client/state assignments.
const role = value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const retailBusiness = value => ['RELIANCE', 'RELIANCERETAIL'].includes(role(value));

export function retailLeadershipRole(profile) {
  if (!profile || typeof profile !== 'object') return null;
  if (!retailBusiness(profile.business)) return null;
  if (!profile.id || !(profile.auth_user_id || profile.profileId)) return null;
  if (!String(profile.employee_code || profile.employeeCode || '').trim()) return null;
  if (!['ACTIVE'].includes(role(profile.status))) return null;
  if (profile.is_active !== true && profile.isActive !== true) return null;
  if (profile.web_access_enabled !== true && profile.webAccessEnabled !== true) return null;
  const name = profile.rawRole || profile.role;
  if (role(name) === 'SOUTHHEAD') return 'South Head';
  if (role(name) === 'BRANCHHEAD') return 'Branch Head';
  return null;
}
export function isRetailSouthHead(profile) { return retailLeadershipRole(profile) === 'South Head'; }
export function isRetailBranchHead(profile) { return retailLeadershipRole(profile) === 'Branch Head'; }
export function isRetailLeadership(profile) { return retailLeadershipRole(profile) !== null; }
