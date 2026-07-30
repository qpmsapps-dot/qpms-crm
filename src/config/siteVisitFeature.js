const enabledFlag = String(import.meta.env.VITE_SITE_VISIT_V2_ENABLED ?? '')
  .trim()
  .toLowerCase();

export const isSiteVisitV2Enabled = enabledFlag === 'true';
