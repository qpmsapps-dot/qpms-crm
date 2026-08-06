export const STORE_MASTER_EXPORT_BATCH_SIZE = 1000;

export function buildStoreMasterExportRows(rows = [], formatDateTime = (value) => value || '') {
  return (rows || []).map((row) => ({
    'Store Code': row.store_code || '',
    'Store Name': row.store_name || '',
    'Site Name': row.site_name || '',
    'Client Name': row.client_name || '',
    Business: row.business || '',
    State: row.state || '',
    Latitude: row.latitude ?? '',
    Longitude: row.longitude ?? '',
    'GPS Accuracy': row.gps_accuracy ?? '',
    'Updated At': formatDateTime(row.updated_at),
    Status: row.status || '',
  }));
}

export async function fetchAllStoreMasterRows(fetchStoreMaster, filters = {}, options = {}) {
  const batchSize = options.batchSize || STORE_MASTER_EXPORT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('Export batch size must be a positive integer.');
  }

  const allRows = [];
  let page = 1;

  while (true) {
    const payload = await fetchStoreMaster({
      ...filters,
      page,
      limit: batchSize,
      exportAll: true,
    });
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    allRows.push(...rows);

    if (rows.length < batchSize) break;
    page += 1;
  }

  return allRows;
}
