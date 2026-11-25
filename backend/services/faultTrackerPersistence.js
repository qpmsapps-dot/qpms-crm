// The database resolves history in one MVCC snapshot. Never copy manual values
// into Excel rows: an import cannot overwrite (or miss copying) a concurrent save.
export async function retainFaultTrackerUpdates(client, tickets) {
  const retained = [];
  for (let offset = 0; offset < tickets.length; offset += 200) {
    const chunk = tickets.slice(offset, offset + 200);
    const { data, error } = await client.rpc('rpc_fault_tracker_retained_updates', {
      p_tickets: chunk.map(ticket => ticket.id),
    });
    if (error || !Array.isArray(data) || data.length !== chunk.length) {
      throw Object.assign(Error('Verified IFMS persistence unavailable. Refresh after the reviewed database capability is installed.'), { statusCode: 503 });
    }
    const patches = new Map(data.map(row => [row.id, row]));
    for (const ticket of chunk) {
      const patch = patches.get(ticket.id);
      if (!patch || !Array.isArray(patch.verified_updates)) {
        throw Object.assign(Error('Incomplete verified IFMS history.'), { statusCode: 503 });
      }
      retained.push({ ...ticket, ...patch,
        metadata: { ...ticket.metadata, ...(patch.manual_update_id ? { lastUpdatedBy: patch.last_updated_by } : {}) },
      });
    }
  }
  return retained;
}

export function faultImportIdentity(row) {
  return JSON.stringify([String(row.ticket_no || '').trim().toUpperCase(), String(row.store_code || '').trim().toUpperCase()]);
}
