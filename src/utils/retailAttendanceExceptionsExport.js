import { attendanceSeconds } from '../../backend/shared/retailAttendanceExceptions.js';
export function exceptionTime(row, key) {
  const field = row.time_source?.fields?.[key];
  if (!field?.available) return 'N/A';
  const raw = field.raw;
  if (typeof raw !== 'number') return String(raw ?? '');
  const parsed = attendanceSeconds(raw, key === 'man_hours');
  if (parsed.invalid) return String(raw) + ' (invalid Excel time)';
  const n = parsed.seconds;
  return `${String(Math.floor(n / 3600)).padStart(2, '0')}:${String(Math.floor(n % 3600 / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}
export function exceptionLabel(row) {
  return [row.missing_checkout && 'Missing Checkout', row.below_9_hours && 'Below 9 Work Hours', ...row.issues].filter(Boolean).join('; ');
}
export const exceptionColumns = ['Employee ID', 'Employee Name', 'State', 'Store Code', 'Store Name', 'Category', 'Date', 'In Time', 'Out Time', 'Man Hours', 'Original Status', 'Exception Type'];
export function exceptionExportRows(rows) {
  return [exceptionColumns, ...rows.map(r => [r.employee_code, r.employee_name, r.source_state || r.state, r.store_code_snapshot, r.store_name,
    r.class, r.attendance_date, exceptionTime(r, 'in_time'), exceptionTime(r, 'out_time'), exceptionTime(r, 'man_hours'), r.original_status, exceptionLabel(r)])];
}
export async function attendanceExceptionWorkbook(report, rows) {
  const ExcelJS = (await import('exceljs')).default;
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Attendance exceptions');
  sheet.addRow(['Reliance Retail attendance exceptions', report.from, report.to, report.state || 'All authorized states']);
  sheet.addRow(['Missing Checkout', report.missing_checkout ?? 'N/A', 'Below 9 Work Hours', report.below_9_hours ?? 'N/A']);
  sheet.addRow([report.note]);
  sheet.addRows(exceptionExportRows(rows));
  sheet.columns.forEach(column => { column.width = 22; });
  sheet.getRow(4).font = { bold: true, color: { argb: 'FF124FA0' } };
  return book.xlsx.writeBuffer();
}
export async function exportAttendanceExceptions(report, rows) {
  const bytes = await attendanceExceptionWorkbook(report, rows);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `retail-attendance-exceptions-${report.view}-${report.to}.xlsx`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
