import ExcelJS from 'exceljs';

export function provisionalCounts(rows, canonical) {
  return [...new Set([...rows.map(r => r.source_state), ...canonical.map(c => c.state)])].sort().map(state => {
    const active = rows.filter(r => r.source_state === state && !r.withdrawn_at);
    return { state: state || 'UNKNOWN', source_rows: active.length,
      provisional_codes: new Set(active.filter(r => r.verification_status !== 'VERIFIED').map(r => r.store_code).filter(Boolean)).size,
      pending_rows: active.filter(r => r.verification_status !== 'VERIFIED').length,
      verified_rows: active.filter(r => r.verification_status === 'VERIFIED').length,
      canonical_stores: canonical.filter(c => c.state === state).length };
  });
}
export async function buildProvisionalWorkbook(report, rows = report.rows) {
  const book = new ExcelJS.Workbook();
  const add = (name, headers, data) => {
    const sheet = book.addWorksheet(name);
    sheet.addRow(headers);
    data.forEach(row => sheet.addRow(row.map(v => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v)));
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: data.length + 1, column: headers.length } };
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    sheet.columns.forEach(c => { c.width = 25; });
  };
  add('State counts', ['Source state','Source rows (all versions)','Unique pending codes','Pending rows','Verified staging rows','Canonical stores'], provisionalCounts(rows, report.canonical).map(c => Object.values(c)));
  add('MIS review', ['Version','Filename','SHA256','Source row','Row digest','Store code','Source state','Verification status','Withdrawn','Review values','Duplicate rows in version','Other version match','Canonical matches','Original source values'], rows.map(r => [r.version,r.filename,r.sha256,r.source_row,r.row_digest,r.store_code,r.source_state,r.verification_status,r.withdrawn_at,r.review,r.duplicate_count,r.other_version_match,r.canonical_matches,r.source.raw]));
  const ids = new Set(rows.map(r => r.id));
  add('Change history', ['Proposal','Row','Revision','Proposed values','Reason','Proposed by','Created','Status','Decided by','Decided at','Decision evidence'], report.proposals.filter(p => ids.has(p.row_id)).map(p => [p.id,p.row_id,p.revision,p.changes,p.reason,p.proposed_by,p.created_at,p.status,p.decided_by,p.decided_at,p.decision_reason]));
  const batches = new Set(rows.map(r => r.batch_id));
  add('Audit', ['Event','Actor','Action','Created','Details'], report.events.filter(e => e.details?.row_id ? ids.has(e.details.row_id) : batches.has(e.batch_id)).map(e => [e.id,e.actor_id,e.action,e.created_at,e.details]));
  return book;
}
export async function downloadProvisional(report, rows) {
  const bytes = await (await buildProvisionalWorkbook(report, rows)).xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url; a.download = 'retail-provisional-mis-review.xlsx'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
