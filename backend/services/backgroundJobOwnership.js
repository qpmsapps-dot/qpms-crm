import { randomUUID } from 'node:crypto';

// Each process has its own identity. Only end_day_km uses expiring ownership;
// unrelated background workers retain the existing v1 contract.
const owner = randomUUID();
const active = new Set();
let draining = false;
const KM_JOB = 'end_day_km';
const KM_HEARTBEAT_INTERVAL_MS = 30000;
const KM_MAX_WORK_MS = 150000;
const RELEASE_RETRY_DELAYS_MS = [0, 250, 1000, 2500];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function runOwnedBackgroundJob(client, job, work, options = {}) {
  if (draining) return Promise.resolve({ ran: false, reason: 'process_draining' });
  const task = executeOwnedJob(client, job, work, options);
  active.add(task);
  task.then(() => active.delete(task), () => active.delete(task));
  return task;
}

export async function drainBackgroundJobs() {
  draining = true;
  await Promise.allSettled([...active]);
}

async function releaseWithRetries(client, rpc, args, logger, { delays = RELEASE_RETRY_DELAYS_MS, wait = sleep } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt] > 0) await wait(delays[attempt]);
    try {
      const result = await client.rpc(rpc, args);
      if (!result?.error && result?.data === true) return true;
      // A confirmed false means the token is no longer ours. Do not overwrite it.
      if (!result?.error && result?.data === false) return false;
      lastError = result?.error || new Error('Ownership release returned no confirmation.');
    } catch (error) {
      lastError = error;
    }
  }
  logger.error('[Worker ownership] Release RPC repeatedly failed; bounded lease will expire.', {
    job: args.p_job, code: lastError?.code || 'release_unconfirmed',
  });
  return false;
}

async function executeOwnedJob(client, job, work, {
  slot = null, logger = console,
  kmHeartbeatIntervalMs = KM_HEARTBEAT_INTERVAL_MS,
  kmMaxWorkMs = KM_MAX_WORK_MS,
  releaseRetryDelaysMs = RELEASE_RETRY_DELAYS_MS,
  wait = sleep,
} = {}) {
  const isKm = job === KM_JOB;
  const token = randomUUID();
  const args = { p_job: job, p_owner: owner, p_token: token, p_slot: slot };
  let claim;
  try {
    claim = await client.rpc(isKm ? 'rpc_worker_claim_km_v2' : 'rpc_worker_claim_v1', args);
  } catch {
    return { ran: false, reason: 'ownership_unavailable' };
  }
  if (claim?.error || claim?.data !== true) {
    return { ran: false, reason: claim?.error ? 'ownership_unavailable' : 'standby_or_busy' };
  }

  const controller = new AbortController();
  let renewalInProgress = false;
  let lastRenewedAt = Date.now();
  let heartbeatTimer = null;
  let deadlineTimer = null;
  let value;
  let workError;

  if (isKm) {
    const heartbeat = async () => {
      if (renewalInProgress || controller.signal.aborted) return;
      renewalInProgress = true;
      try {
        const renewed = await client.rpc('rpc_worker_renew_km_v2', {
          p_job: job, p_owner: owner, p_token: token,
        });
        if (!renewed?.error && renewed?.data === true) lastRenewedAt = Date.now();
        else if (!renewed?.error && renewed?.data === false) controller.abort('km_worker_lease_lost');
        // A transport error may be temporary (e.g. Supabase restart). Retry on the next tick.
      } catch {
        // The DB lease itself has a hard expiry even if all network calls fail.
      } finally {
        renewalInProgress = false;
        if (Date.now() - lastRenewedAt >= 170000 && !controller.signal.aborted) {
          controller.abort('km_worker_lease_unconfirmed');
        }
      }
    };
    heartbeatTimer = setInterval(() => { void heartbeat(); }, Math.max(1, kmHeartbeatIntervalMs));
    heartbeatTimer.unref?.();
    deadlineTimer = setTimeout(() => controller.abort('km_worker_run_deadline'), Math.max(1, kmMaxWorkMs));
    deadlineTimer.unref?.();
  }

  try {
    value = await work({
      signal: controller.signal,
      isLeaseValid: () => !controller.signal.aborted,
    });
    if (controller.signal.aborted) {
      workError = Object.assign(new Error('KM ownership was lost or exceeded its run deadline.'), {
        code: 'km_worker_lease_lost', retryable: true,
      });
    }
  } catch (error) {
    workError = error;
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }

  const released = await releaseWithRetries(
    client,
    isKm ? 'rpc_worker_release_km_v2' : 'rpc_worker_release_v1',
    { p_job: job, p_owner: owner, p_token: token },
    logger,
    { delays: releaseRetryDelaysMs, wait },
  );
  if (!released) {
    logger.error('[Worker ownership] Completion uncertain; operator review if lease recovery fails.', { job });
    throw Object.assign(new Error('Worker ownership release was not confirmed.'), {
      code: 'worker_completion_uncertain', retryable: true,
    });
  }
  if (workError) throw workError;
  return { ran: true, value };
}

export async function ownedJobValue(client, job, work, options) {
  const result = await runOwnedBackgroundJob(client, job, work, options);
  if (!result.ran) throw Object.assign(new Error('Background job is in safe handoff or already running.'), {
    statusCode: 503, code: 'worker_not_owned',
  });
  return result.value;
}

export function startOwnedOnce(client, job, work, {
  schedule = setTimeout, logger = console, retryMs = 10000,
} = {}) {
  let stopped = false;
  let timer;
  const tick = async () => {
    if (stopped) return;
    try {
      const result = await runOwnedBackgroundJob(client, job, work, { logger });
      if (!result.ran && !stopped) {
        timer = schedule(tick, retryMs);
        timer.unref?.();
      }
    } catch (error) {
      logger.error('[Worker ownership] One-time execution requires review.', { job, code: error.code });
    }
  };
  void tick();
  return { stop() { stopped = true; if (timer) clearTimeout(timer); } };
}
