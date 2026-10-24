export function createEmployeeRangeRecalculationRegistry() {
  const active = new Map();

  function start(key, operation) {
    if (!key || typeof operation !== 'function') {
      throw new TypeError('A lock key and operation are required.');
    }
    const existing = active.get(key);
    if (existing) {
      return {
        acquired: false,
        startedAt: existing.startedAt,
        promise: existing.promise,
      };
    }

    const token = Symbol(key);
    const record = {
      token,
      startedAt: Date.now(),
      promise: null,
    };
    const operationPromise = Promise.resolve().then(operation);
    record.promise = operationPromise.finally(() => {
      if (active.get(key)?.token === token) active.delete(key);
    });
    active.set(key, record);
    return {
      acquired: true,
      startedAt: record.startedAt,
      promise: record.promise,
    };
  }

  return {
    start,
    has: (key) => active.has(key),
    size: () => active.size,
  };
}
