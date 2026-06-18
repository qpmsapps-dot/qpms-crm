const filterFields = [
  ['accountStatus', 'Account status'],
  ['role', 'Role'],
  ['department', 'Department'],
  ['hod', 'HOD'],
  ['mobileAccess', 'Mobile access'],
];

export default function EmployeeFilters({ open, filters, options, onChange, onReset }) {
  if (!open) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-900">Filters</h2>
        <button type="button" onClick={onReset} className="focus-ring rounded-lg px-3 py-1.5 text-xs font-bold text-qpms-700 hover:bg-qpms-50">Reset</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {filterFields.map(([key, label]) => (
          <label key={key} className="block">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
            <select
              value={filters[key] || ''}
              onChange={(event) => onChange(key, event.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 outline-none focus:border-qpms-400 focus:bg-white focus:ring-2 focus:ring-qpms-100"
            >
              <option value="">All</option>
              {(options[key] || []).map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        ))}
      </div>
    </section>
  );
}
