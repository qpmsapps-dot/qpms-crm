const ENABLED_NON_PRODUCTION_ENVIRONMENTS = new Set([
  'development',
  'staging',
  'test',
]);

export const POSTMAN_TEST_RESET_PATH = '/api/test/reset';

export function isPostmanTestResetEnabled(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  return env.ENABLE_TEST_RESET === 'true'
    && ENABLED_NON_PRODUCTION_ENVIRONMENTS.has(nodeEnv);
}

export function registerPostmanTestResetRoute({
  app,
  env = process.env,
  requireJwt,
  requireAdmin,
  resetHandler,
}) {
  if (!isPostmanTestResetEnabled(env)) return false;
  app.post(
    POSTMAN_TEST_RESET_PATH,
    requireJwt,
    requireAdmin,
    resetHandler,
  );
  return true;
}

class PostmanTestResetError extends Error {
  constructor() {
    super('Postman test data reset failed.');
    this.name = 'PostmanTestResetError';
    this.statusCode = 500;
    this.code = 'postman_test_reset_failed';
  }
}

function throwDatabaseError({ table, operation, error, logger }) {
  logger.error('[Postman Test Reset] database operation failed', {
    table,
    operation,
    code: error?.code || null,
  });
  throw new PostmanTestResetError();
}

async function deleteMatching(client, {
  table,
  column,
  values,
  logger,
}) {
  if (!values.length) return;
  const { error } = await client.from(table).delete().in(column, values);
  if (error) {
    throwDatabaseError({
      table,
      operation: 'delete',
      error,
      logger,
    });
  }
}

export async function resetPostmanApprovalMatrixData({
  client,
  logger = console,
}) {
  const { data: testLeads, error: leadFetchError } = await client
    .from('leads')
    .select('id')
    .eq('created_by_name', 'postman_automation');
  if (leadFetchError) {
    throwDatabaseError({
      table: 'leads',
      operation: 'select',
      error: leadFetchError,
      logger,
    });
  }

  const leadIds = (testLeads || [])
    .map((lead) => lead?.id)
    .filter(Boolean);
  if (!leadIds.length) {
    return { deletedLeadCount: 0 };
  }

  const { data: visits, error: visitFetchError } = await client
    .from('site_visits')
    .select('id')
    .in('lead_id', leadIds);
  if (visitFetchError) {
    throwDatabaseError({
      table: 'site_visits',
      operation: 'select',
      error: visitFetchError,
      logger,
    });
  }

  const siteVisitIds = (visits || [])
    .map((visit) => visit?.id)
    .filter(Boolean);

  for (const table of [
    'approval_queue',
    'workflow_status',
    'workflow_events',
    'workflow_instances',
    'activity_logs',
    'approval_requests',
    'site_assessments',
    'site_mom',
  ]) {
    await deleteMatching(client, {
      table,
      column: 'site_visit_id',
      values: siteVisitIds,
      logger,
    });
  }

  await deleteMatching(client, {
    table: 'site_visits',
    column: 'id',
    values: siteVisitIds,
    logger,
  });

  for (const table of [
    'activity_logs',
    'lead_mom',
    'lead_contacts',
  ]) {
    await deleteMatching(client, {
      table,
      column: 'lead_id',
      values: leadIds,
      logger,
    });
  }

  await deleteMatching(client, {
    table: 'leads',
    column: 'id',
    values: leadIds,
    logger,
  });

  return { deletedLeadCount: leadIds.length };
}

export function createPostmanTestResetHandler({
  getClient,
  logger = console,
}) {
  return async function postmanTestResetHandler(request, response) {
    try {
      const result = await resetPostmanApprovalMatrixData({
        client: getClient(),
        logger,
      });
      response.json({
        ok: true,
        message: 'Postman automation records cleaned.',
        ...result,
      });
    } catch (error) {
      response.status(error.statusCode || 500).json({
        ok: false,
        message: 'Postman test data reset failed.',
      });
    }
  };
}
