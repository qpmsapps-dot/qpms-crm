import { octoberRecoveryClaimRows } from '../../backend/services/foOctoberRecoveryClaimRows.js';
export function octoberRecoveryExportRows(dataset = {}) {
  return octoberRecoveryClaimRows(dataset.recovery_adjustments || [], dataset.employee?.full_name || '');
}
