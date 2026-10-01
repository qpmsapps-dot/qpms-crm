import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createLatestRequestCoordinator,
  createRequestLoadingOwnership,
} from '../src/utils/latestRequestCoordinator.js';

function deferred() {
  let resolve;
  const promise = new Promise((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function notificationHarness() {
  const coordinator = createLatestRequestCoordinator();
  const loadingOwnership = createRequestLoadingOwnership();
  const state = { loading: false, applied: [], errors: [] };

  async function load({ quiet = false, task }) {
    const loadingClaim = loadingOwnership.begin({ visible: !quiet, inherit: quiet });
    if (!quiet) state.loading = true;
    let shouldFinishLoading = false;
    try {
      const result = await coordinator.run(task, {
        replace: !quiet,
        label: 'hospital-notifications',
      });
      if (result.status !== 'applied') return result.status;
      shouldFinishLoading = true;
      state.applied.push(result.value);
      return result.status;
    } catch (error) {
      shouldFinishLoading = true;
      state.errors.push(error.message);
      return 'error';
    } finally {
      if (shouldFinishLoading && loadingOwnership.release(loadingClaim.releaseToken)) {
        state.loading = false;
      }
    }
  }

  return { coordinator, load, loadingOwnership, state };
}

test('a scheduled tick is skipped while its previous request remains pending', async () => {
  const coordinator = createLatestRequestCoordinator();
  const pending = deferred();
  let calls = 0;
  const first = coordinator.run(async () => {
    calls += 1;
    return pending.promise;
  }, { label: 'scheduled-poll' });

  await Promise.resolve();
  const second = await coordinator.run(async () => {
    calls += 1;
  }, { label: 'scheduled-poll' });
  assert.equal(second.status, 'skipped');
  assert.equal(calls, 1);

  pending.resolve('first');
  assert.deepEqual(await first, { status: 'applied', value: 'first', generation: 1 });
});

test('filter or manual refresh aborts the old generation and only applies the new result', async () => {
  const coordinator = createLatestRequestCoordinator();
  const oldRequest = deferred();
  const oldRun = coordinator.run(async ({ signal }) => {
    await oldRequest.promise;
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return 'old';
  }, { label: 'operations-dashboard' });

  const newRun = coordinator.run(async () => 'new', {
    replace: true,
    label: 'operations-dashboard',
  });
  oldRequest.resolve();

  assert.equal((await oldRun).status, 'aborted');
  assert.deepEqual(await newRun, { status: 'applied', value: 'new', generation: 2 });
});

test('a superseded response cannot apply even when its transport ignores abort', async () => {
  const coordinator = createLatestRequestCoordinator();
  const oldRequest = deferred();
  const oldRun = coordinator.run(async () => {
    await oldRequest.promise;
    return 'old';
  }, { label: 'operations-dashboard' });

  const newRun = coordinator.run(async () => 'new', {
    replace: true,
    label: 'operations-dashboard',
  });
  assert.deepEqual(await newRun, { status: 'applied', value: 'new', generation: 2 });

  oldRequest.resolve();
  assert.equal((await oldRun).status, 'stale');
});

test('cleanup aborts pending work so an unmounted consumer receives no applicable result', async () => {
  const coordinator = createLatestRequestCoordinator();
  const pending = deferred();
  const run = coordinator.run(async ({ signal }) => {
    await pending.promise;
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return 'late';
  }, { label: 'hospital-notifications' });

  coordinator.cancel('hospital-notifications');
  pending.resolve();
  assert.equal((await run).status, 'aborted');
  assert.equal(coordinator.isInFlight(), false);
});

test('manual notification success and failure each release their owned loading state', async () => {
  const success = notificationHarness();
  const successfulLoad = success.load({ quiet: false, task: async () => 'current' });
  assert.equal(success.state.loading, true);
  assert.equal(await successfulLoad, 'applied');
  assert.deepEqual(success.state, { loading: false, applied: ['current'], errors: [] });

  const failure = notificationHarness();
  const failedLoad = failure.load({
    quiet: false,
    task: async () => { throw new Error('network failed'); },
  });
  assert.equal(failure.state.loading, true);
  assert.equal(await failedLoad, 'error');
  assert.deepEqual(failure.state, { loading: false, applied: [], errors: ['network failed'] });
});

test('quiet notification polling stays visually quiet and skips overlap', async () => {
  const harness = notificationHarness();
  const pending = deferred();
  let calls = 0;
  const first = harness.load({
    quiet: true,
    task: async () => { calls += 1; return pending.promise; },
  });
  assert.equal(harness.state.loading, false);

  const second = await harness.load({
    quiet: true,
    task: async () => { calls += 1; return 'overlap'; },
  });
  assert.equal(second, 'skipped');
  assert.equal(calls, 1);
  assert.equal(harness.state.loading, false);

  pending.resolve('quiet-current');
  assert.equal(await first, 'applied');
  assert.deepEqual(harness.state, { loading: false, applied: ['quiet-current'], errors: [] });
});

test('a manual notification refresh supersedes quiet work and exclusively owns loading', async () => {
  const harness = notificationHarness();
  const quietRequest = deferred();
  const quiet = harness.load({
    quiet: true,
    task: async ({ signal }) => {
      await quietRequest.promise;
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return 'old-quiet';
    },
  });
  const manualRequest = deferred();
  const manual = harness.load({
    quiet: false,
    task: async () => manualRequest.promise,
  });
  assert.equal(harness.state.loading, true);

  quietRequest.resolve();
  assert.equal(await quiet, 'aborted');
  assert.equal(harness.state.loading, true);
  assert.deepEqual(harness.state.applied, []);

  manualRequest.resolve('manual-current');
  assert.equal(await manual, 'applied');
  assert.deepEqual(harness.state, { loading: false, applied: ['manual-current'], errors: [] });
});

test('a current-user quiet replacement releases loading inherited from an aborted manual request', async () => {
  const harness = notificationHarness();
  const oldRequest = deferred();
  const oldManual = harness.load({
    quiet: false,
    task: async ({ signal }) => {
      await oldRequest.promise;
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return 'old-user';
    },
  });
  assert.equal(harness.state.loading, true);

  harness.coordinator.cancel('hospital-notifications');
  const replacement = harness.load({ quiet: true, task: async () => 'current-user' });
  oldRequest.resolve();

  assert.equal(await oldManual, 'aborted');
  assert.equal(await replacement, 'applied');
  assert.deepEqual(harness.state, { loading: false, applied: ['current-user'], errors: [] });
});

test('an older manual generation cannot clear a newer manual loading owner', async () => {
  const harness = notificationHarness();
  const oldRequest = deferred();
  const oldManual = harness.load({
    quiet: false,
    task: async () => {
      await oldRequest.promise;
      return 'old-manual';
    },
  });
  const newRequest = deferred();
  const newManual = harness.load({
    quiet: false,
    task: async () => newRequest.promise,
  });

  oldRequest.resolve();
  assert.equal(await oldManual, 'stale');
  assert.equal(harness.state.loading, true);
  assert.deepEqual(harness.state.applied, []);

  newRequest.resolve('new-manual');
  assert.equal(await newManual, 'applied');
  assert.deepEqual(harness.state, { loading: false, applied: ['new-manual'], errors: [] });
});

test('logout clears orphaned loading while unmount cancellation applies no stale state', async () => {
  const harness = notificationHarness();
  const pending = deferred();
  const manual = harness.load({
    quiet: false,
    task: async ({ signal }) => {
      await pending.promise;
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return 'late';
    },
  });
  assert.equal(harness.state.loading, true);

  harness.coordinator.cancel('hospital-notifications');
  if (harness.loadingOwnership.clear()) harness.state.loading = false;
  pending.resolve();

  assert.equal(await manual, 'aborted');
  assert.deepEqual(harness.state, { loading: false, applied: [], errors: [] });
});

test('Operations and Navbar wire polling through the shared coordinator and abortable requests', async () => {
  const [operations, navbar, hospitalApi] = await Promise.all([
    readFile(new URL('../src/pages/FOActivities.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/Navbar.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/hospitalTicketsApi.js', import.meta.url), 'utf8'),
  ]);

  assert.match(operations, /dashboardRequestCoordinator\.isInFlight\(\)/);
  assert.match(operations, /requestCoordinator\.run\([\s\S]*\{ signal \}[\s\S]*authenticatedFetch\([\s\S]*\{ signal \}/);
  assert.match(operations, /\{ replace: true, label: 'operations-dashboard' \}/);
  assert.match(operations, /requestCoordinator\.cancel\('operations-dashboard'\)/);
  assert.match(operations, /onClick=\{\(\) => setRefreshToken\(\(value\) => value \+ 1\)\}/);

  assert.match(navbar, /notificationRequestCoordinator\.run/);
  assert.match(navbar, /notificationLoadingOwnership\.begin/);
  assert.match(navbar, /notificationLoadingOwnership\.release\(loadingClaim\.releaseToken\)/);
  assert.match(navbar, /notificationLoadingOwnership\.clear\(\)/);
  assert.match(navbar, /function handleLogout\(\)[\s\S]*notificationRequestCoordinator\.cancel\('hospital-notifications'\)/);
  assert.match(navbar, /\{ replace: !quiet, label: 'hospital-notifications' \}/);
  assert.match(navbar, /notificationRequestCoordinator\.cancel\('hospital-notifications'\)/);
  assert.match(navbar, /function handleNotificationsToggle\(\)[\s\S]*loadNotifications\(\)/);
  assert.match(hospitalApi, /getHospitalTicketNotifications\(\{ signal \} = \{\}\)/);
  assert.match(hospitalApi, /url: '\/api\/hospital-tickets\/notifications',[\s\S]*signal/);
});
