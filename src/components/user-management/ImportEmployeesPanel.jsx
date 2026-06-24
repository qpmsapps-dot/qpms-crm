import { AlertTriangle, FileSpreadsheet, X } from 'lucide-react';

export default function ImportEmployeesPanel({ open, review, employees = [], error, importing, onFile, onCancel, onAccept, onDownloadErrors }) {
  if (!open) return null;

  const stats = review ? [
    ['Total rows', review.totalRows],
    ['Unique employees', review.uniqueEmployees],
    ['Duplicate employee codes', review.duplicateEmployeeCodes],
    ['Missing employee codes', review.missingEmployeeCodes],
    ['Missing emails', review.missingEmails],
    ['Missing managers', review.missingManagers],
    ['Invalid rows', review.invalidRows],
  ] : [];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-950">Import HR Excel</h2>
          <p className="text-xs font-semibold text-slate-500">Browser preview only. Imported employees are not written to Supabase.</p>
        </div>
        <button type="button" aria-label="Close import panel" onClick={onCancel} className="focus-ring grid h-8 w-8 place-items-center rounded-full border border-slate-200 text-slate-500"><X className="h-4 w-4" /></button>
      </div>
      <label className="mt-4 flex min-h-28 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
        <FileSpreadsheet className="h-7 w-7 text-qpms-600" />
        <span className="mt-2 text-sm font-bold text-slate-800">{importing ? 'Reading workbook...' : 'Choose .xlsx, .xls, or .csv'}</span>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => onFile(event.target.files?.[0])} className="sr-only" />
      </label>
      {error ? (
        <div className="mt-3 flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
          <AlertTriangle className="h-5 w-5 shrink-0" /> {error}
        </div>
      ) : null}
      {review ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
            {stats.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-200 px-3 py-2">
                <p className="text-[10px] font-bold uppercase text-slate-400">{label}</p>
                <p className="text-lg font-bold text-slate-950">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-[760px] divide-y divide-slate-200 text-left">
              <thead className="bg-slate-50">
                <tr>
                  {['Employee Code', 'Name', 'Email', 'Designation', 'Department', 'Manager'].map((label) => (
                    <th key={label} className="px-3 py-2 text-[10px] font-bold uppercase text-slate-500">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employees.slice(0, 20).map((employee) => (
                  <tr key={`${employee.employeeCode}-${employee.sourceRow}`}>
                    <td className="px-3 py-2 text-xs font-bold text-slate-700">{employee.employeeCode}</td>
                    <td className="px-3 py-2 text-xs font-semibold text-slate-600">{employee.employeeName || '—'}</td>
                    <td className="px-3 py-2 text-xs font-semibold text-slate-600">{employee.email || 'Missing'}</td>
                    <td className="px-3 py-2 text-xs font-semibold text-slate-600">{employee.designation || '—'}</td>
                    <td className="px-3 py-2 text-xs font-semibold text-slate-600">{employee.department || '—'}</td>
                    <td className="px-3 py-2 text-xs font-semibold text-slate-600">{employee.managerCode || 'Missing'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {employees.length > 20 ? <p className="border-t border-slate-200 px-3 py-2 text-xs font-semibold text-slate-500">Showing first 20 of {employees.length} parsed employees.</p> : null}
          </div>
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
            Bulk import API not implemented yet. This preview is temporary and is not saved.
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onCancel} className="focus-ring rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700">Cancel</button>
            <button type="button" onClick={onDownloadErrors} className="focus-ring rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700">Download Error Report</button>
            <button type="button" onClick={onAccept} className="focus-ring rounded-xl bg-slate-400 px-3 py-2 text-sm font-bold text-white">Bulk Import Unavailable</button>
          </div>
        </>
      ) : null}
    </section>
  );
}
