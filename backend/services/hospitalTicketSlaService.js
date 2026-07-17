import { slaMinutes } from './hospitalTicketWorkflowService.js';

export async function runHospitalSlaWorker(client, { now = new Date() } = {}) {
  const result = await client.rpc('rpc_process_hospital_ticket_sla', {
    p_now: now.toISOString(),
    p_operations_sla_minutes: slaMinutes().operations,
  });
  if (result.error) throw result.error;
  return result.data;
}

export function startHospitalSlaScheduler(client, environment = process.env) {
  if (!client || String(environment.HOSPITAL_SLA_WORKER_ENABLED || 'true').toLowerCase() !== 'true') return null;
  const intervalMs = Math.max(60000, Number(environment.HOSPITAL_SLA_POLL_MS || 60000));
  const timer = setInterval(async () => {
    try {
      const result = await runHospitalSlaWorker(client);
      if ((result?.supervisor_escalations || 0) + (result?.operations_escalations || 0) > 0) {
        console.log('[Hospital Ticketing SLA]', result);
      }
    } catch (error) {
      console.warn('[Hospital Ticketing SLA] worker failed', { code: error?.code || null, message: error?.message || 'unknown' });
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}
