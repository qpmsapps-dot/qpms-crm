export const attendanceColumns = [
  ['state', 'State'], ['hk_aop', 'HK AOP'], ['mepc_aop', 'MEPC AOP'], ['total_aop', 'Total AOP'],
  ['hk_actual', 'HK actual'], ['mepc_actual', 'MEPC actual'], ['total_actual', 'Total actual'],
  ['hk_target', 'HK target'], ['mepc_target', 'MEPC target'], ['total_target', 'Total target'],
  ['hk_pct', 'HK %'], ['mepc_pct', 'MEPC %'], ['overall_pct', 'Overall %'],
];
export function attendanceExportRows(report, scope = 'states') {
  const store = scope === 'stores';
  const columns = store ? [['store_code', 'Store Code'], ['store_name', 'Store Name'], ['source_state', 'Original Geographic State'], ...attendanceColumns] : attendanceColumns;
  const rows = scope === 'consolidated' ? [report.total] : scope === 'stores' ? report.stores : [...report.states, report.total];
  return [columns.map(([, label]) => label), ...rows.map(row => columns.map(([key]) =>
    (row.missing_aop.length && (key.includes('aop') || key.includes('target'))) || (key.endsWith('_pct') && row[key] == null) ? 'N/A' : row[key] ?? ''))];
}
export async function exportRetailAttendance(report, scope) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Attendance');
  sheet.addRow(['Reliance Retail Attendance', report.view, report.cutoff]);
  sheet.addRow(['Missing attendance dates', report.total.missing_dates.join(', ')]);
  sheet.addRow(['Missing AOP dates', report.total.missing_aop.join(', ')]);
  sheet.addRow(['MEPC target policy', report.mepc_target_policy || 'Aggregate 7-day planning cycle; not employee weekly-off allocation']);
  sheet.addRow(['Unique employees with positive attendance', report.employee_counts?.unique_employees ?? 'N/A']);
  sheet.addRow(['Attended employee-days', report.employee_counts?.employee_days ?? 'N/A']);
  sheet.addRow(['HK replacement attendance', report.replacement_mapping_status || 'Unavailable / pending source mapping']);
  sheet.addRows(attendanceExportRows(report, scope));
  sheet.columns.forEach(column => { column.width = 22; });
  const bytes = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `retail-attendance-${report.view}-${report.cutoff}-${scope}.xlsx`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportRetailAttendanceSource(batch) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const source = batch.raw_source || {};
  const sheet = workbook.addWorksheet('Source rows');
  sheet.addRow(['File',batch.filename,'SHA-256',batch.checksum]);
  sheet.addRow(['Source row',...(source.headers || [])]);
  for(const row of source.rows || []) sheet.addRow([row.source_row,...row.raw_cells]);
  const exceptions=workbook.addWorksheet('Exceptions');
  exceptions.addRow(['Source row','Disposition','Employee','Site','Date','Reasons']);
  for(const disposition of ['rejected','excluded']) for(const row of source[disposition] || []) exceptions.addRow([row.source_row,disposition,row.employee_code,row.store_code,row.attendance_date,row.reasons.join('; ')]);
  const audit=workbook.addWorksheet('Import audit');
  for(const key of ['id','filename','checksum','status','uploaded_at','committed_at','correction_reason']) audit.addRow([key,batch[key] || '']);
  const bytes=await workbook.xlsx.writeBuffer();
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download='retail-attendance-source-'+batch.id+'.xlsx';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
