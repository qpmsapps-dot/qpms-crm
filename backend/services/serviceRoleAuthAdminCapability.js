export function createServiceRoleAuthAdminCapabilityValidator({
  validate,
  onValidationAttempt = () => {},
} = {}) {
  if (typeof validate !== 'function') {
    throw new TypeError('validate must be a function');
  }

  const stateByClient = new WeakMap();

  function stateFor(client) {
    if (!client || (typeof client !== 'object' && typeof client !== 'function')) {
      return null;
    }
    let state = stateByClient.get(client);
    if (!state) {
      state = {
        validated: false,
        successfulResult: null,
        inFlight: null,
        attempts: 0,
      };
      stateByClient.set(client, state);
    }
    return state;
  }

  async function ensure(client) {
    const state = stateFor(client);
    if (!state) {
      return validate(client);
    }
    if (state.validated) return state.successfulResult;
    if (state.inFlight) return state.inFlight;

    state.attempts += 1;
    onValidationAttempt({ attempt: state.attempts });
    state.inFlight = Promise.resolve()
      .then(() => validate(client))
      .then((result) => {
        if (result?.success) {
          state.validated = true;
          state.successfulResult = result;
        }
        return result;
      })
      .finally(() => {
        state.inFlight = null;
      });
    return state.inFlight;
  }

  return {
    ensure,
    isValidated(client) {
      return stateFor(client)?.validated === true;
    },
    validationAttempts(client) {
      return stateFor(client)?.attempts || 0;
    },
  };
}
