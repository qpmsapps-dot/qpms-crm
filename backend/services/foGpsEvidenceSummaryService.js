export function startFoGpsEvidenceSummaryWorker(client, environment = process.env, {
  schedule = setInterval, logger = console,
} = {}) {
  if (String(environment.FO_GPS_EVIDENCE_REFRESH_ENABLED || '').toLowerCase() !== 'true') return null;
  if (!client?.rpc) {
    logger.warn('[GPS evidence summaries] service-role client unavailable; worker disabled');
    return null;
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { error, data } = await client.rpc('rpc_refresh_fo_gps_evidence_summaries_v1', { p_limit: 5 });
      if (error || data?.failed) logger.warn('[GPS evidence summaries] refresh incomplete', {
        code: error?.code || 'GPS_EVIDENCE_RETRY_QUEUED',
      });
    } catch {
      logger.warn('[GPS evidence summaries] unavailable; durable queue retained');
    } finally { running = false; }
  };
  const timer = schedule(tick, 60_000);
  timer.unref?.();
  return timer;
}
