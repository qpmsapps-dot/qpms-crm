const classes = {
  Existing: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Ready: 'bg-sky-50 text-sky-700 ring-sky-200',
  'Needs Mapping': 'bg-amber-50 text-amber-800 ring-amber-200',
  'Temporary Password': 'bg-violet-50 text-violet-700 ring-violet-200',
  'Password Changed': 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Disabled: 'bg-slate-100 text-slate-700 ring-slate-200',
  'Import Only': 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  Draft: 'bg-slate-100 text-slate-700 ring-slate-200',
  'Ready to Create': 'bg-sky-50 text-sky-700 ring-sky-200',
  'Password Change Pending': 'bg-amber-50 text-amber-800 ring-amber-200',
  Healthy: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  Blocking: 'bg-rose-50 text-rose-700 ring-rose-200',
};

export default function UserStatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${classes[status] || classes.Warning}`}>
      {status || 'Needs Review'}
    </span>
  );
}
