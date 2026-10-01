function isAbortError(error, signal) {
  return Boolean(
    signal?.aborted ||
    error?.name === 'AbortError' ||
    error?.name === 'CanceledError' ||
    error?.code === 'ERR_CANCELED',
  );
}

export function createRequestLoadingOwnership() {
  let currentOwner = null;
  let nextToken = 0;

  return {
    begin({ visible = false, inherit = false } = {}) {
      nextToken += 1;
      const token = nextToken;
      if (visible) currentOwner = token;
      return {
        releaseToken: visible ? token : inherit ? currentOwner : null,
      };
    },
    release(token) {
      if (token === null || token === undefined || currentOwner !== token) return false;
      currentOwner = null;
      return true;
    },
    clear() {
      const hadOwner = currentOwner !== null;
      currentOwner = null;
      return hadOwner;
    },
  };
}

export function createLatestRequestCoordinator({ debug = () => {} } = {}) {
  let activeRequest = null;
  let generation = 0;

  async function run(task, { replace = false, label = 'poll' } = {}) {
    if (activeRequest && !replace) {
      debug({ event: 'skipped_in_flight', label, generation: activeRequest.generation });
      return { status: 'skipped', generation: activeRequest.generation };
    }

    if (activeRequest) {
      activeRequest.controller.abort();
      debug({ event: 'superseded', label, generation: activeRequest.generation });
    }

    const request = {
      controller: new AbortController(),
      generation: generation + 1,
    };
    generation = request.generation;
    activeRequest = request;

    try {
      const value = await task({
        signal: request.controller.signal,
        generation: request.generation,
      });
      if (activeRequest !== request || request.controller.signal.aborted) {
        debug({ event: 'discarded_stale', label, generation: request.generation });
        return { status: 'stale', generation: request.generation };
      }
      return { status: 'applied', value, generation: request.generation };
    } catch (error) {
      if (isAbortError(error, request.controller.signal)) {
        debug({ event: 'aborted', label, generation: request.generation });
        return { status: 'aborted', generation: request.generation };
      }
      if (activeRequest !== request) {
        debug({ event: 'discarded_stale_error', label, generation: request.generation });
        return { status: 'stale', generation: request.generation };
      }
      throw error;
    } finally {
      if (activeRequest === request) activeRequest = null;
    }
  }

  function cancel(label = 'poll') {
    if (!activeRequest) return;
    const cancelledGeneration = activeRequest.generation;
    activeRequest.controller.abort();
    activeRequest = null;
    generation += 1;
    debug({ event: 'cancelled', label, generation: cancelledGeneration });
  }

  return {
    run,
    cancel,
    isInFlight() {
      return activeRequest !== null;
    },
  };
}
